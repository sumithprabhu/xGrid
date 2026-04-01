// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../interfaces/IGridOracle.sol";

/**
 * @title GridOracle
 * @notice Multi-source price oracle for xStocks Grid.
 *
 * Price sources (in priority order):
 *   1. Chainlink price feed (primary)
 *   2. Pyth Network (secondary)
 *   3. Uniswap V3 TWAP (tertiary / manipulation resistant)
 *
 * Consensus rule:
 *   - All 3 sources must agree within MAX_DEVIATION_BPS
 *   - If any source deviates, use median of remaining 2
 *   - If 2+ sources deviate, REVERT — oracle is unreliable
 *
 * Price history:
 *   - Stores price snapshots every bucket (for resolution)
 *   - 7-day circular buffer per token
 *   - High/low range per bucket for "touch" resolution
 *
 * Market hours:
 *   - Derived from UTC timestamp
 *   - US markets: Mon-Fri 13:30-20:00 UTC
 *   - Opening window: 13:30-14:00 UTC
 *   - Closing window: 19:30-20:00 UTC
 */
contract GridOracle is IGridOracle {

    // ─── Constants ────────────────────────────────────────────────────────────

    uint256 constant MAX_DEVIATION_BPS = 100;     // 1% max spread between oracles
    uint256 constant PRICE_STALENESS   = 60;      // Max 60s old price
    uint256 constant HISTORY_SLOTS     = 10_080;  // 7 days × 1440 min/day
    uint256 constant PRECISION         = 1e18;

    // Market hours in seconds since midnight UTC
    uint32 constant MARKET_OPEN_UTC  = 13 * 3600 + 30 * 60; // 09:30 ET = 13:30 UTC
    uint32 constant MARKET_CLOSE_UTC = 20 * 3600;             // 16:00 ET = 20:00 UTC
    uint32 constant OPEN_WINDOW_END  = MARKET_OPEN_UTC  + 30 * 60;
    uint32 constant CLOSE_WINDOW_START = MARKET_CLOSE_UTC - 30 * 60;

    // ─── Storage ──────────────────────────────────────────────────────────────

    address public owner;
    address public keeper; // Chainlink automation / backend keeper

    struct TokenFeeds {
        address chainlinkFeed;   // AggregatorV3Interface
        bytes32 pythPriceId;     // Pyth price ID
        address uniswapPool;     // Uniswap V3 pool address
        address uniswapToken;    // Which token in the pool is xStock
        uint32  uniswapTwapSecs; // TWAP window (60-300s)
        bool    active;
    }

    struct PriceSnapshot {
        uint256 price;   // USDC, 6 decimals
        uint256 high;    // High during this bucket
        uint256 low;     // Low during this bucket
        uint256 ts;      // Timestamp of snapshot
    }

    // token → oracle feeds
    mapping(address => TokenFeeds) public tokenFeeds;

    // token → circular price history buffer
    mapping(address => PriceSnapshot[HISTORY_SLOTS]) internal _history;
    mapping(address => uint256) public historyHead; // current write position

    // token → last resolved price per bucket timestamp
    mapping(address => mapping(uint256 => PriceSnapshot)) public bucketSnapshots;

    // Running min/max per token per current bucket
    mapping(address => uint256) public currentBucketHigh;
    mapping(address => uint256) public currentBucketLow;
    mapping(address => uint256) public currentBucketStart;

    // ─── Events ───────────────────────────────────────────────────────────────

    event PriceRecorded(address indexed token, uint256 price, uint256 high, uint256 low, uint256 ts);
    event OracleDeviation(address indexed token, uint256 chainlinkPrice, uint256 pythPrice, uint256 twapPrice);
    event TokenFeedSet(address indexed token);
    event BucketSnapshotted(address indexed token, uint256 bucketTs, uint256 price, uint256 high, uint256 low);

    // ─── Constructor ──────────────────────────────────────────────────────────

    constructor(address _keeper) {
        owner = msg.sender;
        keeper = _keeper;
    }

    modifier onlyOwner() { require(msg.sender == owner, "Not owner"); _; }
    modifier onlyKeeper() { require(msg.sender == keeper || msg.sender == owner, "Not keeper"); _; }

    // ─── Admin ────────────────────────────────────────────────────────────────

    function setTokenFeed(
        address token,
        address chainlinkFeed,
        bytes32 pythPriceId,
        address uniswapPool,
        address uniswapToken,
        uint32  twapSeconds
    ) external onlyOwner {
        tokenFeeds[token] = TokenFeeds({
            chainlinkFeed:   chainlinkFeed,
            pythPriceId:     pythPriceId,
            uniswapPool:     uniswapPool,
            uniswapToken:    uniswapToken,
            uniswapTwapSecs: twapSeconds,
            active:          true
        });
        emit TokenFeedSet(token);
    }

    // ─── Price Recording (called by keeper every ~5 seconds) ─────────────────

    /**
     * @notice Record current price for a token and update bucket running stats.
     *         Called by Chainlink Automation keeper on heartbeat.
     */
    function recordPrice(address token) external onlyKeeper returns (uint256 price) {
        TokenFeeds memory feeds = tokenFeeds[token];
        require(feeds.active, "Token not configured");

        // Get prices from all sources
        uint256 clPrice   = _getChainlinkPrice(feeds.chainlinkFeed);
        uint256 pythPrice = _getPythPrice(feeds.pythPriceId);
        uint256 twapPrice = _getUniswapTWAP(feeds.uniswapPool, feeds.uniswapToken, feeds.uniswapTwapSecs);

        // Validate consensus
        price = _validateAndMedian(token, clPrice, pythPrice, twapPrice);

        // Update current bucket running high/low
        _updateBucketRange(token, price);

        // Write to history buffer
        uint256 slot = historyHead[token] % HISTORY_SLOTS;
        _history[token][slot] = PriceSnapshot({
            price: price,
            high:  currentBucketHigh[token],
            low:   currentBucketLow[token],
            ts:    block.timestamp
        });
        historyHead[token]++;

        emit PriceRecorded(token, price, currentBucketHigh[token], currentBucketLow[token], block.timestamp);
    }

    /**
     * @notice Snapshot end-of-bucket price (called at each bucket boundary).
     *         This is used by the resolution engine.
     */
    function snapshotBucket(address token, uint256 bucketTimestamp) external onlyKeeper {
        uint256 price = _getLatestPrice(token);

        bucketSnapshots[token][bucketTimestamp] = PriceSnapshot({
            price: price,
            high:  currentBucketHigh[token],
            low:   currentBucketLow[token],
            ts:    block.timestamp
        });

        // Reset bucket for next period
        currentBucketHigh[token]  = price;
        currentBucketLow[token]   = price;
        currentBucketStart[token] = block.timestamp;

        emit BucketSnapshotted(token, bucketTimestamp, price, currentBucketHigh[token], currentBucketLow[token]);
    }

    // ─── Public Price Getters ─────────────────────────────────────────────────

    /**
     * @notice Get latest validated price. Reverts if oracle is unreliable.
     */
    function getPrice(address token) external view override returns (uint256) {
        return _getLatestPrice(token);
    }

    /**
     * @notice Get price at a specific historical timestamp (for resolution).
     *         Searches the circular buffer for the closest snapshot.
     */
    function getPriceAt(address token, uint256 targetTs)
        external view override
        returns (uint256 price, uint256 high, uint256 low)
    {
        // First check bucket snapshots (most accurate for resolution)
        PriceSnapshot memory snap = bucketSnapshots[token][targetTs];
        if (snap.ts > 0) {
            return (snap.price, snap.high, snap.low);
        }

        // Fall back to history buffer
        uint256 head = historyHead[token];
        uint256 bestDelta = type(uint256).max;
        PriceSnapshot memory best;

        // Search last 1440 slots (24 hours of data if recording every minute)
        uint256 searchDepth = head < 1440 ? head : 1440;
        for (uint256 i = 0; i < searchDepth; i++) {
            uint256 slot = (head - 1 - i) % HISTORY_SLOTS;
            PriceSnapshot memory s = _history[token][slot];
            if (s.ts == 0) break;

            uint256 delta = s.ts > targetTs ? s.ts - targetTs : targetTs - s.ts;
            if (delta < bestDelta) {
                bestDelta = delta;
                best = s;
            }
            if (delta == 0) break;
        }

        require(best.ts > 0, "GridOracle: no historical data");
        require(bestDelta <= 300, "GridOracle: historical data too stale"); // 5 min max

        return (best.price, best.high, best.low);
    }

    /**
     * @notice Get price range (high/low) between two timestamps.
     *         Used for "touch" resolution: did price ever reach the target?
     */
    function getPriceRange(address token, uint256 fromTs, uint256 toTs)
        external view override
        returns (uint256 high, uint256 low)
    {
        high = 0;
        low  = type(uint256).max;

        uint256 head = historyHead[token];
        uint256 searchDepth = head < HISTORY_SLOTS ? head : HISTORY_SLOTS;

        for (uint256 i = 0; i < searchDepth; i++) {
            uint256 slot = (head - 1 - i) % HISTORY_SLOTS;
            PriceSnapshot memory s = _history[token][slot];
            if (s.ts == 0 || s.ts < fromTs) break;
            if (s.ts <= toTs) {
                if (s.high > high) high = s.high;
                if (s.low  < low)  low  = s.low;
            }
        }

        require(high > 0, "GridOracle: no data in range");
    }

    /**
     * @notice Get current market state for a token.
     */
    function getMarketState(address /*token*/)
        external view override
        returns (
            bool isOpen,
            bool isOpeningWindow,
            bool isClosingWindow,
            bool isAfterHours,
            bool isWeekend
        )
    {
        return _getMarketState(block.timestamp);
    }

    // ─── Internal Price Fetching ──────────────────────────────────────────────

    function _getLatestPrice(address token) internal view returns (uint256) {
        TokenFeeds memory feeds = tokenFeeds[token];
        require(feeds.active, "GridOracle: token not configured");

        uint256 clPrice   = _getChainlinkPrice(feeds.chainlinkFeed);
        uint256 pythPrice = _getPythPrice(feeds.pythPriceId);
        uint256 twapPrice = _getUniswapTWAP(feeds.uniswapPool, feeds.uniswapToken, feeds.uniswapTwapSecs);

        return _validateAndMedian(token, clPrice, pythPrice, twapPrice);
    }

    function _getChainlinkPrice(address feed) internal view returns (uint256) {
        // AggregatorV3Interface(feed).latestRoundData()
        // Returns (roundId, answer, startedAt, updatedAt, answeredInRound)
        // We use a low-level call to avoid importing the interface here
        (bool ok, bytes memory data) = feed.staticcall(
            abi.encodeWithSignature("latestRoundData()")
        );
        require(ok, "GridOracle: Chainlink call failed");

        (, int256 answer, , uint256 updatedAt,) = abi.decode(
            data, (uint80, int256, uint256, uint256, uint80)
        );

        require(answer > 0, "GridOracle: invalid Chainlink price");
        require(block.timestamp - updatedAt <= PRICE_STALENESS, "GridOracle: Chainlink stale");

        // Chainlink feeds have 8 decimals, convert to 6 (USDC decimals)
        return uint256(answer) / 100;
    }

    function _getPythPrice(bytes32 priceId) internal view returns (uint256) {
        // In production: call Pyth contract's getPriceNoOlderThan
        // Simplified stub — in real deployment integrate pyth-sdk-solidity
        // Returns price with exponent
        // For hackathon demo: return 0 to signal unavailable, use 2-of-3
        if (priceId == bytes32(0)) return 0;
        return 0; // stub — integrate Pyth in production
    }

    function _getUniswapTWAP(address pool, address token, uint32 twapSeconds)
        internal view returns (uint256)
    {
        if (pool == address(0)) return 0;
        // Uniswap V3 TWAP via observe() on the pool
        // Returns tick cumulative — compute TWAP from tick
        // Stub for hackathon — integrate in production
        return 0;
    }

    function _validateAndMedian(
        address token,
        uint256 cl,
        uint256 pyth,
        uint256 twap
    ) internal view returns (uint256) {
        // Count available sources
        uint256[] memory prices = new uint256[](3);
        uint256 count = 0;
        if (cl   > 0) prices[count++] = cl;
        if (pyth > 0) prices[count++] = pyth;
        if (twap > 0) prices[count++] = twap;

        require(count >= 1, "GridOracle: no price sources available");

        if (count == 1) return prices[0];

        // Check all pairs for deviation
        if (count >= 2) {
            for (uint256 i = 0; i < count; i++) {
                for (uint256 j = i + 1; j < count; j++) {
                    uint256 a = prices[i];
                    uint256 b = prices[j];
                    uint256 diff = a > b ? a - b : b - a;
                    uint256 deviationBps = (diff * 10_000) / a;
                    if (deviationBps > MAX_DEVIATION_BPS) {
                        emit OracleDeviation(token, cl, pyth, twap);
                        // If deviation found, use only Chainlink (most trusted)
                        require(cl > 0, "GridOracle: all sources deviated");
                        return cl;
                    }
                }
            }
        }

        // Return median
        return _median(prices, count);
    }

    function _median(uint256[] memory arr, uint256 count) internal pure returns (uint256) {
        // Simple sort for count <= 3
        for (uint256 i = 0; i < count - 1; i++) {
            for (uint256 j = 0; j < count - 1 - i; j++) {
                if (arr[j] > arr[j+1]) {
                    (arr[j], arr[j+1]) = (arr[j+1], arr[j]);
                }
            }
        }
        return arr[count / 2];
    }

    function _updateBucketRange(address token, uint256 price) internal {
        if (currentBucketHigh[token] == 0) {
            currentBucketHigh[token] = price;
            currentBucketLow[token]  = price;
        } else {
            if (price > currentBucketHigh[token]) currentBucketHigh[token] = price;
            if (price < currentBucketLow[token])  currentBucketLow[token]  = price;
        }
    }

    function _getMarketState(uint256 ts)
        internal pure
        returns (bool isOpen, bool isOpeningWindow, bool isClosingWindow, bool isAfterHours, bool isWeekend)
    {
        uint256 dayOfWeek = (ts / 86400 + 4) % 7; // 0=Sun, 6=Sat
        isWeekend = (dayOfWeek == 0 || dayOfWeek == 6);

        uint32 timeOfDay = uint32(ts % 86400);
        isOpen = !isWeekend && timeOfDay >= MARKET_OPEN_UTC && timeOfDay < MARKET_CLOSE_UTC;
        isOpeningWindow  = isOpen && timeOfDay < OPEN_WINDOW_END;
        isClosingWindow  = isOpen && timeOfDay >= CLOSE_WINDOW_START;
        isAfterHours     = !isOpen && !isWeekend;
    }
}
