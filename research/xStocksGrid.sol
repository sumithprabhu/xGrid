// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../libraries/GridMath.sol";
import "../interfaces/IGridOracle.sol";

/**
 * @title xStocksGrid
 * @notice The core prediction market grid for tokenized equities.
 *
 * ═══════════════════════════════════════════════════════════
 *  HOW THE GRID WORKS
 * ═══════════════════════════════════════════════════════════
 *
 *  The grid is a 2D matrix anchored to the current price:
 *
 *       T+1    T+2    T+3    T+4    T+5
 *  +5   x1.8   x2.2   x2.8   x3.5   x4.2   ← above current
 *  +4   x1.6   x2.0   x2.5   x3.1   x3.8
 *  +3   x1.4   x1.8   x2.2   x2.7   x3.3
 *  +2   x1.3   x1.6   x2.0   x2.4   x2.9
 *  +1   x1.2   x1.4   x1.7   x2.1   x2.5
 *  [0]  ─ CURRENT PRICE ───────────────────
 *  -1   x1.2   x1.4   x1.7   x2.1   x2.5
 *  -2   x1.3   x1.6   x2.0   x2.4   x2.9
 *  ...
 *
 *  Each cell = "will xAAPL price TOUCH this level before bucket T+N expires?"
 *
 *  Resolution uses TOUCH semantics:
 *    → If price ever reaches the target level during the bucket, bet WINS
 *    → Uses oracle high/low range, not just end-of-bucket price
 *
 * ═══════════════════════════════════════════════════════════
 *  LIQUIDITY POOL
 * ═══════════════════════════════════════════════════════════
 *
 *  Losing bets → LiquidityPool
 *  Winning bets ← LiquidityPool
 *  Idle capital → Euler lending for yield
 *
 *  LP depositors earn:
 *    - houseEdgeBps share of all losing bets
 *    - Euler yield on idle capital
 *
 * ═══════════════════════════════════════════════════════════
 *  RISK CONTROLS
 * ═══════════════════════════════════════════════════════════
 *
 *  Per-token exposure cap:
 *    max_exposure = poolBalance × maxExposureRatio
 *    If bet would breach this → revert
 *
 *  Concentration limit:
 *    Single cell can't have > maxCellConcentration of pool
 *
 *  Market hours limits (from Tivnan paper — open/close dislocation):
 *    Opening 30min: min bet ×3, max bet ÷2
 *    Weekend: max bet = $10
 */
contract xStocksGrid {
    using GridMath for *;

    // ─── Errors ───────────────────────────────────────────────────────────────

    error InvalidToken();
    error InvalidBetAmount();
    error InvalidGridPosition();
    error ExposureLimitBreached();
    error BetNotResolved();
    error BetAlreadyClaimed();
    error BetLost();
    error OracleUnreliable();
    error MarketHoursRestriction();
    error PoolInsufficient();
    error NotOwner();
    error NotKeeper();
    error TokenAlreadyConfigured();
    error CellConcentrationLimit();

    // ─── Events ───────────────────────────────────────────────────────────────

    event BetPlaced(
        uint256 indexed betId,
        address indexed player,
        address indexed token,
        uint256 targetPrice,
        uint256 expiryTs,
        uint256 multiplier,       // scaled ×100
        uint256 amount,
        int8    direction,        // +1 up, -1 down
        int256  priceTicks,
        uint256 timeBuckets
    );

    event BetResolved(
        uint256 indexed betId,
        bool    won,
        uint256 payout
    );

    event LiquidityDeposited(address indexed lp, uint256 amount, uint256 shares);
    event LiquidityWithdrawn(address indexed lp, uint256 amount, uint256 shares);
    event YieldHarvested(uint256 amount);
    event TokenConfigured(address indexed token, string symbol);
    event EmergencyPause(bool paused);

    // ─── Data Structures ─────────────────────────────────────────────────────

    struct TokenConfig {
        bool    active;
        string  symbol;                  // "xAAPL"
        uint256 annualVolBps;            // 2500 = 25% annual volatility
        uint256 tickSizeUsdc;            // Price step per row (6 decimals USDC)
        uint256 bucketSeconds;           // Seconds per time column
        uint256 houseEdgeBps;            // Protocol take (1000 = 10%)
        uint256 maxBetUsdc;              // Per-bet cap (6 decimals)
        uint256 minBetUsdc;              // Minimum bet
        uint256 maxCellExposureUsdc;     // Max USDC at risk per cell
        uint256 maxTokenExposureBps;     // Max % of pool exposed to this token
        uint256 openBoostBps;            // Vol multiplier at open (25000 = 2.5×)
        uint256 closeBoostBps;           // Vol multiplier at close (18000 = 1.8×)
        uint256 afterHoursBps;           // Vol multiplier after hours (4000 = 0.4×)
    }

    struct Bet {
        address player;
        address token;
        uint256 amount;              // USDC wagered (6 decimals)
        uint256 multiplier;          // ×100 scale (200 = 2.00×)
        uint256 targetPrice;         // USDC 6 dec — price that must be touched
        uint256 placedTs;            // When bet was placed
        uint256 expiryTs;            // When bucket closes
        int256  priceTicks;          // Signed grid position (+up, -down)
        uint256 timeBuckets;         // Columns from current
        bool    resolved;
        bool    won;
        bool    claimed;
    }

    // Tracks aggregate exposure per token per expiry bucket
    struct BucketExposure {
        uint256 totalBetUsdc;    // Sum of all bets in this bucket
        uint256 maxPayoutUsdc;   // Sum of (bet × multiplier) — worst case payout
    }

    // ─── State ────────────────────────────────────────────────────────────────

    address public owner;
    address public keeper;
    bool    public paused;

    IERC20     public usdc;
    IGridOracle public oracle;
    address    public eulerMarket;      // Euler lending market for idle capital

    uint256 public nextBetId = 1;
    uint256 public totalPoolUsdc;       // Total USDC in pool (including Euler)
    uint256 public poolSharesTotal;     // Total LP shares outstanding
    uint256 public eulerDeposited;      // Amount currently in Euler

    // Minimum pool size before bets accepted (prevents drain attacks)
    uint256 public minPoolUsdc = 1_000e6; // $1,000

    mapping(address => TokenConfig) public tokenConfigs;
    mapping(uint256 => Bet)         public bets;

    // LP tracking
    mapping(address => uint256) public lpShares;

    // Exposure tracking: token → bucketExpiryTs → exposure
    mapping(address => mapping(uint256 => BucketExposure)) public bucketExposure;
    // Cell-level: token → cellKey → totalBetUsdc
    mapping(bytes32 => uint256) public cellBets;

    // Revenue accounting
    uint256 public totalHouseRevenue;
    uint256 public totalPayouts;
    uint256 public totalBetsPlaced;

    // ─── Constructor ─────────────────────────────────────────────────────────

    constructor(
        address _usdc,
        address _oracle,
        address _eulerMarket,
        address _keeper
    ) {
        owner       = msg.sender;
        usdc        = IERC20(_usdc);
        oracle      = IGridOracle(_oracle);
        eulerMarket = _eulerMarket;
        keeper      = _keeper;

        // Pre-approve Euler for max USDC
        if (_eulerMarket != address(0)) {
            IERC20(_usdc).approve(_eulerMarket, type(uint256).max);
        }
    }

    modifier onlyOwner()  { if (msg.sender != owner)  revert NotOwner();  _; }
    modifier onlyKeeper() { if (msg.sender != keeper && msg.sender != owner) revert NotKeeper(); _; }
    modifier notPaused()  { require(!paused, "Paused"); _; }

    // ─── Token Configuration ─────────────────────────────────────────────────

    /**
     * @notice Configure a new xStock token for the grid.
     * @param token          xStock token address.
     * @param symbol         Display symbol ("xAAPL").
     * @param annualVolBps   Annual σ in bps (AAPL=2500, TSLA=6500).
     * @param tickSizeUsdc   Price per grid row in USDC 6-dec (AAPL=50000 = $0.05).
     * @param bucketSeconds  Seconds per time column (30 or 60).
     */
    function configureToken(
        address token,
        string  calldata symbol,
        uint256 annualVolBps,
        uint256 tickSizeUsdc,
        uint256 bucketSeconds,
        uint256 houseEdgeBps,
        uint256 minBetUsdc,
        uint256 maxBetUsdc
    ) external onlyOwner {
        if (tokenConfigs[token].active) revert TokenAlreadyConfigured();

        tokenConfigs[token] = TokenConfig({
            active:               true,
            symbol:               symbol,
            annualVolBps:         annualVolBps,
            tickSizeUsdc:         tickSizeUsdc,
            bucketSeconds:        bucketSeconds,
            houseEdgeBps:         houseEdgeBps,
            maxBetUsdc:           maxBetUsdc,
            minBetUsdc:           minBetUsdc,
            maxCellExposureUsdc:  maxBetUsdc * 50,   // 50× max bet per cell
            maxTokenExposureBps:  3000,               // 30% of pool per token
            openBoostBps:         25000,              // 2.5× at open
            closeBoostBps:        18000,              // 1.8× at close
            afterHoursBps:        4000                // 0.4× after hours
        });

        emit TokenConfigured(token, symbol);
    }

    // ─── Core Bet Placement ───────────────────────────────────────────────────

    /**
     * @notice Place a bet on the grid.
     *
     * @param token         xStock token address.
     * @param priceTicks    Signed grid offset. +3 = 3 rows above current price.
     * @param timeBuckets   Column offset. 1 = nearest bucket.
     * @param amount        USDC to wager (6 decimals).
     *
     * @return betId  Unique bet identifier.
     * @return multiplier Payout multiplier ×100 (e.g. 250 = 2.5×).
     * @return targetPrice The exact USDC price that must be touched to win.
     */
    function placeBet(
        address token,
        int256  priceTicks,
        uint256 timeBuckets,
        uint256 amount
    ) external notPaused returns (
        uint256 betId,
        uint256 multiplier,
        uint256 targetPrice
    ) {
        // ── 1. Validate inputs ────────────────────────────────────────────────
        TokenConfig memory cfg = tokenConfigs[token];
        if (!cfg.active) revert InvalidToken();

        if (priceTicks == 0) revert InvalidGridPosition();
        if (timeBuckets == 0 || timeBuckets > 10) revert InvalidGridPosition();

        // ── 2. Get current price and market state ─────────────────────────────
        uint256 currentPrice = oracle.getPrice(token);
        (
            bool isOpen,
            bool isOpeningWindow,
            bool isClosingWindow,
            bool isAfterHours,
            bool isWeekend
        ) = oracle.getMarketState(token);

        // ── 3. Apply market-hours bet limits ─────────────────────────────────
        (uint256 effectiveMin, uint256 effectiveMax) = _applyMarketHourLimits(
            cfg.minBetUsdc,
            cfg.maxBetUsdc,
            isOpeningWindow,
            isAfterHours,
            isWeekend
        );

        if (amount < effectiveMin) revert InvalidBetAmount();
        if (amount > effectiveMax) revert InvalidBetAmount();

        // ── 4. Calculate target price ─────────────────────────────────────────
        // targetPrice = currentPrice ± (|priceTicks| × tickSize)
        if (priceTicks > 0) {
            targetPrice = currentPrice + uint256(priceTicks) * cfg.tickSizeUsdc;
        } else {
            uint256 downMove = uint256(-priceTicks) * cfg.tickSizeUsdc;
            require(downMove < currentPrice, "Target below zero");
            targetPrice = currentPrice - downMove;
        }

        // ── 5. Calculate multiplier using GridMath ────────────────────────────
        GridMath.VolatilityParams memory volParams = GridMath.VolatilityParams({
            annualVolBps:   cfg.annualVolBps,
            driftBps:       0,
            tickSizeUsdc:   cfg.tickSizeUsdc,
            bucketSeconds:  cfg.bucketSeconds,
            houseEdgeBps:   cfg.houseEdgeBps,
            openBoostBps:   cfg.openBoostBps,
            closeBoostBps:  cfg.closeBoostBps,
            afterHoursBps:  cfg.afterHoursBps
        });

        GridMath.MarketState memory mktState = GridMath.MarketState({
            isOpen:          isOpen,
            isOpeningWindow: isOpeningWindow,
            isClosingWindow: isClosingWindow,
            isAfterHours:    isAfterHours,
            isWeekend:       isWeekend
        });

        uint256 absTicks = priceTicks > 0 ? uint256(priceTicks) : uint256(-priceTicks);
        uint256 probability;
        (multiplier, probability) = GridMath.calculateMultiplier(
            absTicks,
            timeBuckets,
            currentPrice,
            volParams,
            mktState
        );

        // ── 6. Risk checks ────────────────────────────────────────────────────
        uint256 potentialPayout = GridMath.computePayout(amount, multiplier);

        _checkExposureLimits(token, cfg, timeBuckets, cfg.bucketSeconds, amount, potentialPayout);

        // ── 7. Cell concentration check ───────────────────────────────────────
        bytes32 cellKey = _cellKey(token, priceTicks, timeBuckets, cfg.bucketSeconds);
        if (cellBets[cellKey] + amount > cfg.maxCellExposureUsdc) {
            revert CellConcentrationLimit();
        }
        cellBets[cellKey] += amount;

        // ── 8. Calculate expiry ───────────────────────────────────────────────
        uint256 expiryTs = _computeExpiry(timeBuckets, cfg.bucketSeconds);

        // ── 9. Update bucket exposure tracking ───────────────────────────────
        BucketExposure storage exp = bucketExposure[token][expiryTs];
        exp.totalBetUsdc  += amount;
        exp.maxPayoutUsdc += potentialPayout;

        // ── 10. Record bet ────────────────────────────────────────────────────
        betId = nextBetId++;
        bets[betId] = Bet({
            player:       msg.sender,
            token:        token,
            amount:       amount,
            multiplier:   multiplier,
            targetPrice:  targetPrice,
            placedTs:     block.timestamp,
            expiryTs:     expiryTs,
            priceTicks:   priceTicks,
            timeBuckets:  timeBuckets,
            resolved:     false,
            won:          false,
            claimed:      false
        });

        // ── 11. Collect USDC from player ──────────────────────────────────────
        usdc.transferFrom(msg.sender, address(this), amount);
        totalPoolUsdc += amount;
        totalBetsPlaced++;

        // ── 12. Deploy idle capital to Euler ──────────────────────────────────
        _rebalanceToEuler();

        emit BetPlaced(
            betId, msg.sender, token, targetPrice, expiryTs,
            multiplier, amount,
            priceTicks > 0 ? int8(1) : int8(-1),
            priceTicks, timeBuckets
        );
    }

    // ─── Resolution ───────────────────────────────────────────────────────────

    /**
     * @notice Resolve a bet after its expiry bucket has closed.
     *         Uses TOUCH semantics: wins if price ever reached target during bucket.
     *         Called by keeper or anyone after expiryTs.
     */
    function resolveBet(uint256 betId) external {
        Bet storage bet = bets[betId];

        require(bet.player != address(0), "Bet not found");
        require(!bet.resolved, "Already resolved");
        require(block.timestamp >= bet.expiryTs, "Not expired");

        // Get price range during the bet's bucket window
        (uint256 high, uint256 low) = oracle.getPriceRange(
            bet.token,
            bet.placedTs,
            bet.expiryTs
        );

        // TOUCH resolution: did price ever reach the target?
        bool won;
        if (bet.priceTicks > 0) {
            // Upward bet: wins if high >= targetPrice
            won = high >= bet.targetPrice;
        } else {
            // Downward bet: wins if low <= targetPrice
            won = low <= bet.targetPrice;
        }

        bet.resolved = true;
        bet.won      = won;

        // Update cell tracking
        bytes32 cellKey = _cellKey(bet.token, bet.priceTicks, bet.timeBuckets, tokenConfigs[bet.token].bucketSeconds);
        if (cellBets[cellKey] >= bet.amount) {
            cellBets[cellKey] -= bet.amount;
        }

        if (won) {
            // Pre-compute payout so we can emit it
            uint256 payout = GridMath.computePayout(bet.amount, bet.multiplier);
            emit BetResolved(betId, true, payout);
        } else {
            // Losing bet: amount stays in pool as house revenue
            totalHouseRevenue += bet.amount;
            emit BetResolved(betId, false, 0);
        }
    }

    /**
     * @notice Batch resolve multiple bets (gas efficient for keeper).
     */
    function resolveBets(uint256[] calldata betIds) external {
        for (uint256 i = 0; i < betIds.length; i++) {
            // Individual resolve with try-catch logic via checking conditions
            Bet storage bet = bets[betIds[i]];
            if (bet.player == address(0)) continue;
            if (bet.resolved) continue;
            if (block.timestamp < bet.expiryTs) continue;
            this.resolveBet(betIds[i]);
        }
    }

    // ─── Claiming ─────────────────────────────────────────────────────────────

    /**
     * @notice Claim winnings for a resolved winning bet.
     */
    function claimWinnings(uint256 betId) external {
        Bet storage bet = bets[betId];

        require(bet.player == msg.sender, "Not your bet");
        if (!bet.resolved)  revert BetNotResolved();
        if (bet.claimed)    revert BetAlreadyClaimed();
        if (!bet.won)       revert BetLost();

        bet.claimed = true;

        uint256 payout = GridMath.computePayout(bet.amount, bet.multiplier);

        // Withdraw from Euler if needed
        _ensureLiquidity(payout);

        require(totalPoolUsdc >= payout, "Pool insufficient");
        totalPoolUsdc -= payout;
        totalPayouts  += payout;

        usdc.transfer(msg.sender, payout);
    }

    /**
     * @notice Claim multiple bets in one tx.
     */
    function claimMultiple(uint256[] calldata betIds) external {
        uint256 totalPayout;

        for (uint256 i = 0; i < betIds.length; i++) {
            Bet storage bet = bets[betIds[i]];
            if (bet.player != msg.sender) continue;
            if (!bet.resolved || bet.claimed || !bet.won) continue;

            bet.claimed = true;
            totalPayout += GridMath.computePayout(bet.amount, bet.multiplier);
        }

        require(totalPayout > 0, "Nothing to claim");
        _ensureLiquidity(totalPayout);
        require(totalPoolUsdc >= totalPayout, "Pool insufficient");

        totalPoolUsdc -= totalPayout;
        totalPayouts  += totalPayout;
        usdc.transfer(msg.sender, totalPayout);
    }

    // ─── Liquidity Pool ───────────────────────────────────────────────────────

    /**
     * @notice Deposit USDC to the liquidity pool and receive LP shares.
     *         LP earns: house edge revenue + Euler yield.
     *
     * Shares are calculated using pool NAV:
     *   shares = amount × totalShares / totalPoolUsdc
     *   (first depositor gets 1:1 shares)
     */
    function depositLiquidity(uint256 amount) external notPaused {
        require(amount >= 10e6, "Min deposit $10");
        usdc.transferFrom(msg.sender, address(this), amount);

        uint256 shares;
        if (poolSharesTotal == 0 || totalPoolUsdc == 0) {
            // First depositor: 1:1 ratio
            shares = amount;
        } else {
            // Proportional shares based on current NAV
            shares = (amount * poolSharesTotal) / totalPoolUsdc;
        }

        lpShares[msg.sender] += shares;
        poolSharesTotal       += shares;
        totalPoolUsdc         += amount;

        _rebalanceToEuler();

        emit LiquidityDeposited(msg.sender, amount, shares);
    }

    /**
     * @notice Withdraw USDC from the pool by burning LP shares.
     *
     * Amount = shares × totalPoolUsdc / totalShares
     * (includes accrued yield and house revenue)
     */
    function withdrawLiquidity(uint256 shares) external {
        require(lpShares[msg.sender] >= shares, "Insufficient shares");
        require(poolSharesTotal > 0, "No shares");

        // Calculate proportional USDC to return
        uint256 amount = (shares * totalPoolUsdc) / poolSharesTotal;

        // Check liquidity isn't locked by open bets
        // (simplified — in production check against max exposure)
        _ensureLiquidity(amount);

        lpShares[msg.sender] -= shares;
        poolSharesTotal       -= shares;
        totalPoolUsdc         -= amount;

        usdc.transfer(msg.sender, amount);

        emit LiquidityWithdrawn(msg.sender, amount, shares);
    }

    /**
     * @notice Current NAV per LP share (USDC, 6 decimals).
     */
    function shareNAV() external view returns (uint256) {
        if (poolSharesTotal == 0) return 1e6; // $1 initial NAV
        return (totalPoolUsdc * 1e6) / poolSharesTotal;
    }

    // ─── Euler Integration ────────────────────────────────────────────────────

    /**
     * @notice Deploy idle capital to Euler to earn yield.
     *         Keeps 20% of pool in contract for immediate liquidity.
     */
    function _rebalanceToEuler() internal {
        if (eulerMarket == address(0)) return;

        uint256 contractBalance = usdc.balanceOf(address(this));
        uint256 targetOnChain   = totalPoolUsdc / 5; // 20% kept liquid

        if (contractBalance > targetOnChain + 1e6) {
            uint256 toDeposit = contractBalance - targetOnChain;
            // IEulerLending(eulerMarket).deposit(0, toDeposit);
            // eulerDeposited += toDeposit;
            // (Euler integration stubbed for hackathon — uncomment in production)
        }
    }

    /**
     * @notice Withdraw from Euler if contract balance insufficient.
     */
    function _ensureLiquidity(uint256 needed) internal {
        uint256 available = usdc.balanceOf(address(this));
        if (available >= needed) return;

        uint256 shortfall = needed - available;
        if (eulerMarket != address(0) && eulerDeposited >= shortfall) {
            // IEulerLending(eulerMarket).withdraw(0, shortfall);
            // eulerDeposited -= shortfall;
        }
    }

    // ─── Risk Controls ────────────────────────────────────────────────────────

    function _checkExposureLimits(
        address token,
        TokenConfig memory cfg,
        uint256 timeBuckets,
        uint256 bucketSeconds,
        uint256 betAmount,
        uint256 potentialPayout
    ) internal view {
        // 1. Pool must be adequately capitalized
        require(totalPoolUsdc >= minPoolUsdc, "Pool too small");

        // 2. Token exposure: total potential payout for this token ≤ X% of pool
        uint256 expiryTs = _computeExpiry(timeBuckets, bucketSeconds);
        BucketExposure memory exp = bucketExposure[token][expiryTs];

        uint256 newMaxPayout = exp.maxPayoutUsdc + potentialPayout;
        uint256 maxAllowed   = (totalPoolUsdc * cfg.maxTokenExposureBps) / 10_000;

        if (newMaxPayout > maxAllowed) revert ExposureLimitBreached();

        // 3. Single bet can't exceed 5% of pool
        if (betAmount > totalPoolUsdc / 20) revert ExposureLimitBreached();
    }

    function _applyMarketHourLimits(
        uint256 minBet,
        uint256 maxBet,
        bool isOpeningWindow,
        bool isAfterHours,
        bool isWeekend
    ) internal pure returns (uint256 effectiveMin, uint256 effectiveMax) {
        effectiveMin = minBet;
        effectiveMax = maxBet;

        if (isWeekend) {
            // Weekend: very small bets only
            effectiveMax = 10e6; // $10 max
        } else if (isAfterHours) {
            // After hours: reduced
            effectiveMax = maxBet / 2;
        } else if (isOpeningWindow) {
            // High dislocation window: raise min, reduce max
            effectiveMin = minBet * 3;
            effectiveMax = maxBet / 2;
        }
    }

    // ─── Utility Functions ────────────────────────────────────────────────────

    function _computeExpiry(uint256 timeBuckets, uint256 bucketSeconds)
        internal view returns (uint256)
    {
        // Align to bucket boundaries
        uint256 bucketStart = (block.timestamp / bucketSeconds) * bucketSeconds;
        return bucketStart + (timeBuckets * bucketSeconds);
    }

    function _cellKey(
        address token,
        int256  priceTicks,
        uint256 timeBuckets,
        uint256 bucketSeconds
    ) internal view returns (bytes32) {
        uint256 expiryTs = _computeExpiry(timeBuckets, bucketSeconds);
        return keccak256(abi.encode(token, priceTicks, expiryTs));
    }

    // ─── View Functions ───────────────────────────────────────────────────────

    /**
     * @notice Preview what multiplier a bet would get (for frontend).
     */
    function previewMultiplier(
        address token,
        int256  priceTicks,
        uint256 timeBuckets
    ) external view returns (
        uint256 multiplier,
        uint256 probability,
        uint256 targetPrice,
        uint256 potentialPayout100USDC
    ) {
        TokenConfig memory cfg = tokenConfigs[token];
        if (!cfg.active) return (0, 0, 0, 0);

        uint256 currentPrice = oracle.getPrice(token);
        (bool isOpen, bool isOpeningWindow, bool isClosingWindow, bool isAfterHours, bool isWeekend)
            = oracle.getMarketState(token);

        GridMath.VolatilityParams memory vp = GridMath.VolatilityParams({
            annualVolBps:  cfg.annualVolBps,
            driftBps:      0,
            tickSizeUsdc:  cfg.tickSizeUsdc,
            bucketSeconds: cfg.bucketSeconds,
            houseEdgeBps:  cfg.houseEdgeBps,
            openBoostBps:  cfg.openBoostBps,
            closeBoostBps: cfg.closeBoostBps,
            afterHoursBps: cfg.afterHoursBps
        });
        GridMath.MarketState memory ms = GridMath.MarketState({
            isOpen: isOpen, isOpeningWindow: isOpeningWindow,
            isClosingWindow: isClosingWindow,
            isAfterHours: isAfterHours, isWeekend: isWeekend
        });

        uint256 absTicks = priceTicks > 0 ? uint256(priceTicks) : uint256(-priceTicks);
        (multiplier, probability) = GridMath.calculateMultiplier(absTicks, timeBuckets, currentPrice, vp, ms);

        if (priceTicks > 0) {
            targetPrice = currentPrice + absTicks * cfg.tickSizeUsdc;
        } else {
            targetPrice = currentPrice - absTicks * cfg.tickSizeUsdc;
        }

        potentialPayout100USDC = GridMath.computePayout(100e6, multiplier);
    }

    /**
     * @notice Get full grid multiplier matrix (for frontend rendering).
     * @param token         xStock token.
     * @param rows          Number of rows above/below (e.g. 6).
     * @param cols          Number of columns (time buckets, e.g. 5).
     * @return multipliers  2D array [row][col], rows: -rows to +rows, col: 1 to cols
     *                      Each value ×100 (200 = 2.0×)
     */
    function getGridMatrix(address token, uint256 rows, uint256 cols)
        external view
        returns (uint256[][] memory multipliers, uint256[] memory prices)
    {
        TokenConfig memory cfg = tokenConfigs[token];
        uint256 currentPrice = oracle.getPrice(token);

        uint256 totalRows = rows * 2 + 1; // -rows to +rows (skipping 0)
        multipliers = new uint256[][](totalRows);
        prices = new uint256[](totalRows);

        (bool isOpen, bool isOpeningWindow, bool isClosingWindow, bool isAfterHours, bool isWeekend)
            = oracle.getMarketState(token);

        GridMath.VolatilityParams memory vp = GridMath.VolatilityParams({
            annualVolBps: cfg.annualVolBps, driftBps: 0,
            tickSizeUsdc: cfg.tickSizeUsdc, bucketSeconds: cfg.bucketSeconds,
            houseEdgeBps: cfg.houseEdgeBps, openBoostBps: cfg.openBoostBps,
            closeBoostBps: cfg.closeBoostBps, afterHoursBps: cfg.afterHoursBps
        });
        GridMath.MarketState memory ms = GridMath.MarketState({
            isOpen: isOpen, isOpeningWindow: isOpeningWindow,
            isClosingWindow: isClosingWindow, isAfterHours: isAfterHours,
            isWeekend: isWeekend
        });

        uint256 rowIdx = 0;
        for (int256 tick = int256(rows); tick >= -int256(rows); tick--) {
            if (tick == 0) { rowIdx++; continue; }

            multipliers[rowIdx] = new uint256[](cols);
            uint256 absTick = tick > 0 ? uint256(tick) : uint256(-tick);
            prices[rowIdx] = tick > 0
                ? currentPrice + absTick * cfg.tickSizeUsdc
                : currentPrice - absTick * cfg.tickSizeUsdc;

            for (uint256 col = 1; col <= cols; col++) {
                (uint256 mult,) = GridMath.calculateMultiplier(absTick, col, currentPrice, vp, ms);
                multipliers[rowIdx][col-1] = mult;
            }
            rowIdx++;
        }
    }

    /**
     * @notice Get a player's bet history.
     */
    function getPlayerBets(address player, uint256 fromBetId, uint256 count)
        external view
        returns (Bet[] memory result)
    {
        result = new Bet[](count);
        uint256 found = 0;
        for (uint256 i = fromBetId; i < nextBetId && found < count; i++) {
            if (bets[i].player == player) {
                result[found++] = bets[i];
            }
        }
    }

    // ─── Admin ────────────────────────────────────────────────────────────────

    function setPaused(bool _paused) external onlyOwner {
        paused = _paused;
        emit EmergencyPause(_paused);
    }

    function setKeeper(address _keeper) external onlyOwner {
        keeper = _keeper;
    }

    function setMinPool(uint256 _min) external onlyOwner {
        minPoolUsdc = _min;
    }

    function updateTokenVol(address token, uint256 newVolBps) external onlyOwner {
        require(tokenConfigs[token].active, "Token not configured");
        tokenConfigs[token].annualVolBps = newVolBps;
    }

    // Emergency withdrawal (only if fully paused)
    function emergencyWithdraw(address to) external onlyOwner {
        require(paused, "Must pause first");
        uint256 bal = usdc.balanceOf(address(this));
        usdc.transfer(to, bal);
    }
}
