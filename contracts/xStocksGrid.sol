// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./PriceFeed.sol";
import "./GridMath.sol";

/// @title xStocksGrid
/// @notice Grid-based prediction market for xStocks tokenized equities.
///
/// ═══════════════════════════════════════════════════════════
///  HOW THE GRID WORKS
/// ═══════════════════════════════════════════════════════════
///
///  A 2D matrix anchored to the current price:
///
///       T+1    T+2    T+3    T+4    T+5
///  +5   x1.8   x2.2   x2.8   x3.5   x4.2
///  +4   x1.6   x2.0   x2.5   x3.1   x3.8
///  +3   x1.4   x1.8   x2.2   x2.7   x3.3
///  [0]  ─ CURRENT PRICE ───────────────────
///  -3   x1.4   x1.8   x2.2   x2.7   x3.3
///  ...
///
///  Each cell = "will xAAPL price TOUCH this level before bucket T+N closes?"
///
///  TOUCH semantics: bet wins if price's HIGH/LOW ever reached the target
///  during the bucket — NOT just the end-of-bucket close price.
///
/// ═══════════════════════════════════════════════════════════
///  TWO WAYS TO ENTER
/// ═══════════════════════════════════════════════════════════
///
///  1. placeBet()          — bet xStock tokens directly (e.g. 0.5 xAAPL)
///  2. placeBetWithUSDC()  — bet USDC; converted to token-equivalent at spot
///
///  In both cases the WIN payout is always in xStock tokens.
///  Win 3x on xAAPL → receive 3x xAAPL tokens from the LP pool.
///
/// ═══════════════════════════════════════════════════════════
///  LIQUIDITY POOL
/// ═══════════════════════════════════════════════════════════
///
///  LPs deposit xStock tokens to back the house and earn a share of the
///  house edge on every losing bet.
///
///  shares minted = amount * totalShares / poolBalance  (proportional)
///  redeemable value = shares / totalShares * poolBalance
///
///  Losing bets:  tokens stay in pool  → pool grows → share NAV increases
///  Winning bets: tokens paid from pool → pool shrinks
///
/// ═══════════════════════════════════════════════════════════
///  PRICES / MATH
/// ═══════════════════════════════════════════════════════════
///
///  All prices are 6-decimal USDC (e.g. 190_240_000 = $190.24).
///  Multipliers use GBM / normal-CDF via GridMath library.
///  SCALE = 1e18: tokenAmount(18dec) * price(6dec) / 1e18 = usdcValue(6dec)
///
contract xStocksGrid is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─── Constants ────────────────────────────────────────────────────────────

    /// @dev token(18dec) * price(6dec) / SCALE = usdc(6dec)
    uint256 internal constant SCALE = 1e18;

    // ─── Structs ──────────────────────────────────────────────────────────────

    struct TokenConfig {
        bool    active;
        uint256 annualVolBps;          // Annual sigma in bps (2500 = 25%)
        uint256 tickSizeUsdc;          // Price step per row (6-dec USDC)
        uint256 bucketSeconds;         // Seconds per time column
        uint256 houseEdgeBps;          // Protocol take in bps (1000 = 10%)
        uint256 minBetUsdc;            // Min bet in USDC equivalent (6 dec)
        uint256 maxBetUsdc;            // Max bet in USDC equivalent (6 dec)
        uint8   gridWidth;             // Visible time columns (max timeBuckets)
        uint8   gridHalfHeight;        // Price rows above and below center
        uint256 openBoostBps;          // Vol multiplier at open (25000 = 2.5x)
        uint256 closeBoostBps;         // Vol multiplier at close (18000 = 1.8x)
        uint256 afterHoursBps;         // Vol multiplier after hours (4000 = 0.4x)
    }

    struct BetRecord {
        address player;
        address token;
        int8    priceTicks;       // Signed row offset (+up, -down)
        uint256 timeBuckets;      // Column offset (1-based)
        uint256 targetPrice;      // Price level to touch (6-dec USDC)
        uint256 expiryTs;         // Bucket close timestamp
        uint256 tokenAmount;      // xStock token-equivalent wagered (18 dec)
        uint256 usdcPaid;         // USDC paid by user (0 for token bets, 6 dec)
        uint256 multiplier;       // Payout multiplier x100 (e.g. 300 = 3x)
        bool    isUsdcBet;
        bool    resolved;
        bool    won;
        bool    claimed;
    }

    // ─── State ────────────────────────────────────────────────────────────────

    IERC20    public immutable usdc;
    PriceFeed public priceFeed;

    bool public paused;

    uint256 public nextBetId = 1;
    uint256 public minPoolTokens; // min LP pool per token before bets accepted

    mapping(address => TokenConfig) public tokenConfigs;
    mapping(uint256 => BetRecord)   public bets;

    // LP pool: per-token xStock balances + share accounting
    mapping(address => uint256) public lpShares;          // LP address => total shares (all tokens)
    mapping(address => mapping(address => uint256)) public lpTokenShares; // LP => token => shares
    mapping(address => uint256) public totalPoolShares;   // token => total LP shares
    // Free balance = IERC20(token).balanceOf(this) - lockedForPayouts[token]
    mapping(address => uint256) public lockedForPayouts;  // token => tokens locked for pending wins

    // USDC collected from losing USDC bets (admin withdraws to replenish reserves)
    mapping(address => uint256) public usdcCollected;

    // Risk controls: per-token per-bucket exposure
    // token => bucketExpiry => total potential payout
    mapping(address => mapping(uint256 => uint256)) public bucketMaxPayout;

    // ─── Events ───────────────────────────────────────────────────────────────

    event TokenConfigured(address indexed token);
    event BetPlaced(
        uint256 indexed betId,
        address indexed player,
        address indexed token,
        uint256 targetPrice,
        uint256 expiryTs,
        uint256 multiplier,
        uint256 tokenAmount,
        uint256 usdcPaid,
        int8    priceTicks,
        uint256 timeBuckets,
        bool    isUsdcBet
    );
    event BetResolved(uint256 indexed betId, bool won, uint256 payout);
    event WinningsClaimed(uint256 indexed betId, address indexed player, uint256 tokenPayout);
    event LiquidityDeposited(address indexed lp, address indexed token, uint256 amount, uint256 shares);
    event LiquidityWithdrawn(address indexed lp, address indexed token, uint256 amount, uint256 shares);
    event UsdcWithdrawn(address indexed token, uint256 amount);
    event Paused(bool paused);

    // ─── Constructor ──────────────────────────────────────────────────────────

    constructor(address usdc_, address priceFeed_) Ownable(msg.sender) {
        require(usdc_      != address(0), "zero usdc");
        require(priceFeed_ != address(0), "zero priceFeed");
        usdc      = IERC20(usdc_);
        priceFeed = PriceFeed(priceFeed_);
        minPoolTokens = 0; // owner sets per token if desired
    }

    // ─── Modifiers ────────────────────────────────────────────────────────────

    modifier notPaused() {
        require(!paused, "xStocksGrid: paused");
        _;
    }

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
        require(token != address(0),        "zero token");
        require(annualVolBps > 0,           "zero vol");
        require(tickSizeUsdc > 0,           "zero tick");
        require(bucketSeconds > 0,          "zero bucket");
        require(houseEdgeBps < 5000,        "edge >= 50%");
        require(minBetUsdc > 0,             "zero min");
        require(maxBetUsdc >= minBetUsdc,   "max < min");
        require(gridWidth > 0,              "zero width");
        require(gridHalfHeight > 0,         "zero height");

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
            openBoostBps:   25000,   // 2.5x
            closeBoostBps:  18000,   // 1.8x
            afterHoursBps:  4000     // 0.4x
        });
        emit TokenConfigured(token);
    }

    function setTokenActive(address token, bool active) external onlyOwner {
        tokenConfigs[token].active = active;
    }

    function setPriceFeed(address priceFeed_) external onlyOwner {
        require(priceFeed_ != address(0), "zero address");
        priceFeed = PriceFeed(priceFeed_);
    }

    function setPaused(bool p) external onlyOwner {
        paused = p;
        emit Paused(p);
    }

    /// @notice Withdraw USDC accumulated from losing USDC bets.
    function withdrawUsdc(address token, uint256 amount) external onlyOwner {
        require(amount <= usdcCollected[token], "exceeds collected");
        usdcCollected[token] -= amount;
        usdc.safeTransfer(msg.sender, amount);
        emit UsdcWithdrawn(token, amount);
    }

    // ─── LP Pool ──────────────────────────────────────────────────────────────

    /// @notice Deposit xStock tokens into the LP pool and receive pool shares.
    ///         LPs earn house edge revenue — their share NAV grows as bets are lost.
    /// @param token   xStock ERC-20 address.
    /// @param amount  Tokens to deposit (18 dec).
    function depositLiquidity(address token, uint256 amount) external nonReentrant notPaused {
        require(tokenConfigs[token].active, "token not active");
        require(amount > 0, "zero amount");

        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

        uint256 freeBal     = _freeBalance(token);
        uint256 totalShares = totalPoolShares[token];

        uint256 shares;
        if (totalShares == 0 || freeBal == 0) {
            shares = amount; // First depositor: 1:1
        } else {
            shares = (amount * totalShares) / freeBal;
        }

        lpTokenShares[msg.sender][token] += shares;
        totalPoolShares[token]           += shares;

        emit LiquidityDeposited(msg.sender, token, amount, shares);
    }

    /// @notice Burn LP shares and receive proportional xStock tokens.
    /// @param token   xStock ERC-20 address.
    /// @param shares  LP shares to burn.
    function withdrawLiquidity(address token, uint256 shares) external nonReentrant {
        require(lpTokenShares[msg.sender][token] >= shares, "insufficient shares");
        require(totalPoolShares[token] > 0, "no pool");

        uint256 freeBal = _freeBalance(token);
        uint256 amount  = (shares * freeBal) / totalPoolShares[token];
        require(amount > 0, "nothing to withdraw");

        lpTokenShares[msg.sender][token] -= shares;
        totalPoolShares[token]           -= shares;

        IERC20(token).safeTransfer(msg.sender, amount);
        emit LiquidityWithdrawn(msg.sender, token, amount, shares);
    }

    /// @notice NAV per LP share in token units (18 dec).
    function shareNAV(address token) external view returns (uint256) {
        uint256 totalShares = totalPoolShares[token];
        if (totalShares == 0) return 1e18;
        return (_freeBalance(token) * 1e18) / totalShares;
    }

    // ─── Betting ──────────────────────────────────────────────────────────────

    /// @notice Bet with xStock tokens directly (e.g. 0.5 xAAPL).
    ///         Win => receive xStock tokens x multiplier from the pool.
    /// @param token       xStocks ERC-20 address.
    /// @param priceTicks  Row offset: positive = up, negative = down. Non-zero.
    /// @param timeBuckets Column (1 = nearest bucket, up to gridWidth).
    /// @param amount      xStock tokens to wager (18 dec).
    function placeBet(
        address token,
        int8    priceTicks,
        uint8   timeBuckets,
        uint256 amount
    ) external nonReentrant notPaused returns (uint256 betId) {
        require(priceTicks != 0, "pick a non-zero row");
        TokenConfig memory cfg = _requireActive(token);

        uint256 spotPrice = _spot(token);

        // Convert token amount to USDC equivalent for limits check
        uint256 usdcEquiv = (amount * spotPrice) / SCALE;
        _applyBetLimits(cfg, usdcEquiv, token);

        (uint256 mult, uint256 targetPrice, uint256 expiryTs) =
            _computeBetParams(cfg, priceTicks, timeBuckets, spotPrice, token);

        uint256 potentialPayout = GridMath.computePayout(amount, mult);
        _checkExposure(token, cfg, expiryTs, amount, potentialPayout, spotPrice);

        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        lockedForPayouts[token] += potentialPayout;
        bucketMaxPayout[token][expiryTs] += potentialPayout;

        betId = _recordBet(msg.sender, token, priceTicks, timeBuckets, targetPrice, expiryTs, amount, 0, mult, false);
        emit BetPlaced(betId, msg.sender, token, targetPrice, expiryTs, mult, amount, 0, priceTicks, timeBuckets, false);
    }

    /// @notice Bet with USDC — no xStock tokens required to play.
    ///         USDC is converted to xStock token-equivalent at spot price.
    ///         Win => receive xStock tokens x multiplier from the pool.
    ///         Lose => USDC stays in usdcCollected for admin to replenish pool.
    /// @param token       xStocks ERC-20 to play on.
    /// @param priceTicks  Row offset: positive = up, negative = down. Non-zero.
    /// @param timeBuckets Column (1 = nearest bucket, up to gridWidth).
    /// @param usdcAmount  USDC to wager (6 dec).
    function placeBetWithUSDC(
        address token,
        int8    priceTicks,
        uint8   timeBuckets,
        uint256 usdcAmount
    ) external nonReentrant notPaused returns (uint256 betId) {
        require(priceTicks != 0, "pick a non-zero row");
        require(usdcAmount > 0,  "zero usdc");
        TokenConfig memory cfg = _requireActive(token);

        _applyBetLimits(cfg, usdcAmount, token);

        uint256 spotPrice = _spot(token);

        // Convert USDC to xStock token equivalent at current price
        // tokenEquiv (18 dec) = usdcAmount (6 dec) * SCALE / price (6 dec)
        uint256 tokenEquiv = (usdcAmount * SCALE) / spotPrice;
        require(tokenEquiv > 0, "token equiv rounds to zero");

        (uint256 mult, uint256 targetPrice, uint256 expiryTs) =
            _computeBetParams(cfg, priceTicks, timeBuckets, spotPrice, token);

        uint256 potentialPayout = GridMath.computePayout(tokenEquiv, mult);
        _checkExposure(token, cfg, expiryTs, tokenEquiv, potentialPayout, spotPrice);

        usdc.safeTransferFrom(msg.sender, address(this), usdcAmount);
        usdcCollected[token]        += usdcAmount;
        lockedForPayouts[token]     += potentialPayout;
        bucketMaxPayout[token][expiryTs] += potentialPayout;

        betId = _recordBet(msg.sender, token, priceTicks, timeBuckets, targetPrice, expiryTs, tokenEquiv, usdcAmount, mult, true);
        emit BetPlaced(betId, msg.sender, token, targetPrice, expiryTs, mult, tokenEquiv, usdcAmount, priceTicks, timeBuckets, true);
    }

    // ─── Resolution ───────────────────────────────────────────────────────────

    /// @notice Resolve a single bet after its bucket closes.
    ///         Uses TOUCH semantics: wins if price HIGH (for up bets) or LOW (for down bets)
    ///         ever reached targetPrice during the bucket window.
    ///         Callable by anyone once the backend has pushed resolution data.
    function resolveBet(uint256 betId) public {
        BetRecord storage bet = bets[betId];
        require(bet.player != address(0), "bet not found");
        require(!bet.resolved,            "already resolved");
        require(block.timestamp >= bet.expiryTs, "bucket not closed");

        (uint256 price, uint256 high, uint256 low, bool available) =
            priceFeed.getResolutionData(bet.token, bet.expiryTs);
        require(available, "resolution data not pushed yet");

        bool won;
        if (bet.priceTicks > 0) {
            won = high >= bet.targetPrice;   // up bet: did price ever reach or exceed target?
        } else {
            won = low <= bet.targetPrice;    // down bet: did price ever reach or go below target?
        }

        bet.resolved = true;
        bet.won      = won;

        uint256 payout = GridMath.computePayout(bet.tokenAmount, bet.multiplier);
        if (lockedForPayouts[bet.token] >= payout) {
            lockedForPayouts[bet.token] -= payout;
        }
        if (bucketMaxPayout[bet.token][bet.expiryTs] >= payout) {
            bucketMaxPayout[bet.token][bet.expiryTs] -= payout;
        }

        emit BetResolved(betId, won, won ? payout : 0);

        // Suppress unused variable warning
        price;
    }

    /// @notice Batch resolve multiple bets in one transaction.
    ///         Skips bets that cannot yet be resolved.
    function resolveBets(uint256[] calldata betIds) external {
        for (uint256 i = 0; i < betIds.length; i++) {
            BetRecord storage bet = bets[betIds[i]];
            if (bet.player == address(0))  continue;
            if (bet.resolved)              continue;
            if (block.timestamp < bet.expiryTs) continue;
            (, , , bool available) = priceFeed.getResolutionData(bet.token, bet.expiryTs);
            if (!available) continue;
            resolveBet(betIds[i]);
        }
    }

    // ─── Claiming ─────────────────────────────────────────────────────────────

    /// @notice Claim xStock token winnings for a resolved winning bet.
    ///         Works for both token bets and USDC bets — winner always receives xStock tokens.
    function claimWinnings(uint256 betId) external nonReentrant {
        BetRecord storage bet = bets[betId];
        require(bet.player == msg.sender, "not your bet");
        require(bet.resolved,             "not resolved");
        require(bet.won,                  "bet lost");
        require(!bet.claimed,             "already claimed");

        bet.claimed = true;
        uint256 payout = GridMath.computePayout(bet.tokenAmount, bet.multiplier);
        require(IERC20(bet.token).balanceOf(address(this)) >= payout, "pool insufficient");

        IERC20(bet.token).safeTransfer(msg.sender, payout);
        emit WinningsClaimed(betId, msg.sender, payout);
    }

    /// @notice Batch claim multiple winning bets in one transaction.
    function claimMultiple(uint256[] calldata betIds) external nonReentrant {
        uint256 totalPayout;
        address tokenAddr;

        for (uint256 i = 0; i < betIds.length; i++) {
            BetRecord storage bet = bets[betIds[i]];
            if (bet.player != msg.sender) continue;
            if (!bet.resolved || bet.claimed || !bet.won) continue;
            if (tokenAddr == address(0)) {
                tokenAddr = bet.token;
            } else {
                require(bet.token == tokenAddr, "mixed tokens: claim per token");
            }
            bet.claimed  = true;
            totalPayout += GridMath.computePayout(bet.tokenAmount, bet.multiplier);
        }

        require(totalPayout > 0,          "nothing to claim");
        require(tokenAddr != address(0),  "no valid bets");
        require(IERC20(tokenAddr).balanceOf(address(this)) >= totalPayout, "pool insufficient");

        IERC20(tokenAddr).safeTransfer(msg.sender, totalPayout);
    }

    // ─── Views ────────────────────────────────────────────────────────────────

    /// @notice Preview the multiplier and probability for a grid cell (no gas).
    /// @param token        xStocks ERC-20 address.
    /// @param priceTicks   Signed row offset.
    /// @param timeBuckets  Column offset.
    /// @return multiplier          Payout multiplier x100 (e.g. 250 = 2.5x).
    /// @return probability         Implied probability (PRECISION = 1e18 = 100%).
    /// @return targetPrice         Price level to touch (6-dec USDC).
    /// @return payout100USDC       Payout for a $100 USDC bet (6 dec).
    function previewMultiplier(
        address token,
        int8    priceTicks,
        uint8   timeBuckets
    ) external view returns (
        uint256 multiplier,
        uint256 probability,
        uint256 targetPrice,
        uint256 payout100USDC
    ) {
        TokenConfig memory cfg = tokenConfigs[token];
        if (!cfg.active) return (0, 0, 0, 0);

        uint256 spotPrice = priceFeed.latestPrice(token);
        if (spotPrice == 0) return (0, 0, 0, 0);

        (multiplier, probability, targetPrice,) =
            _computeBetParamsView(cfg, priceTicks, timeBuckets, spotPrice, token);

        // payout for $100 USDC in token-equiv terms
        uint256 tokenEquiv100 = (100e6 * SCALE) / spotPrice;
        payout100USDC = GridMath.computePayout(tokenEquiv100, multiplier);
        // Convert back to USDC for display
        payout100USDC = (payout100USDC * spotPrice) / SCALE;
    }

    /// @notice Get the full grid multiplier matrix for a token (for frontend rendering).
    /// @param token  xStocks ERC-20.
    /// @return multipliers  [row][col] array. Row 0 = top (furthest up). x100 scale.
    /// @return prices       Target price per row (6-dec USDC).
    /// @return currentPrice Current spot price (6-dec USDC).
    function getGridMatrix(address token)
        external
        view
        returns (
            uint256[][] memory multipliers,
            uint256[]   memory prices,
            uint256            currentPrice
        )
    {
        TokenConfig memory cfg = tokenConfigs[token];
        require(cfg.active, "token not active");

        currentPrice = priceFeed.latestPrice(token);
        require(currentPrice > 0, "price not available");

        uint256 rows = uint256(cfg.gridHalfHeight) * 2;
        uint256 cols = cfg.gridWidth;

        multipliers = new uint256[][](rows);
        prices      = new uint256[](rows);

        (
            bool isOpen,
            bool isOpeningWindow,
            bool isClosingWindow,
            bool isAfterHours,
            bool isWeekend
        ) = priceFeed.getMarketState(token);

        GridMath.VolatilityParams memory vp = GridMath.VolatilityParams({
            annualVolBps:  cfg.annualVolBps,
            tickSizeUsdc:  cfg.tickSizeUsdc,
            bucketSeconds: cfg.bucketSeconds,
            houseEdgeBps:  cfg.houseEdgeBps,
            openBoostBps:  cfg.openBoostBps,
            closeBoostBps: cfg.closeBoostBps,
            afterHoursBps: cfg.afterHoursBps
        });
        GridMath.MarketState memory ms = GridMath.MarketState({
            isOpen:          isOpen,
            isOpeningWindow: isOpeningWindow,
            isClosingWindow: isClosingWindow,
            isAfterHours:    isAfterHours,
            isWeekend:       isWeekend
        });

        // rows: top half = above current price (high absRow), bottom half = below
        for (uint256 r = 0; r < rows; r++) {
            uint256 absRow;
            bool isUp;
            if (r < cfg.gridHalfHeight) {
                absRow = uint256(cfg.gridHalfHeight) - r;  // rows above: halfHeight down to 1
                isUp   = true;
            } else {
                absRow = r - uint256(cfg.gridHalfHeight) + 1; // rows below: 1 up to halfHeight
                isUp   = false;
            }

            prices[r] = isUp
                ? currentPrice + absRow * cfg.tickSizeUsdc
                : currentPrice - absRow * cfg.tickSizeUsdc;

            multipliers[r] = new uint256[](cols);
            for (uint256 c = 0; c < cols; c++) {
                (uint256 mult,) = GridMath.calculateMultiplier(
                    absRow, c + 1, currentPrice, vp, ms
                );
                multipliers[r][c] = mult;
            }
        }
    }

    /// @notice Free xStock token balance available for new bets (not locked for payouts).
    function freeBalance(address token) external view returns (uint256) {
        return _freeBalance(token);
    }

    /// @notice Bet status and potential payout details.
    function getBetStatus(uint256 betId)
        external
        view
        returns (
            bool    resolved,
            bool    won,
            bool    claimed,
            uint256 tokenPayout,
            bool    isUsdcBet,
            uint256 usdcPaid
        )
    {
        BetRecord memory bet = bets[betId];
        return (
            bet.resolved,
            bet.won,
            bet.claimed,
            GridMath.computePayout(bet.tokenAmount, bet.multiplier),
            bet.isUsdcBet,
            bet.usdcPaid
        );
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

    /// @dev Apply market-hours bet limits. usdcEquiv is the bet value in USDC (6 dec).
    function _applyBetLimits(
        TokenConfig memory cfg,
        uint256 usdcEquiv,
        address token
    ) internal view {
        (
            ,
            bool isOpeningWindow,
            ,
            bool isAfterHours,
            bool isWeekend
        ) = priceFeed.getMarketState(token);

        uint256 effectiveMin = cfg.minBetUsdc;
        uint256 effectiveMax = cfg.maxBetUsdc;

        if (isWeekend) {
            effectiveMax = 10e6;                   // $10 max on weekends
        } else if (isAfterHours) {
            effectiveMax = cfg.maxBetUsdc / 2;     // half max after hours
        } else if (isOpeningWindow) {
            effectiveMin = cfg.minBetUsdc * 3;     // 3x min during opening dislocation
            effectiveMax = cfg.maxBetUsdc / 2;
        }

        require(usdcEquiv >= effectiveMin, "below min bet");
        require(usdcEquiv <= effectiveMax, "above max bet");
    }

    /// @dev Compute multiplier, targetPrice, and expiryTs for a bet.
    function _computeBetParams(
        TokenConfig memory cfg,
        int8    priceTicks,
        uint8   timeBuckets,
        uint256 spotPrice,
        address token
    ) internal view returns (uint256 mult, uint256 targetPrice, uint256 expiryTs) {
        require(timeBuckets >= 1 && timeBuckets <= cfg.gridWidth, "invalid column");

        (mult, , targetPrice, expiryTs) =
            _computeBetParamsView(cfg, priceTicks, timeBuckets, spotPrice, token);
    }

    function _computeBetParamsView(
        TokenConfig memory cfg,
        int8    priceTicks,
        uint8   timeBuckets,
        uint256 spotPrice,
        address token
    ) internal view returns (uint256 mult, uint256 probability, uint256 targetPrice, uint256 expiryTs) {
        uint256 absTicks = priceTicks > 0
            ? uint256(int256(priceTicks))
            : uint256(-int256(priceTicks));

        if (priceTicks > 0) {
            targetPrice = spotPrice + absTicks * cfg.tickSizeUsdc;
        } else {
            uint256 downMove = absTicks * cfg.tickSizeUsdc;
            require(downMove < spotPrice, "target below zero");
            targetPrice = spotPrice - downMove;
        }

        // Align expiry to bucket boundary
        uint256 bucketStart = (block.timestamp / cfg.bucketSeconds) * cfg.bucketSeconds;
        expiryTs = bucketStart + uint256(timeBuckets) * cfg.bucketSeconds;

        (
            bool isOpen,
            bool isOpeningWindow,
            bool isClosingWindow,
            bool isAfterHours,
            bool isWeekend
        ) = priceFeed.getMarketState(token);

        GridMath.VolatilityParams memory vp = GridMath.VolatilityParams({
            annualVolBps:  cfg.annualVolBps,
            tickSizeUsdc:  cfg.tickSizeUsdc,
            bucketSeconds: cfg.bucketSeconds,
            houseEdgeBps:  cfg.houseEdgeBps,
            openBoostBps:  cfg.openBoostBps,
            closeBoostBps: cfg.closeBoostBps,
            afterHoursBps: cfg.afterHoursBps
        });
        GridMath.MarketState memory ms = GridMath.MarketState({
            isOpen:          isOpen,
            isOpeningWindow: isOpeningWindow,
            isClosingWindow: isClosingWindow,
            isAfterHours:    isAfterHours,
            isWeekend:       isWeekend
        });

        (mult, probability) = GridMath.calculateMultiplier(absTicks, timeBuckets, spotPrice, vp, ms);
    }

    /// @dev Risk controls: exposure cap and single-bet cap.
    function _checkExposure(
        address token,
        TokenConfig memory cfg,
        uint256 expiryTs,
        uint256 tokenAmount,
        uint256 potentialPayout,
        uint256 spotPrice
    ) internal view {
        uint256 poolBalance = IERC20(token).balanceOf(address(this));
        require(poolBalance > lockedForPayouts[token], "pool too small");

        uint256 freePool = poolBalance - lockedForPayouts[token];

        // Single bet: potential payout <= 30% of free pool
        require(potentialPayout <= (freePool * 3000) / 10_000, "exposure limit: single bet");

        // Bucket exposure: total potential payouts in this bucket <= 30% of pool
        uint256 newBucketPayout = bucketMaxPayout[token][expiryTs] + potentialPayout;
        require(newBucketPayout <= (poolBalance * 3000) / 10_000, "exposure limit: bucket");

        // Cell concentration: single bet <= 5% of pool
        uint256 betUsdc = (tokenAmount * spotPrice) / SCALE;
        uint256 poolUsdc = (poolBalance * spotPrice) / SCALE;
        require(betUsdc <= poolUsdc / 20, "exposure limit: single bet 5%");

        // suppress cfg unused warning
        cfg.active;
    }

    function _freeBalance(address token) internal view returns (uint256) {
        uint256 balance = IERC20(token).balanceOf(address(this));
        uint256 locked  = lockedForPayouts[token];
        return balance > locked ? balance - locked : 0;
    }

    function _recordBet(
        address player,
        address token,
        int8    priceTicks,
        uint256 timeBuckets,
        uint256 targetPrice,
        uint256 expiryTs,
        uint256 tokenAmount,
        uint256 usdcPaid_,
        uint256 mult,
        bool    isUsdcBet_
    ) internal returns (uint256 betId) {
        betId = nextBetId++;
        bets[betId] = BetRecord({
            player:      player,
            token:       token,
            priceTicks:  priceTicks,
            timeBuckets: timeBuckets,
            targetPrice: targetPrice,
            expiryTs:    expiryTs,
            tokenAmount: tokenAmount,
            usdcPaid:    usdcPaid_,
            multiplier:  mult,
            isUsdcBet:   isUsdcBet_,
            resolved:    false,
            won:         false,
            claimed:     false
        });
    }
}
