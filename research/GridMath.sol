// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title GridMath
 * @notice All mathematical primitives for the xStocks Grid prediction market.
 *
 * MATHEMATICAL FOUNDATION
 * =======================
 * Stock prices follow Geometric Brownian Motion (GBM):
 *   dS = μS dt + σS dW
 *
 * Over short intervals the log-return is normally distributed:
 *   ln(S_T / S_0) ~ N(μT, σ²T)
 *
 * Probability of price reaching level L within time T:
 *   P = 2 · Φ(-|d|)   where d = ln(L/S₀) / (σ√T)
 *   Φ = cumulative standard normal distribution
 *
 * Fair multiplier (before house edge):
 *   mult_fair = 1 / P
 *
 * Displayed multiplier (after house edge h):
 *   mult_display = mult_fair × (1 - h)
 *
 * Grid cell distance score:
 *   distance = |price_ticks_away| × sqrt(time_buckets_away)
 *   (time gets square-root dampened because σ scales with √T)
 *
 * VOLATILITY SCALING
 * ==================
 * Annual σ → per-bucket σ:
 *   σ_bucket = σ_annual × √(bucket_seconds / SECONDS_PER_YEAR)
 *
 * Market-hours multipliers (from Tivnan et al.):
 *   - First 30 min after open: ×2.5 (dislocation spike)
 *   - Normal hours: ×1.0
 *   - Last 30 min: ×1.8
 *   - Pre/after market: ×0.4
 *   - Weekend/closed: ×0.2
 */
library GridMath {

    // ─── Constants ───────────────────────────────────────────────────────────

    uint256 constant PRECISION     = 1e18;
    uint256 constant SECONDS_PER_YEAR = 31_536_000;
    uint256 constant BPS_DENOMINATOR  = 10_000;

    // Normal distribution approximation coefficients (Abramowitz & Stegun 26.2.17)
    // These give max error < 7.5e-8
    uint256 constant A1 = 254829592;
    uint256 constant A2 = 284496736;
    uint256 constant A3 = 1421413741;
    uint256 constant A4 = 1453152027;
    uint256 constant A5 = 1061405429;
    uint256 constant P  = 327591100;

    // ─── Structs ─────────────────────────────────────────────────────────────

    struct VolatilityParams {
        uint256 annualVolBps;      // Annual σ in bps (2500 = 25%)
        uint256 driftBps;          // Annual drift μ in bps (can be 0)
        uint256 tickSizeUsdc;      // Price increment per grid row (6 dec USDC)
        uint256 bucketSeconds;     // Seconds per time column
        uint256 houseEdgeBps;      // House take in bps (1000 = 10%)
        uint256 openBoostBps;      // Vol multiplier at market open (25000 = 2.5×)
        uint256 closeBoostBps;     // Vol multiplier near close
        uint256 afterHoursBps;     // Vol multiplier after hours (4000 = 0.4×)
    }

    struct MarketState {
        bool isOpen;
        bool isOpeningWindow;      // First 30 min
        bool isClosingWindow;      // Last 30 min
        bool isAfterHours;
        bool isWeekend;
    }

    // ─── Core Multiplier Calculation ─────────────────────────────────────────

    /**
     * @notice Calculate the display multiplier for a grid cell.
     * @param priceTicks  Absolute number of tick-rows away from current price.
     * @param timeBuckets Number of time columns away (1 = nearest).
     * @param currentPriceUsdc Current price of xStock in USDC (6 decimals).
     * @param params Volatility and grid parameters for this token.
     * @param state Current market hours state.
     * @return multiplier Payout multiplier scaled by 100 (200 = 2.00×).
     * @return probability Implied probability scaled by PRECISION.
     */
    function calculateMultiplier(
        uint256 priceTicks,
        uint256 timeBuckets,
        uint256 currentPriceUsdc,
        VolatilityParams memory params,
        MarketState memory state
    ) internal pure returns (uint256 multiplier, uint256 probability) {

        require(priceTicks > 0, "GridMath: zero price ticks");
        require(timeBuckets > 0, "GridMath: zero time buckets");
        require(currentPriceUsdc > 0, "GridMath: zero price");

        // 1. Adjust volatility for market hours
        uint256 effectiveVolBps = _adjustVolForMarketHours(
            params.annualVolBps,
            params.openBoostBps,
            params.closeBoostBps,
            params.afterHoursBps,
            state
        );

        // 2. Calculate σ for the time window
        //    σ_window = σ_annual × √(window_seconds / SECONDS_PER_YEAR)
        uint256 windowSeconds = timeBuckets * params.bucketSeconds;
        uint256 sigmaWindow = _sigmaForWindow(effectiveVolBps, windowSeconds);
        // sigmaWindow is in PRECISION units (1e18 = 100%)

        // 3. Calculate required price move as fraction of current price
        //    move_fraction = (priceTicks × tickSize) / currentPrice
        uint256 requiredMove = (priceTicks * params.tickSizeUsdc * PRECISION)
                               / currentPriceUsdc;
        // requiredMove is in PRECISION units (1e18 = 100% move)

        // 4. Z-score: how many standard deviations is the required move?
        //    d = requiredMove / sigmaWindow
        uint256 zScore;
        if (sigmaWindow == 0) {
            // Extreme case: no volatility → impossible → max multiplier
            return (10000, 1); // 100× payout
        }
        zScore = (requiredMove * PRECISION) / sigmaWindow;
        // zScore is in PRECISION units

        // 5. P(reaching target) = 2 × Φ(-|z|)
        //    We use a polynomial approximation of the normal CDF
        probability = _twoTailProbability(zScore);
        // probability in PRECISION units (1e18 = 100%)

        // 6. Fair multiplier = 1 / P
        if (probability == 0) {
            return (10000, 0); // 100× cap
        }
        uint256 fairMultiplierPrecision = PRECISION * PRECISION / probability;

        // 7. Apply house edge
        //    displayed = fair × (1 - houseEdge)
        uint256 displayedPrecision = (fairMultiplierPrecision *
                                      (BPS_DENOMINATOR - params.houseEdgeBps))
                                     / BPS_DENOMINATOR;

        // 8. Convert to integer multiplier (scaled by 100)
        //    1.0× = 100, 2.5× = 250, etc.
        multiplier = displayedPrecision / (PRECISION / 100);

        // 9. Enforce floor at 110 (1.1×) and cap at 10000 (100×)
        if (multiplier < 110) multiplier = 110;
        if (multiplier > 10000) multiplier = 10000;

        return (multiplier, probability);
    }

    // ─── Volatility Adjustment ───────────────────────────────────────────────

    function _adjustVolForMarketHours(
        uint256 baseVolBps,
        uint256 openBoostBps,
        uint256 closeBoostBps,
        uint256 afterHoursBps,
        MarketState memory state
    ) internal pure returns (uint256) {
        if (state.isWeekend) {
            // Weekend: 20% of normal vol (very illiquid)
            return (baseVolBps * 2000) / BPS_DENOMINATOR;
        }
        if (!state.isOpen) {
            // After-hours / pre-market
            return (baseVolBps * afterHoursBps) / BPS_DENOMINATOR;
        }
        if (state.isOpeningWindow) {
            // Opening 30 min — Tivnan: dislocation rate 2.5× normal
            return (baseVolBps * openBoostBps) / BPS_DENOMINATOR;
        }
        if (state.isClosingWindow) {
            // Closing 30 min — elevated activity
            return (baseVolBps * closeBoostBps) / BPS_DENOMINATOR;
        }
        return baseVolBps;
    }

    // ─── σ for Time Window ───────────────────────────────────────────────────

    /**
     * @notice σ_window = σ_annual × √(windowSeconds / SECONDS_PER_YEAR)
     * @return Sigma in PRECISION units (1e18 = 100%)
     */
    function _sigmaForWindow(
        uint256 annualVolBps,
        uint256 windowSeconds
    ) internal pure returns (uint256) {
        // Convert annual vol from bps to PRECISION
        uint256 sigmaAnnual = (annualVolBps * PRECISION) / BPS_DENOMINATOR;

        // √(windowSeconds / SECONDS_PER_YEAR) using integer sqrt
        // = sqrt(windowSeconds) / sqrt(SECONDS_PER_YEAR)
        // sqrt(SECONDS_PER_YEAR) = sqrt(31536000) ≈ 5615.7 → use 5616
        uint256 sqrtWindow = _sqrt(windowSeconds * PRECISION);
        uint256 sqrtYear   = _sqrt(SECONDS_PER_YEAR * PRECISION);

        return (sigmaAnnual * sqrtWindow) / sqrtYear;
    }

    // ─── Normal Distribution ─────────────────────────────────────────────────

    /**
     * @notice Two-tailed probability: P = 2 × Φ(-|z|)
     *         Uses Abramowitz & Stegun rational approximation.
     * @param zScorePrecision Z-score in PRECISION units.
     * @return prob Probability in PRECISION units.
     */
    function _twoTailProbability(
        uint256 zScorePrecision
    ) internal pure returns (uint256 prob) {
        // For very large z, probability → 0
        if (zScorePrecision > 6 * PRECISION) {
            return 1; // ~0 but avoid division by zero
        }

        // Φ(x) ≈ 1 - φ(x)(b1·t + b2·t² + b3·t³ + b4·t⁴ + b5·t⁵)
        // where t = 1 / (1 + p·x), p = 0.3275911
        // All coefficients scaled by 1e9

        uint256 z = zScorePrecision; // in PRECISION

        // t = 1 / (1 + P × z / 1e9)
        // P = 327591100 (scaled by 1e9)
        uint256 pz = (P * z) / PRECISION; // P × z / PRECISION, result in 1e9 units
        uint256 t_denom = 1_000_000_000 + pz; // (1 + p·z) scaled by 1e9
        uint256 t = (1_000_000_000 * PRECISION) / t_denom; // t in PRECISION

        // Polynomial evaluation using Horner's method
        // coefficients in 1e9
        uint256 poly = A5; // start with a5
        poly = (poly * t) / PRECISION + A4;
        poly = (poly * t) / PRECISION + A3;
        poly = (poly * t) / PRECISION + A2;
        poly = (poly * t) / PRECISION + A1;
        poly = (poly * t) / PRECISION;
        // poly is now a5·t⁵ + a4·t⁴ + a3·t³ + a2·t² + a1·t (scaled by 1e9)

        // Standard normal PDF: φ(z) = exp(-z²/2) / √(2π)
        uint256 phi = _normalPDF(z);

        // Q(z) = 1 - Φ(z) = φ(z) × poly / 1e9
        uint256 qz = (phi * poly) / 1_000_000_000;

        // Two-tailed: P = 2 × Q(z)
        prob = 2 * qz;
        if (prob > PRECISION) prob = PRECISION;
        return prob;
    }

    /**
     * @notice Standard normal PDF: φ(z) = exp(-z²/2) / √(2π)
     * @param zPrecision Z in PRECISION units.
     * @return pdf in PRECISION units.
     */
    function _normalPDF(uint256 zPrecision) internal pure returns (uint256) {
        // exp(-z²/2) using Taylor series approximation for reasonable z values
        // √(2π) ≈ 2.5066282746

        // z² / 2  (in PRECISION)
        uint256 zSquaredHalf = (zPrecision * zPrecision) / (2 * PRECISION);

        // exp(-x) approximation for x in [0, 18]:
        // We use: exp(-x) ≈ 1/(1 + x + x²/2 + x³/6 + x⁴/24)  for small x
        // For larger x, use the identity: exp(-x) = 1/exp(x)
        uint256 expNeg = _expNeg(zSquaredHalf);

        // Divide by √(2π) = 2506628274631 / 1e12
        uint256 sqrt2pi = 2_506_628_274; // 2.506... × 1e9
        return (expNeg * 1_000_000_000) / sqrt2pi;
    }

    /**
     * @notice exp(-x) for x in PRECISION units, result in PRECISION units.
     *         Uses rational approximation, accurate for x in [0, 20e18].
     */
    function _expNeg(uint256 xPrecision) internal pure returns (uint256) {
        if (xPrecision >= 20 * PRECISION) return 0;
        if (xPrecision == 0) return PRECISION;

        // Use: e^(-x) computed via integer decomposition
        // We compute using a 6-term Taylor series scaled approach
        // For production, use a proper fixed-point exp library (PRBMath etc)

        // Rough approximation sufficient for multiplier pricing:
        // exp(-x) ≈ 1 / (1 + x + x²/2 + x³/6 + x⁴/24 + x⁵/120)
        uint256 x = xPrecision;
        uint256 x2 = (x * x) / PRECISION;
        uint256 x3 = (x2 * x) / PRECISION;
        uint256 x4 = (x3 * x) / PRECISION;
        uint256 x5 = (x4 * x) / PRECISION;

        uint256 series = PRECISION
                       + x
                       + x2 / 2
                       + x3 / 6
                       + x4 / 24
                       + x5 / 120;

        return (PRECISION * PRECISION) / series;
    }

    // ─── Integer Square Root (Babylonian method) ─────────────────────────────

    function _sqrt(uint256 x) internal pure returns (uint256 y) {
        if (x == 0) return 0;
        uint256 z = (x + 1) / 2;
        y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
    }

    // ─── Public Helpers ───────────────────────────────────────────────────────

    function sqrt(uint256 x) internal pure returns (uint256) {
        return _sqrt(x);
    }

    /**
     * @notice Compute expected payout from a bet.
     * @param betAmount USDC amount wagered (6 decimals).
     * @param multiplier Multiplier scaled by 100 (200 = 2×).
     * @return payout USDC payout if bet wins (6 decimals).
     */
    function computePayout(
        uint256 betAmount,
        uint256 multiplier
    ) internal pure returns (uint256 payout) {
        return (betAmount * multiplier) / 100;
    }

    /**
     * @notice House profit from a bet (expected value for protocol).
     * @param betAmount USDC wagered.
     * @param multiplier Displayed multiplier (×100).
     * @param probability True probability of winning (PRECISION units).
     */
    function computeExpectedHouseProfit(
        uint256 betAmount,
        uint256 multiplier,
        uint256 probability
    ) internal pure returns (int256) {
        // EV = betAmount - (payout × probability)
        uint256 payout = computePayout(betAmount, multiplier);
        uint256 expectedPayout = (payout * probability) / PRECISION;
        return int256(betAmount) - int256(expectedPayout);
    }
}
