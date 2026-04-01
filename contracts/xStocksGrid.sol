// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interfaces/IOracle.sol";
import "./xStockToken.sol";

/// @title xStocksGrid
/// @notice Grid-based binary prediction market for xStock tokens.
///
///  The Grid
///  --------
///  Each grid cell is identified by (token, priceLevel, timeExpiry).
///  A user bets that the underlying price will be AT or within one tick of
///  `priceLevel` when the cell's `timeExpiry` timestamp is reached.
///
///  Win condition: |oraclePrice - priceLevel| ≤ (tickSize / 2)
///
///  Multipliers (v1 — distance-score tiers, v2 will use full Z-score model)
///  -------------------------------------------------------------------------
///  distanceScore = |priceLevels| × timeBuckets
///  Score 1  → x2    (very close cell)
///  Score 2–3 → x3
///  Score 4–6 → x5
///  Score 7–10 → x8
///  Score 11–15 → x12
///  Score 16+  → x20
///  House edge applied on top (configurable per token, default 10 %).
///
///  House reserve
///  -------------
///  The contract holds xStock tokens as prize reserve.  Losing bets grow the
///  reserve; winning bets are paid from it.  The admin pre-funds the reserve
///  via fundReserve().  A bet reverts if the reserve cannot cover the payout.
///
///  Resolution
///  ----------
///  Anyone (or a Chainlink Automation keeper) calls resolveCell() after
///  block.timestamp ≥ cell.timeExpiry.  The oracle must have a resolution
///  price for that exact timestamp (set by the keeper off-chain).

contract xStocksGrid is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─── Types ────────────────────────────────────────────────────────────────

    struct GridConfig {
        /// @dev Price increment per row (8 decimals, e.g. 5_000_000 = $0.05).
        uint256 tickSize;
        /// @dev Duration of each time column in seconds (e.g. 30).
        uint256 bucketSeconds;
        /// @dev Number of visible time columns (e.g. 10).
        uint8   gridWidth;
        /// @dev Number of visible price rows above and below centre (e.g. 6).
        uint8   gridHalfHeight;
        /// @dev House edge in basis points (e.g. 1000 = 10 %).
        uint256 houseEdgeBps;
        /// @dev Maximum xStock tokens per single bet (18 dec).
        uint256 maxBetAmount;
        /// @dev Minimum xStock tokens per single bet (18 dec).
        uint256 minBetAmount;
        /// @dev Whether this token is live for betting.
        bool    active;
    }

    struct GridCell {
        address token;
        uint256 priceLevel;   // target price (8 dec)
        uint256 timeExpiry;   // unix timestamp when the bucket closes
        uint256 multiplier;   // payout multiplier ×100 (e.g. 300 = 3×)
        uint256 totalBets;    // total xStock tokens bet on this cell (18 dec)
        bool    resolved;
        bool    outcome;      // true = price was at this level
    }

    struct BetRecord {
        address player;
        address token;
        bytes32 cellId;
        uint256 amount;      // xStock tokens wagered (18 dec)
        uint256 multiplier;  // multiplier at bet time ×100
        bool    claimed;
    }

    // ─── State ────────────────────────────────────────────────────────────────

    IOracle public oracle;

    mapping(address => GridConfig) public gridConfigs;

    /// @dev cellId → GridCell
    mapping(bytes32 => GridCell) public cells;

    /// @dev betId → BetRecord
    mapping(uint256 => BetRecord) public bets;
    uint256 public betCount;

    /// @dev token → xStock tokens reserved for pending payouts (18 dec)
    mapping(address => uint256) public pendingPayouts;

    // ─── Events ───────────────────────────────────────────────────────────────

    event GridConfigSet(address indexed token, GridConfig config);
    event BetPlaced(
        uint256 indexed betId,
        address indexed player,
        address indexed token,
        bytes32 cellId,
        uint256 amount,
        uint256 multiplier,
        uint256 priceLevel,
        uint256 timeExpiry
    );
    event CellResolved(bytes32 indexed cellId, bool outcome, uint256 resolutionPrice);
    event WinningsClaimed(uint256 indexed betId, address indexed player, uint256 payout);
    event ReserveFunded(address indexed token, uint256 amount);
    event ReserveWithdrawn(address indexed token, uint256 amount);

    // ─── Constructor ──────────────────────────────────────────────────────────

    constructor(address oracle_) Ownable(msg.sender) {
        require(oracle_ != address(0), "zero oracle");
        oracle = IOracle(oracle_);
    }

    // ─── Admin ────────────────────────────────────────────────────────────────

    function setGridConfig(address token, GridConfig calldata config) external onlyOwner {
        require(token != address(0),         "zero token");
        require(config.tickSize > 0,         "zero tick");
        require(config.bucketSeconds > 0,    "zero bucket");
        require(config.gridWidth > 0,        "zero width");
        require(config.houseEdgeBps < 5000,  "edge >= 50%");
        require(config.minBetAmount > 0,     "zero min");
        require(config.maxBetAmount >= config.minBetAmount, "max < min");
        gridConfigs[token] = config;
        emit GridConfigSet(token, config);
    }

    /// @notice Pre-fund the house reserve for a token.
    ///         Caller must have approved this contract to spend their xStock tokens.
    function fundReserve(address token, uint256 amount) external onlyOwner {
        require(amount > 0, "zero amount");
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        emit ReserveFunded(token, amount);
    }

    /// @notice Withdraw excess reserve (only what is not locked for pending payouts).
    function withdrawReserve(address token, uint256 amount) external onlyOwner {
        uint256 free = freeReserve(token);
        require(amount <= free, "insufficient free reserve");
        IERC20(token).safeTransfer(msg.sender, amount);
        emit ReserveWithdrawn(token, amount);
    }

    function setOracle(address oracle_) external onlyOwner {
        require(oracle_ != address(0), "zero oracle");
        oracle = IOracle(oracle_);
    }

    // ─── Core ─────────────────────────────────────────────────────────────────

    /// @notice Place a bet on a grid cell.
    /// @param token          Address of the xStockToken to bet with.
    /// @param priceLevels    Row offset from current price: positive = up, negative = down.
    ///                       Cannot be zero (current price is not a valid target).
    /// @param timeBuckets    Column from now (1 = next bucket, up to gridWidth).
    /// @param amount         xStock tokens to wager (18 dec).
    function placeBet(
        address token,
        int8    priceLevels,
        uint8   timeBuckets,
        uint256 amount
    ) external nonReentrant returns (uint256 betId) {
        GridConfig memory cfg = gridConfigs[token];
        require(cfg.active,                        "token not active");
        require(priceLevels != 0,                  "must pick a non-zero row");
        require(timeBuckets >= 1 && timeBuckets <= cfg.gridWidth, "invalid column");
        require(amount >= cfg.minBetAmount,        "below min bet");
        require(amount <= cfg.maxBetAmount,        "above max bet");

        // Current oracle price
        (uint256 currentOraclePrice,) = oracle.getLatestPrice(token);
        require(currentOraclePrice > 0, "oracle unavailable");

        // Target price for this cell
        uint256 absLevels = priceLevels > 0
            ? uint256(int256(priceLevels))
            : uint256(-int256(priceLevels));

        uint256 priceLevel;
        if (priceLevels > 0) {
            priceLevel = currentOraclePrice + absLevels * cfg.tickSize;
        } else {
            require(currentOraclePrice > absLevels * cfg.tickSize, "price level underflow");
            priceLevel = currentOraclePrice - absLevels * cfg.tickSize;
        }

        // Cell expiry: end of the chosen time bucket
        uint256 timeExpiry = block.timestamp + uint256(timeBuckets) * cfg.bucketSeconds;

        // Multiplier for this cell
        uint256 mult = calculateMultiplier(absLevels, timeBuckets, cfg.houseEdgeBps);

        // Potential payout
        uint256 potentialPayout = (amount * mult) / 100;
        require(
            IERC20(token).balanceOf(address(this)) >= pendingPayouts[token] + potentialPayout,
            "insufficient house reserve"
        );

        // Pull xStock tokens from player
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

        // Register (or reuse) cell
        bytes32 cellId = getCellId(token, priceLevel, timeExpiry);
        if (cells[cellId].token == address(0)) {
            cells[cellId] = GridCell({
                token:      token,
                priceLevel: priceLevel,
                timeExpiry: timeExpiry,
                multiplier: mult,
                totalBets:  0,
                resolved:   false,
                outcome:    false
            });
        }
        cells[cellId].totalBets += amount;

        // Lock payout capacity
        pendingPayouts[token] += potentialPayout;

        // Record bet
        betId = ++betCount;
        bets[betId] = BetRecord({
            player:     msg.sender,
            token:      token,
            cellId:     cellId,
            amount:     amount,
            multiplier: mult,
            claimed:    false
        });

        emit BetPlaced(betId, msg.sender, token, cellId, amount, mult, priceLevel, timeExpiry);
    }

    /// @notice Resolve a cell after its time bucket has closed.
    ///         Can be called by anyone (expected: Chainlink Automation keeper).
    ///         The oracle must have a resolution price for cell.timeExpiry.
    function resolveCell(bytes32 cellId) external {
        GridCell storage cell = cells[cellId];
        require(cell.token != address(0), "cell does not exist");
        require(!cell.resolved,           "already resolved");
        require(block.timestamp >= cell.timeExpiry, "bucket not closed");

        (uint256 resPrice, bool available) = oracle.getResolutionPrice(
            cell.token,
            cell.timeExpiry
        );
        require(available, "resolution price not available yet");

        // Win condition: price is within half a tick of the target level
        GridConfig memory cfg = gridConfigs[cell.token];
        uint256 halfTick = cfg.tickSize / 2;
        bool outcome = resPrice >= cell.priceLevel - halfTick &&
                       resPrice <= cell.priceLevel + halfTick;

        cell.resolved = true;
        cell.outcome  = outcome;

        emit CellResolved(cellId, outcome, resPrice);
    }

    /// @notice Claim winnings for a resolved winning bet.
    function claimWinnings(uint256 betId) external nonReentrant {
        BetRecord storage bet = bets[betId];
        require(bet.player == msg.sender, "not your bet");
        require(!bet.claimed,             "already claimed");

        GridCell memory cell = cells[bet.cellId];
        require(cell.resolved, "cell not resolved");
        require(cell.outcome,  "bet lost");

        uint256 payout = (bet.amount * bet.multiplier) / 100;

        bet.claimed = true;

        // Release the locked payout capacity
        if (pendingPayouts[bet.token] >= payout) {
            pendingPayouts[bet.token] -= payout;
        } else {
            pendingPayouts[bet.token] = 0;
        }

        IERC20(bet.token).safeTransfer(msg.sender, payout);

        emit WinningsClaimed(betId, msg.sender, payout);
    }

    // ─── Views ────────────────────────────────────────────────────────────────

    /// @notice Deterministic cell ID from its coordinates.
    function getCellId(
        address token,
        uint256 priceLevel,
        uint256 timeExpiry
    ) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(token, priceLevel, timeExpiry));
    }

    /// @notice xStock tokens in the reserve available for new bets.
    function freeReserve(address token) public view returns (uint256) {
        uint256 balance = IERC20(token).balanceOf(address(this));
        uint256 locked  = pendingPayouts[token];
        return balance > locked ? balance - locked : 0;
    }

    /// @notice Distance-score based multiplier (v1 model).
    ///
    ///  distScore = absDistance × timeBuckets
    ///  Score  1   → 200  (2×)
    ///  Score  2–3 → 300  (3×)
    ///  Score  4–6 → 500  (5×)
    ///  Score  7–10 → 800 (8×)
    ///  Score 11–15 → 1200 (12×)
    ///  Score  16+  → 2000 (20×)
    ///  House edge applied on top.
    ///
    /// @param absDistance   Absolute price-level distance (rows from current price).
    /// @param timeBuckets   Number of time buckets forward (columns).
    /// @param houseEdgeBps  House edge in basis points (e.g. 1000 = 10 %).
    /// @return mult100      Multiplier scaled ×100 (e.g. 300 = 3×).
    function calculateMultiplier(
        uint256 absDistance,
        uint256 timeBuckets,
        uint256 houseEdgeBps
    ) public pure returns (uint256 mult100) {
        require(absDistance > 0 && timeBuckets > 0, "invalid distance");
        uint256 score = absDistance * timeBuckets;

        uint256 raw;
        if      (score == 1)        raw = 200;
        else if (score <= 3)        raw = 300;
        else if (score <= 6)        raw = 500;
        else if (score <= 10)       raw = 800;
        else if (score <= 15)       raw = 1200;
        else                        raw = 2000;

        // Apply house edge: mult = raw × (1 − edge)
        mult100 = (raw * (10_000 - houseEdgeBps)) / 10_000;
    }

    /// @notice Returns the full multiplier grid for a token — used by the frontend
    ///         to render the grid UI without individual RPC calls per cell.
    /// @return priceBase    Current oracle price (8 dec).
    /// @return multipliers  Flattened array [row0col0, row0col1, ... rowNcolM].
    ///                      Row 0 = furthest up, row (gridHalfHeight*2) = furthest down.
    ///                      Column 0 = nearest bucket, column (gridWidth-1) = furthest.
    function getGridSnapshot(address token)
        external
        view
        returns (uint256 priceBase, uint256[] memory multipliers)
    {
        GridConfig memory cfg = gridConfigs[token];
        require(cfg.active, "token not active");

        (priceBase,) = oracle.getLatestPrice(token);
        require(priceBase > 0, "oracle unavailable");

        uint256 rows = uint256(cfg.gridHalfHeight) * 2; // rows above + below
        uint256 cols = cfg.gridWidth;
        multipliers  = new uint256[](rows * cols);

        for (uint256 r = 0; r < rows; r++) {
            // Row 0 = gridHalfHeight rows above, last row = gridHalfHeight rows below
            uint256 absRow = r < cfg.gridHalfHeight
                ? cfg.gridHalfHeight - r          // above centre
                : r - cfg.gridHalfHeight + 1;     // below centre

            for (uint256 c = 0; c < cols; c++) {
                multipliers[r * cols + c] = calculateMultiplier(
                    absRow,
                    c + 1,
                    cfg.houseEdgeBps
                );
            }
        }
    }

    /// @notice Check whether a bet's cell has resolved and whether it won.
    function betStatus(uint256 betId)
        external
        view
        returns (bool resolved, bool won, uint256 potentialPayout)
    {
        BetRecord memory bet = bets[betId];
        GridCell  memory cell = cells[bet.cellId];
        resolved       = cell.resolved;
        won            = cell.outcome;
        potentialPayout = (bet.amount * bet.multiplier) / 100;
    }
}
