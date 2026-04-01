// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title PriceFeed
/// @notice On-chain price storage written to by the xStocks backend.
///
///  The backend fetches prices from the xStocks API and pushes them here.
///  xStocksGrid and xStockVault read from this contract.
///
///  Price format: 6 decimal places (e.g. 190_240_000 = $190.24)
///  Matches USDC precision — same unit used in GridMath calculations.
///
///  Resolution data includes (price, high, low) for the bucket window so
///  xStocksGrid can use TOUCH semantics for bet resolution.
///
///  Roles
///  -----
///  owner  — can set feeder, transfer ownership
///  feeder — the backend hot wallet that pushes live + resolution data
contract PriceFeed {
    address public owner;

    /// @notice The backend wallet address authorised to push prices.
    address public feeder;

    // ─── Structs ─────────────────────────────────────────────────────────────

    struct MarketState {
        bool isOpen;
        bool isOpeningWindow;   // First 30 min after market open
        bool isClosingWindow;   // Last 30 min before market close
        bool isAfterHours;
        bool isWeekend;
    }

    /// @notice High/low/close data for a resolved bucket window.
    struct ResolutionData {
        uint256 price;   // Close price at bucket expiry (6 dec)
        uint256 high;    // High during bucket window (6 dec)
        uint256 low;     // Low during bucket window (6 dec)
    }

    // ─── Storage ─────────────────────────────────────────────────────────────

    /// @dev Latest spot price per token (6 dec).
    mapping(address => uint256) public latestPrice;

    /// @dev Unix timestamp of the last spot-price update per token.
    mapping(address => uint256) public lastUpdated;

    /// @dev Market state per token — pushed by backend alongside price updates.
    mapping(address => MarketState) private _marketState;

    /// @dev Resolution data per token per bucket expiry.
    ///      token => bucketExpiry => ResolutionData
    mapping(address => mapping(uint256 => ResolutionData)) private _resolutionData;

    // ─── Events ───────────────────────────────────────────────────────────────

    event PriceUpdated(address indexed token, uint256 price, uint256 ts);
    event MarketStateUpdated(address indexed token, bool isOpen, bool isOpeningWindow, bool isClosingWindow);
    event ResolutionDataSet(address indexed token, uint256 indexed expiry, uint256 price, uint256 high, uint256 low);
    event FeederChanged(address indexed oldFeeder, address indexed newFeeder);
    event OwnershipTransferred(address indexed oldOwner, address indexed newOwner);

    // ─── Auth ─────────────────────────────────────────────────────────────────

    modifier onlyOwner() {
        require(msg.sender == owner, "PriceFeed: not owner");
        _;
    }

    modifier onlyFeeder() {
        require(msg.sender == feeder || msg.sender == owner, "PriceFeed: not feeder");
        _;
    }

    constructor(address feeder_) {
        require(feeder_ != address(0), "zero feeder");
        owner  = msg.sender;
        feeder = feeder_;
    }

    // ─── Feeder writes ────────────────────────────────────────────────────────

    /// @notice Push a live spot price + market state for a token.
    ///         Called by the backend on every price tick from the xStocks API.
    function setPrice(
        address token,
        uint256 price,
        bool isOpen,
        bool isOpeningWindow,
        bool isClosingWindow,
        bool isAfterHours,
        bool isWeekend
    ) external onlyFeeder {
        require(price > 0, "zero price");
        latestPrice[token]  = price;
        lastUpdated[token]  = block.timestamp;
        _marketState[token] = MarketState({
            isOpen:          isOpen,
            isOpeningWindow: isOpeningWindow,
            isClosingWindow: isClosingWindow,
            isAfterHours:    isAfterHours,
            isWeekend:       isWeekend
        });
        emit PriceUpdated(token, price, block.timestamp);
        emit MarketStateUpdated(token, isOpen, isOpeningWindow, isClosingWindow);
    }

    /// @notice Batch-push spot prices for multiple tokens in one transaction.
    ///         Keeps market state per token separate (call setPrice for each when state changes).
    function setPriceBatch(
        address[] calldata tokens,
        uint256[] calldata prices
    ) external onlyFeeder {
        require(tokens.length == prices.length, "length mismatch");
        for (uint256 i = 0; i < tokens.length; i++) {
            require(prices[i] > 0, "zero price");
            latestPrice[tokens[i]] = prices[i];
            lastUpdated[tokens[i]] = block.timestamp;
            emit PriceUpdated(tokens[i], prices[i], block.timestamp);
        }
    }

    /// @notice Push settlement data for a grid bucket after it closes.
    ///         Includes high/low of the bucket window for TOUCH resolution.
    ///         Called by the backend once per expiring bucket.
    function setResolutionData(
        address token,
        uint256 bucketExpiry,
        uint256 price,
        uint256 high,
        uint256 low
    ) external onlyFeeder {
        require(price > 0,                                 "zero price");
        require(high >= price,                             "high < price");
        require(low  <= price,                             "low > price");
        require(high >= low,                               "high < low");
        require(bucketExpiry <= block.timestamp + 1,       "bucket not closed");
        _resolutionData[token][bucketExpiry] = ResolutionData({ price: price, high: high, low: low });
        emit ResolutionDataSet(token, bucketExpiry, price, high, low);
    }

    /// @notice Batch-push resolution data (useful for multiple buckets or catch-up).
    function setResolutionDataBatch(
        address token,
        uint256[] calldata expiries,
        uint256[] calldata prices,
        uint256[] calldata highs,
        uint256[] calldata lows
    ) external onlyFeeder {
        require(expiries.length == prices.length, "length mismatch");
        require(expiries.length == highs.length,  "length mismatch");
        require(expiries.length == lows.length,   "length mismatch");
        for (uint256 i = 0; i < expiries.length; i++) {
            require(prices[i] > 0,            "zero price");
            require(highs[i] >= prices[i],    "high < price");
            require(lows[i]  <= prices[i],    "low > price");
            _resolutionData[token][expiries[i]] = ResolutionData({
                price: prices[i],
                high:  highs[i],
                low:   lows[i]
            });
            emit ResolutionDataSet(token, expiries[i], prices[i], highs[i], lows[i]);
        }
    }

    // ─── Views ────────────────────────────────────────────────────────────────

    /// @notice Returns the latest price and how stale it is (seconds since update).
    function getLatestPrice(address token)
        external
        view
        returns (uint256 price, uint256 staleness)
    {
        price     = latestPrice[token];
        staleness = lastUpdated[token] == 0 ? type(uint256).max : block.timestamp - lastUpdated[token];
    }

    /// @notice Returns the market state for a token.
    function getMarketState(address token)
        external
        view
        returns (
            bool isOpen,
            bool isOpeningWindow,
            bool isClosingWindow,
            bool isAfterHours,
            bool isWeekend
        )
    {
        MarketState memory s = _marketState[token];
        return (s.isOpen, s.isOpeningWindow, s.isClosingWindow, s.isAfterHours, s.isWeekend);
    }

    /// @notice Returns settlement data for a bucket, plus whether it has been pushed.
    function getResolutionData(address token, uint256 expiry)
        external
        view
        returns (uint256 price, uint256 high, uint256 low, bool available)
    {
        ResolutionData memory d = _resolutionData[token][expiry];
        price     = d.price;
        high      = d.high;
        low       = d.low;
        available = d.price > 0;
    }

    // ─── Admin ────────────────────────────────────────────────────────────────

    function setFeeder(address newFeeder) external onlyOwner {
        require(newFeeder != address(0), "zero address");
        emit FeederChanged(feeder, newFeeder);
        feeder = newFeeder;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "zero address");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }
}
