// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

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
 * Probability of price TOUCHING level L within time T (barrier semantics):
 *   P = 2 · Φ(-|d|)   where d = (L - S₀) / (S₀ · σ · √T)  [linear approx for small moves]
 *   Φ = cumulative standard normal distribution
 *
 * Fair multiplier (before house edge):
 *   mult_fair = 1 / P
 *
 * Displayed multiplier (after house edge h):
 *   mult_display = mult_fair × (1 - h)
 *
 * VOLATILITY SCALING
 * ==================
 * Annual σ → per-bucket σ:
 *   σ_bucket = σ_annual × √(bucket_seconds / SECONDS_PER_YEAR)
 *
 * Market-hours vol adjustments (from Tivnan et al.):
 *   - First 30 min after open: ×2.5 (dislocation rate spike)
 *   - Normal hours:            ×1.0
 *   - Last 30 min before close:×1.8
 *   - Pre/after market:        ×0.4
 *   - Weekend/closed:          ×0.2
 *
 * Higher effective vol → lower multipliers (price more likely to reach target).
 */
library GridMath {

    // ─── Constants ───────────────────────────────────────────────────────────

    uint256 constant PRECISION        = 1e18;
    uint256 constant SECONDS_PER_YEAR = 31_536_000;
    uint256 constant BPS_DENOMINATOR  = 10_000;

    // Abramowitz & Stegun 26.2.17 rational approximation — max error < 7.5e-8
    uint256 constant A1 = 254829592;
    uint256 constant A2 = 284496736;
    uint256 constant A3 = 1421413741;
    uint256 constant A4 = 1453152027;
    uint256 constant A5 = 1061405429;
    uint256 constant P  = 327591100;

    // ─── Structs ─────────────────────────────────────────────────────────────

    struct VolatilityParams {
        uint256 annualVolBps;      // Annual σ in bps (2500 = 25%)
        uint256 tickSizeUsdc;      // Price increment per grid row (6-dec USDC)
        uint256 bucketSeconds;     // Seconds per time column
        uint256 houseEdgeBps;      // House take in bps (1000 = 10%)
        uint256 openBoostBps;      // Vol multiplier at market open (25000 = 2.5×)
        uint256 closeBoostBps;     // Vol multiplier near close  (18000 = 1.8×)
        uint256 afterHoursBps;     // Vol multiplier after hours  (4000 = 0.4×)
    }

    struct MarketState {
        bool isOpen;
        bool isOpeningWindow;   // First 30 min after open
        bool isClosingWindow;   // Last 30 min before close
        bool isAfterHours;
        bool isWeekend;
    }

    // ─── Core Multiplier Calculation ─────────────────────────────────────────

    /**
     * @notice Calculate the display multiplier for a grid cell.
     *
     * @param priceTicks         Absolute tick-rows away from current price.
     * @param timeBuckets        Time columns away (1 = nearest).
     * @param currentPriceUsdc   Current xStock price (USDC, 6 decimals).
     * @param params             Volatility and grid parameters for this token.
     * @param state              Current market-hours state.
     *
     * @return multiplier   Payout multiplier ×100  (200 = 2.00×).
     * @return probability  Implied probability in PRECISION units.
     */
    function calculateMultiplier(
        uint256 priceTicks,
        uint256 timeBuckets,
        uint256 currentPriceUsdc,
        VolatilityParams memory params,
        MarketState memory state
    ) internal pure returns (uint256 multiplier, uint256 probability) {

        require(priceTicks > 0,       "GridMath: zero ticks");
        require(timeBuckets > 0,      "GridMath: zero buckets");
        require(currentPriceUsdc > 0, "GridMath: zero price");

        // 1. Adjust volatility for market hours
        uint256 effectiveVolBps = _adjustVolForMarketHours(
            params.annualVolBps,
            params.openBoostBps,
            params.closeBoostBps,
            params.afterHoursBps,
            state
        );

        // 2. σ_window = σ_annual × √(windowSeconds / SECONDS_PER_YEAR)
        uint256 windowSeconds = timeBuckets * params.bucketSeconds;
        uint256 sigmaWindow   = _sigmaForWindow(effectiveVolBps, windowSeconds);

        // 3. Required move as fraction of current price
        //    move_fraction = (priceTicks × tickSize) / currentPrice
        uint256 requiredMove = (priceTicks * params.tickSizeUsdc * PRECISION) / currentPriceUsdc;

        // 4. Z-score: standard deviations the required move represents
        if (sigmaWindow == 0) {
            return (10000, 1); // 100× cap — effectively impossible
        }
        uint256 zScore = (requiredMove * PRECISION) / sigmaWindow;

        // 5. Two-tailed touch probability: P = 2 × Φ(-|z|)
        probability = _twoTailProbability(zScore);

        // 6. Fair multiplier = 1 / P
        if (probability == 0) {
            return (10000, 0);
        }
        uint256 fairMultiplierPrecision = (PRECISION * PRECISION) / probability;

        // 7. Apply house edge: displayed = fair × (1 − houseEdge)
        uint256 displayedPrecision = (fairMultiplierPrecision *
                                      (BPS_DENOMINATOR - params.houseEdgeBps))
                                     / BPS_DENOMINATOR;

        // 8. Convert to ×100 integer (e.g. 250 = 2.50×)
        multiplier = displayedPrecision / (PRECISION / 100);

        // 9. Clamp: floor 110 (1.1×), cap 10000 (100×)
        if (multiplier < 110)   multiplier = 110;
        if (multiplier > 10000) multiplier = 10000;
    }

    // ─── Volatility Adjustment ───────────────────────────────────────────────

    function _adjustVolForMarketHours(
        uint256 baseVolBps,
        uint256 openBoostBps,
        uint256 closeBoostBps,
        uint256 afterHoursBps,
        MarketState memory state
    ) internal pure returns (uint256) {
        if (state.isWeekend)       return (baseVolBps * 2000)         / BPS_DENOMINATOR;
        if (!state.isOpen)         return (baseVolBps * afterHoursBps) / BPS_DENOMINATOR;
        if (state.isOpeningWindow) return (baseVolBps * openBoostBps)  / BPS_DENOMINATOR;
        if (state.isClosingWindow) return (baseVolBps * closeBoostBps) / BPS_DENOMINATOR;
        return baseVolBps;
    }

    // ─── σ for Time Window ───────────────────────────────────────────────────

    /**
     * @notice σ_window = σ_annual × √(windowSeconds / SECONDS_PER_YEAR)
     * @return Sigma in PRECISION units (1e18 = 100%).
     */
    function _sigmaForWindow(uint256 annualVolBps, uint256 windowSeconds)
        internal pure returns (uint256)
    {
        uint256 sigmaAnnual = (annualVolBps * PRECISION) / BPS_DENOMINATOR;
        uint256 sqrtWindow  = _sqrt(windowSeconds * PRECISION);
        uint256 sqrtYear    = _sqrt(SECONDS_PER_YEAR * PRECISION);
        return (sigmaAnnual * sqrtWindow) / sqrtYear;
    }

    // ─── Normal Distribution ─────────────────────────────────────────────────

    /**
     * @notice Two-tailed probability: P = 2 × Φ(-|z|)
     *         Uses Abramowitz & Stegun rational approximation.
     * @param zScorePrecision Z-score in PRECISION units.
     * @return prob Probability in PRECISION units.
     */
    function _twoTailProbability(uint256 zScorePrecision)
        internal pure returns (uint256 prob)
    {
        if (zScorePrecision > 6 * PRECISION) return 1; // ~0, avoid div-by-zero

        uint256 z = zScorePrecision;

        // t = 1 / (1 + p·z)
        uint256 pz      = (P * z) / PRECISION;
        uint256 t_denom = 1_000_000_000 + pz;
        uint256 t       = (1_000_000_000 * PRECISION) / t_denom;

        // Horner's method polynomial evaluation
        uint256 poly = A5;
        poly = (poly * t) / PRECISION + A4;
        poly = (poly * t) / PRECISION + A3;
        poly = (poly * t) / PRECISION + A2;
        poly = (poly * t) / PRECISION + A1;
        poly = (poly * t) / PRECISION;

        uint256 phi = _normalPDF(z);
        uint256 qz  = (phi * poly) / 1_000_000_000;

        prob = 2 * qz;
        if (prob > PRECISION) prob = PRECISION;
    }

    /**
     * @notice Standard normal PDF: φ(z) = exp(−z²/2) / √(2π)
     * @param zPrecision Z in PRECISION units.
     * @return pdf in PRECISION units.
     */
    function _normalPDF(uint256 zPrecision) internal pure returns (uint256) {
        uint256 zSquaredHalf = (zPrecision * zPrecision) / (2 * PRECISION);
        uint256 expNeg       = _expNeg(zSquaredHalf);
        uint256 sqrt2pi      = 2_506_628_274; // 2.506... × 1e9
        return (expNeg * 1_000_000_000) / sqrt2pi;
    }

    /**
     * @notice exp(−x) for x in PRECISION units, result in PRECISION units.
     *         6-term Taylor series — accurate for x in [0, 20e18].
     */
    function _expNeg(uint256 xPrecision) internal pure returns (uint256) {
        if (xPrecision >= 20 * PRECISION) return 0;
        if (xPrecision == 0)             return PRECISION;

        uint256 x  = xPrecision;
        uint256 x2 = (x * x) / PRECISION;
        uint256 x3 = (x2 * x) / PRECISION;
        uint256 x4 = (x3 * x) / PRECISION;
        uint256 x5 = (x4 * x) / PRECISION;

        uint256 series = PRECISION + x + x2 / 2 + x3 / 6 + x4 / 24 + x5 / 120;
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

    /**
     * @notice Compute winning payout given bet amount and multiplier.
     * @param betAmount  Any denomination (USDC or token equivalent).
     * @param multiplier Multiplier ×100 (e.g. 250 = 2.5×).
     */
    function computePayout(uint256 betAmount, uint256 multiplier)
        internal pure returns (uint256)
    {
        return (betAmount * multiplier) / 100;
    }
}
