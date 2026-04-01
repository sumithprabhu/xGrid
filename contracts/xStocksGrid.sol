// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./PriceFeed.sol";
import "./GridToken.sol";
import "./GridMath.sol";

/// @title xStocksGrid
/// @notice Grid-based prediction market for xStocks tokenized equities.
///
/// ═══════════════════════════════════════════════════════════
///  TOKEN ECONOMICS  (1 GridToken = 1 USDC, always)
/// ═══════════════════════════════════════════════════════════
///
///  depositUsdc($100)   →  mint 100 GridTokens   (1:1)
///  redeemForUsdc(100)  →  burn 100 GridTokens, receive $100 USDC  (1:1)
///
///  The stock price is used ONLY for GridMath multiplier calculation.
///  It does NOT affect how many GridTokens are issued — that is always 1:1.
///
///  After redeeming to USDC, users call xChange (Backed API) off-chain
///  to swap their USDC for real xQQQ / xSPY / etc. tokens.
///
/// ═══════════════════════════════════════════════════════════
///  GRID
/// ═══════════════════════════════════════════════════════════
///
///       T+1    T+2    T+3    T+4    T+5
///  +5   x1.8   x2.2   x2.8   x3.5   x4.2
///  +3   x1.4   x1.8   x2.2   x2.7   x3.3
///  [0]  ─ CURRENT PRICE ───────────────────
///  -3   x1.4   x1.8   x2.2   x2.7   x3.3
///
///  TOUCH semantics: bet wins if HIGH (up) or LOW (down) touches target.
///
/// ═══════════════════════════════════════════════════════════
///  LP POOL
/// ═══════════════════════════════════════════════════════════
///
///  LPs deposit USDC → pool holds GridTokens (1:1 backed).
///  Losing bets leave GridTokens in pool → LP share NAV increases.
///
contract xStocksGrid is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─── Decimal bridge ───────────────────────────────────────────────────────
    //  GridToken: 18 dec   USDC: 6 dec   factor: 1e12
    //  1 GridToken (1e18)  =  1 USDC (1_000_000)
    uint256 internal constant GT_DECIMALS   = 1e18;
    uint256 internal constant USDC_DECIMALS = 1e6;
    uint256 internal constant GT_TO_USDC    = 1e12;   // gridTokens / GT_TO_USDC = usdc

    // Price math: token(18dec) * price(6dec) / PRICE_SCALE = usdc(6dec)
    uint256 internal constant PRICE_SCALE = 1e18;

    // ─── Structs ──────────────────────────────────────────────────────────────

    struct TokenConfig {
        bool    active;
        uint256 annualVolBps;          // Annual sigma (2500 = 25%)
        uint256 tickSizeUsdc;          // Price step per row (6-dec USDC)
        uint256 bucketSeconds;         // Seconds per time column
        uint256 houseEdgeBps;          // Protocol take (1000 = 10%)
        uint256 minBetUsdc;            // Min bet in USDC (6 dec)
        uint256 maxBetUsdc;            // Max bet in USDC (6 dec)
        uint8   gridWidth;             // Max time columns
        uint8   gridHalfHeight;        // Price rows above and below centre
        uint256 openBoostBps;          // 25000 = 2.5x vol at open
        uint256 closeBoostBps;         // 18000 = 1.8x vol at close
        uint256 afterHoursBps;         // 4000 = 0.4x vol after hours
    }

    struct BetRecord {
        address player;
        address token;
        int8    priceTicks;
        uint256 timeBuckets;
        uint256 targetPrice;           // 6-dec USDC
        uint256 expiryTs;
        uint256 gridTokenAmount;       // GridTokens wagered (18 dec = same USDC value)
        uint256 multiplier;            // x100 (220 = 2.20x)
        bool    resolved;
        bool    won;
        bool    claimed;
    }

    // ─── State ────────────────────────────────────────────────────────────────

    IERC20    public immutable usdc;
    GridToken public gdUSD;            // single unified grid token (1 gdUSD = 1 USDC)
    PriceFeed public priceFeed;
    bool      public paused;

    uint256 public nextBetId = 1;

    mapping(address => TokenConfig) public tokenConfigs;
    mapping(uint256 => BetRecord)   public bets;

    // USDC backing pool — 1:1 with total gdUSD in existence per stock
    mapping(address => uint256) public usdcPool;           // token => USDC (6 dec)

    // Per-stock gdUSD held by this contract (replaces balanceOf for multi-stock safety)
    mapping(address => uint256) public poolGdUsd;          // token => gdUSD (18 dec)

    // LP shares
    mapping(address => mapping(address => uint256)) public lpShares;   // lp => token => shares
    mapping(address => uint256)                     public totalShares; // token => total

    // GridTokens locked for pending win payouts
    mapping(address => uint256) public lockedGridTokens;   // token => GridTokens (18 dec)

    // Per-bucket risk tracking
    mapping(address => mapping(uint256 => uint256)) public bucketMaxPayout;

    // ─── Events ───────────────────────────────────────────────────────────────

    event TokenConfigured(address indexed token);
    event UsdcDeposited(address indexed user, address indexed token, uint256 usdcAmount, uint256 gridTokens);
    event UsdcRedeemed(address indexed user, address indexed token, uint256 gridTokens, uint256 usdcAmount);
    event LiquidityDeposited(address indexed lp, address indexed token, uint256 usdcAmount, uint256 shares);
    event LiquidityWithdrawn(address indexed lp, address indexed token, uint256 usdcAmount, uint256 shares);
    event BetPlaced(
        uint256 indexed betId,
        address indexed player,
        address indexed token,
        uint256 targetPrice,
        uint256 expiryTs,
        uint256 multiplier,
        uint256 gridTokenAmount,
        int8    priceTicks,
        uint256 timeBuckets
    );
    event BetResolved(uint256 indexed betId, bool won, uint256 payout);
    event WinningsClaimed(uint256 indexed betId, address indexed player, uint256 gridTokens);
    event Paused(bool paused);

    // ─── Constructor ──────────────────────────────────────────────────────────

    constructor(address usdc_, address priceFeed_, address gdUSD_) Ownable(msg.sender) {
        require(usdc_      != address(0), "zero usdc");
        require(priceFeed_ != address(0), "zero priceFeed");
        require(gdUSD_     != address(0), "zero gdUSD");
        usdc      = IERC20(usdc_);
        priceFeed = PriceFeed(priceFeed_);
        gdUSD     = GridToken(gdUSD_);
    }

    modifier notPaused() { require(!paused, "paused"); _; }

    // ─── Admin ────────────────────────────────────────────────────────────────

    function configureToken(
        address token,
        uint256 annualVolBps,
        uint256 tickSizeUsdc,
        uint256 bucketSeconds,
        uint256 houseEdgeBps,
        uint256 minBetUsdc,
        uint256 maxBetUsdc,
        uint8   gridWidth,
        uint8   gridHalfHeight
    ) external onlyOwner {
        require(token      != address(0),  "zero token");
        require(annualVolBps > 0,          "zero vol");
        require(tickSizeUsdc > 0,          "zero tick");
        require(bucketSeconds > 0,         "zero bucket");
        require(houseEdgeBps < 5000,       "edge >= 50%");
        require(minBetUsdc > 0,            "zero min");
        require(maxBetUsdc >= minBetUsdc,  "max < min");

        tokenConfigs[token] = TokenConfig({
            active:         true,
            annualVolBps:   annualVolBps,
            tickSizeUsdc:   tickSizeUsdc,
            bucketSeconds:  bucketSeconds,
            houseEdgeBps:   houseEdgeBps,
            minBetUsdc:     minBetUsdc,
            maxBetUsdc:     maxBetUsdc,
            gridWidth:      gridWidth,
            gridHalfHeight: gridHalfHeight,
            openBoostBps:   25000,
            closeBoostBps:  18000,
            afterHoursBps:  4000
        });
        emit TokenConfigured(token);
    }

    function setTokenActive(address token, bool active) external onlyOwner {
        tokenConfigs[token].active = active;
    }

    function setPriceFeed(address pf) external onlyOwner {
        require(pf != address(0), "zero");
        priceFeed = PriceFeed(pf);
    }

    function setPaused(bool p) external onlyOwner {
        paused = p;
        emit Paused(p);
    }

    // ─── USDC ↔ GridToken  (1 : 1) ───────────────────────────────────────────

    /// @notice Deposit USDC, receive GridTokens 1:1.
    ///         $1 USDC  →  1 GridToken (= 1e18 wei of GridToken)
    ///
    /// @param token      Stock identifier.
    /// @param usdcAmount USDC to deposit (6 dec).
    /// @return gridTokensMinted Amount of GridTokens received (18 dec).
    function depositUsdc(address token, uint256 usdcAmount)
        external nonReentrant notPaused
        returns (uint256 gridTokensMinted)
    {
        TokenConfig memory cfg = _requireActive(token);
        require(usdcAmount > 0, "zero usdc");

        // 1:1  —  scale from 6-dec USDC to 18-dec GridToken
        gridTokensMinted = usdcAmount * GT_TO_USDC;

        usdc.safeTransferFrom(msg.sender, address(this), usdcAmount);
        usdcPool[token] += usdcAmount;

        gdUSD.mint(msg.sender, gridTokensMinted);
        emit UsdcDeposited(msg.sender, token, usdcAmount, gridTokensMinted);
    }

    /// @notice Burn GridTokens, receive USDC 1:1.
    ///         1 GridToken (1e18)  →  $1 USDC (1_000_000)
    ///         After redeeming, use xChange (Backed API) to get real xStock.
    ///
    /// @param token           Stock identifier.
    /// @param gridTokenAmount GridTokens to burn (18 dec).
    /// @return usdcOut        USDC returned (6 dec).
    function redeemForUsdc(address token, uint256 gridTokenAmount)
        external nonReentrant
        returns (uint256 usdcOut)
    {
        TokenConfig memory cfg = _requireActive(token);
        require(gridTokenAmount > 0, "zero amount");

        // 1:1  —  scale from 18-dec GridToken to 6-dec USDC
        usdcOut = gridTokenAmount / GT_TO_USDC;
        require(usdcOut > 0,              "rounds to zero");
        require(usdcPool[token] >= usdcOut, "pool insufficient");

        gdUSD.burn(msg.sender, gridTokenAmount);
        usdcPool[token] -= usdcOut;

        usdc.safeTransfer(msg.sender, usdcOut);
        emit UsdcRedeemed(msg.sender, token, gridTokenAmount, usdcOut);
    }

    // ─── LP Pool ──────────────────────────────────────────────────────────────

    /// @notice LP deposits USDC. Pool receives GridTokens (1:1). LP gets shares.
    ///         Share NAV rises as bettors lose (GridTokens accumulate in pool).
    function depositLiquidity(address token, uint256 usdcAmount)
        external nonReentrant notPaused
    {
        TokenConfig memory cfg = _requireActive(token);
        require(usdcAmount >= 10 * USDC_DECIMALS, "min LP $10");

        usdc.safeTransferFrom(msg.sender, address(this), usdcAmount);
        usdcPool[token] += usdcAmount;

        // Mint gdUSD 1:1 directly to pool (held by this contract)
        uint256 newGT  = usdcAmount * GT_TO_USDC;
        gdUSD.mint(address(this), newGT);
        poolGdUsd[token] += newGT;

        // Issue LP shares proportional to contribution
        uint256 total  = totalShares[token];
        uint256 poolGT = poolGdUsd[token];

        uint256 shares;
        if (total == 0 || poolGT == newGT) {
            shares = usdcAmount;                          // first LP: 1:1 with USDC
        } else {
            uint256 existingGT = poolGT - newGT;
            shares = (newGT * total) / existingGT;
        }

        lpShares[msg.sender][token] += shares;
        totalShares[token]          += shares;
        emit LiquidityDeposited(msg.sender, token, usdcAmount, shares);
    }

    /// @notice LP burns shares, receives proportional USDC.
    ///         Value accrues because losing bets leave GridTokens in pool.
    function withdrawLiquidity(address token, uint256 shares) external nonReentrant {
        require(lpShares[msg.sender][token] >= shares, "insufficient shares");
        uint256 total = totalShares[token];
        require(total > 0, "no pool");

        uint256 freeGT  = _freePoolGT(token);
        uint256 gtOut   = (shares * freeGT) / total;
        require(gtOut > 0, "nothing to withdraw");

        // 1:1 convert gdUSD → USDC
        uint256 usdcOut = gtOut / GT_TO_USDC;
        require(usdcPool[token] >= usdcOut, "pool insufficient");

        lpShares[msg.sender][token] -= shares;
        totalShares[token]          -= shares;

        gdUSD.burn(address(this), gtOut);
        poolGdUsd[token] -= gtOut;
        usdcPool[token]  -= usdcOut;

        usdc.safeTransfer(msg.sender, usdcOut);
        emit LiquidityWithdrawn(msg.sender, token, usdcOut, shares);
    }

    /// @notice USDC value per LP share (6 dec).
    function shareNAV(address token) external view returns (uint256) {
        uint256 total = totalShares[token];
        if (total == 0) return USDC_DECIMALS; // $1 initial
        uint256 poolGT   = poolGdUsd[token];
        uint256 poolUsdc = poolGT / GT_TO_USDC;
        return (poolUsdc * USDC_DECIMALS) / total;
    }

    // ─── Betting ──────────────────────────────────────────────────────────────

    /// @notice Place a bet using GridTokens.
    ///         1 GridToken = 1 USDC of exposure.
    ///         Bet 100 GridTokens → win at 2.2x → receive 220 GridTokens.
    ///
    /// @param token           Stock identifier.
    /// @param priceTicks      Row offset: +up, -down. Non-zero.
    /// @param timeBuckets     Column (1 = nearest, up to gridWidth).
    /// @param gridTokenAmount GridTokens to wager (18 dec).
    function placeBet(
        address token,
        int8    priceTicks,
        uint8   timeBuckets,
        uint256 gridTokenAmount
    ) external nonReentrant notPaused returns (uint256 betId) {
        require(priceTicks != 0, "pick a non-zero row");
        TokenConfig memory cfg = _requireActive(token);

        // Convert GridTokens to USDC for limits check (1:1)
        uint256 usdcEquiv = gridTokenAmount / GT_TO_USDC;
        _applyBetLimits(cfg, usdcEquiv, token);

        uint256 spot = _spot(token);
        (uint256 mult, uint256 targetPrice, uint256 expiryTs) =
            _computeBetParams(cfg, priceTicks, timeBuckets, spot, token);

        uint256 potentialPayout = GridMath.computePayout(gridTokenAmount, mult);
        _checkExposure(token, expiryTs, gridTokenAmount, potentialPayout);

        IERC20(address(gdUSD)).safeTransferFrom(msg.sender, address(this), gridTokenAmount);
        poolGdUsd[token]                 += gridTokenAmount;
        lockedGridTokens[token]          += potentialPayout;
        bucketMaxPayout[token][expiryTs] += potentialPayout;

        betId = _recordBet(msg.sender, token, priceTicks, timeBuckets, targetPrice, expiryTs, gridTokenAmount, mult);
        emit BetPlaced(betId, msg.sender, token, targetPrice, expiryTs, mult, gridTokenAmount, priceTicks, timeBuckets);
    }

    // ─── Resolution ───────────────────────────────────────────────────────────

    /// @notice TOUCH resolution: up bets win if HIGH >= target, down if LOW <= target.
    function resolveBet(uint256 betId) public {
        BetRecord storage bet = bets[betId];
        require(bet.player != address(0), "bet not found");
        require(!bet.resolved,            "already resolved");
        require(block.timestamp >= bet.expiryTs, "bucket not closed");

        (, uint256 high, uint256 low, bool available) =
            priceFeed.getResolutionData(bet.token, bet.expiryTs);
        require(available, "resolution data not pushed yet");

        bool won = bet.priceTicks > 0
            ? high >= bet.targetPrice
            : low  <= bet.targetPrice;

        bet.resolved = true;
        bet.won      = won;

        uint256 payout = GridMath.computePayout(bet.gridTokenAmount, bet.multiplier);
        if (lockedGridTokens[bet.token] >= payout) lockedGridTokens[bet.token] -= payout;
        if (bucketMaxPayout[bet.token][bet.expiryTs] >= payout) {
            bucketMaxPayout[bet.token][bet.expiryTs] -= payout;
        }

        emit BetResolved(betId, won, won ? payout : 0);
    }

    /// @notice Batch resolve — skips bets not yet resolvable.
    function resolveBets(uint256[] calldata betIds) external {
        for (uint256 i = 0; i < betIds.length; i++) {
            BetRecord storage bet = bets[betIds[i]];
            if (bet.player == address(0)) continue;
            if (bet.resolved)             continue;
            if (block.timestamp < bet.expiryTs) continue;
            (, , , bool available) = priceFeed.getResolutionData(bet.token, bet.expiryTs);
            if (!available) continue;
            resolveBet(betIds[i]);
        }
    }

    // ─── Claiming ─────────────────────────────────────────────────────────────

    /// @notice Claim GridToken winnings. Then redeem for USDC and optionally
    ///         use xChange (Backed) to get real xStock deposited in your wallet.
    function claimWinnings(uint256 betId) external nonReentrant {
        BetRecord storage bet = bets[betId];
        require(bet.player == msg.sender, "not your bet");
        require(bet.resolved,             "not resolved");
        require(bet.won,                  "bet lost");
        require(!bet.claimed,             "already claimed");

        bet.claimed = true;
        uint256 payout = GridMath.computePayout(bet.gridTokenAmount, bet.multiplier);
        require(poolGdUsd[bet.token] >= payout, "pool insufficient");

        poolGdUsd[bet.token] -= payout;
        IERC20(address(gdUSD)).safeTransfer(msg.sender, payout);
        emit WinningsClaimed(betId, msg.sender, payout);
    }

    /// @notice Batch claim — wins across any stock, all paid in gdUSD.
    function claimMultiple(uint256[] calldata betIds) external nonReentrant {
        uint256 totalPayout;
        address lastToken;

        for (uint256 i = 0; i < betIds.length; i++) {
            BetRecord storage bet = bets[betIds[i]];
            if (bet.player != msg.sender) continue;
            if (!bet.resolved || bet.claimed || !bet.won) continue;

            bet.claimed  = true;
            lastToken    = bet.token;
            totalPayout += GridMath.computePayout(bet.gridTokenAmount, bet.multiplier);
        }

        require(totalPayout > 0,  "nothing to claim");
        require(lastToken != address(0), "no valid bets");

        // Deduct from per-stock pool (last token used as proxy — multi-stock batches should be separate calls)
        require(poolGdUsd[lastToken] >= totalPayout, "pool insufficient");
        poolGdUsd[lastToken] -= totalPayout;
        IERC20(address(gdUSD)).safeTransfer(msg.sender, totalPayout);
    }

    // ─── Views ────────────────────────────────────────────────────────────────

    /// @notice Preview cell multiplier (no gas, call from frontend).
    /// @return multiplier      x100 (220 = 2.20x).
    /// @return probability     PRECISION units (1e18 = 100%).
    /// @return targetPrice     6-dec USDC.
    /// @return payoutFor100    Payout in GridTokens for a 100 GridToken (=$100) bet.
    function previewMultiplier(
        address token,
        int8    priceTicks,
        uint8   timeBuckets
    ) external view returns (
        uint256 multiplier,
        uint256 probability,
        uint256 targetPrice,
        uint256 payoutFor100
    ) {
        TokenConfig memory cfg = tokenConfigs[token];
        if (!cfg.active) return (0, 0, 0, 0);
        uint256 spot = priceFeed.latestPrice(token);
        if (spot == 0) return (0, 0, 0, 0);

        (multiplier, probability, targetPrice,) =
            _computeBetParamsView(cfg, priceTicks, timeBuckets, spot, token);

        // 100 GridTokens = $100 bet (1:1)
        payoutFor100 = GridMath.computePayout(100 * GT_DECIMALS, multiplier);
    }

    /// @notice Full grid matrix for frontend rendering.
    function getGridMatrix(address token)
        external view
        returns (
            uint256[][] memory multipliers,
            uint256[]   memory prices,
            uint256            currentPrice
        )
    {
        TokenConfig memory cfg = tokenConfigs[token];
        require(cfg.active, "not active");
        currentPrice = priceFeed.latestPrice(token);
        require(currentPrice > 0, "no price");

        uint256 rows = uint256(cfg.gridHalfHeight) * 2;
        uint256 cols = cfg.gridWidth;
        multipliers  = new uint256[][](rows);
        prices       = new uint256[](rows);

        (bool isOpen, bool isOpeningWindow, bool isClosingWindow,
         bool isAfterHours, bool isWeekend) = priceFeed.getMarketState(token);

        GridMath.MarketState memory ms = GridMath.MarketState({
            isOpen: isOpen, isOpeningWindow: isOpeningWindow,
            isClosingWindow: isClosingWindow,
            isAfterHours: isAfterHours, isWeekend: isWeekend
        });
        GridMath.VolatilityParams memory vp = _buildVolParams(cfg);

        for (uint256 r = 0; r < rows; r++) {
            bool isUp;
            uint256 absRow;
            if (r < cfg.gridHalfHeight) {
                absRow = uint256(cfg.gridHalfHeight) - r;
                isUp   = true;
            } else {
                absRow = r - uint256(cfg.gridHalfHeight) + 1;
                isUp   = false;
            }
            prices[r]      = isUp ? currentPrice + absRow * cfg.tickSizeUsdc
                                  : currentPrice - absRow * cfg.tickSizeUsdc;
            multipliers[r] = new uint256[](cols);
            for (uint256 c = 0; c < cols; c++) {
                (uint256 mult,) = GridMath.calculateMultiplier(absRow, c + 1, currentPrice, vp, ms);
                multipliers[r][c] = mult;
            }
        }
    }

    /// @notice Free GridTokens in pool not locked for pending payouts.
    function freePoolGridTokens(address token) external view returns (uint256) {
        return _freePoolGT(token);
    }

    /// @notice Returns the full TokenConfig struct for a token.
    function getTokenConfig(address token) external view returns (TokenConfig memory) {
        return tokenConfigs[token];
    }

    /// @notice Address of the unified gdUSD token.
    function gdUSDToken() external view returns (address) {
        return address(gdUSD);
    }

    function getBetStatus(uint256 betId)
        external view
        returns (bool resolved, bool won, bool claimed, uint256 payout)
    {
        BetRecord memory bet = bets[betId];
        return (bet.resolved, bet.won, bet.claimed,
                GridMath.computePayout(bet.gridTokenAmount, bet.multiplier));
    }

    // ─── Internal ─────────────────────────────────────────────────────────────

    function _requireActive(address token) internal view returns (TokenConfig memory cfg) {
        cfg = tokenConfigs[token];
        require(cfg.active, "token not active");
    }

    function _spot(address token) internal view returns (uint256 spot) {
        spot = priceFeed.latestPrice(token);
        require(spot > 0, "price not available");
    }

    function _applyBetLimits(TokenConfig memory cfg, uint256 usdcEquiv, address token) internal view {
        (, bool isOpeningWindow, , bool isAfterHours, bool isWeekend) = priceFeed.getMarketState(token);

        uint256 effectiveMin = cfg.minBetUsdc;
        uint256 effectiveMax = cfg.maxBetUsdc;

        if (isWeekend)         effectiveMax = 10 * USDC_DECIMALS;
        else if (isAfterHours) effectiveMax = cfg.maxBetUsdc / 2;
        else if (isOpeningWindow) {
            effectiveMin = cfg.minBetUsdc * 3;
            effectiveMax = cfg.maxBetUsdc / 2;
        }

        require(usdcEquiv >= effectiveMin, "below min bet");
        require(usdcEquiv <= effectiveMax, "above max bet");
    }

    function _computeBetParams(
        TokenConfig memory cfg,
        int8 priceTicks, uint8 timeBuckets, uint256 spot, address token
    ) internal view returns (uint256 mult, uint256 targetPrice, uint256 expiryTs) {
        require(timeBuckets >= 1 && timeBuckets <= cfg.gridWidth, "invalid column");
        (mult, , targetPrice, expiryTs) = _computeBetParamsView(cfg, priceTicks, timeBuckets, spot, token);
    }

    function _computeBetParamsView(
        TokenConfig memory cfg,
        int8 priceTicks, uint8 timeBuckets, uint256 spot, address token
    ) internal view returns (uint256 mult, uint256 probability, uint256 targetPrice, uint256 expiryTs) {
        uint256 absTicks = priceTicks > 0
            ? uint256(int256(priceTicks))
            : uint256(-int256(priceTicks));

        if (priceTicks > 0) {
            targetPrice = spot + absTicks * cfg.tickSizeUsdc;
        } else {
            uint256 down = absTicks * cfg.tickSizeUsdc;
            require(down < spot, "target below zero");
            targetPrice = spot - down;
        }

        expiryTs = (block.timestamp / cfg.bucketSeconds) * cfg.bucketSeconds
                   + uint256(timeBuckets) * cfg.bucketSeconds;

        (, bool isOpeningWindow, bool isClosingWindow, bool isAfterHours, bool isWeekend)
            = priceFeed.getMarketState(token);
        (bool isOpen, , , ,) = priceFeed.getMarketState(token);

        (mult, probability) = GridMath.calculateMultiplier(
            absTicks, timeBuckets, spot,
            _buildVolParams(cfg),
            GridMath.MarketState({
                isOpen: isOpen, isOpeningWindow: isOpeningWindow,
                isClosingWindow: isClosingWindow,
                isAfterHours: isAfterHours, isWeekend: isWeekend
            })
        );
    }

    function _buildVolParams(TokenConfig memory cfg)
        internal pure returns (GridMath.VolatilityParams memory)
    {
        return GridMath.VolatilityParams({
            annualVolBps:  cfg.annualVolBps,
            tickSizeUsdc:  cfg.tickSizeUsdc,
            bucketSeconds: cfg.bucketSeconds,
            houseEdgeBps:  cfg.houseEdgeBps,
            openBoostBps:  cfg.openBoostBps,
            closeBoostBps: cfg.closeBoostBps,
            afterHoursBps: cfg.afterHoursBps
        });
    }

    function _checkExposure(
        address token,
        uint256 expiryTs,
        uint256 gtAmount,
        uint256 potentialPayout
    ) internal view {
        uint256 freeGT = _freePoolGT(token);
        require(freeGT > 0, "pool empty");
        require(potentialPayout <= (freeGT * 3000) / 10_000,   "exposure: single bet > 30% pool");

        uint256 poolGT = poolGdUsd[token];
        require(
            bucketMaxPayout[token][expiryTs] + potentialPayout <= (poolGT * 3000) / 10_000,
            "exposure: bucket > 30% pool"
        );

        // Single bet <= 5% of pool (in USDC terms, both sides are 1:1 so just compare GT)
        require(gtAmount <= poolGT / 20, "exposure: single bet > 5% pool");
    }

    function _freePoolGT(address token) internal view returns (uint256) {
        uint256 bal = poolGdUsd[token];
        uint256 lkd = lockedGridTokens[token];
        return bal > lkd ? bal - lkd : 0;
    }

    function _recordBet(
        address player, address token,
        int8 priceTicks, uint256 timeBuckets,
        uint256 targetPrice, uint256 expiryTs,
        uint256 gtAmount, uint256 mult
    ) internal returns (uint256 betId) {
        betId = nextBetId++;
        bets[betId] = BetRecord({
            player: player, token: token,
            priceTicks: priceTicks, timeBuckets: timeBuckets,
            targetPrice: targetPrice, expiryTs: expiryTs,
            gridTokenAmount: gtAmount, multiplier: mult,
            resolved: false, won: false, claimed: false
        });
    }
}
