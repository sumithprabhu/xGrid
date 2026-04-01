// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../interfaces/IOracle.sol";

/// @title MockOracle
/// @notice Writable oracle for local development and testnet deployments.
///         The deployer (owner) sets prices manually; in production replace
///         with a Chainlink or Pyth adapter that implements IOracle.
contract MockOracle is IOracle {
    address public owner;

    /// @dev Latest price per asset.
    mapping(address => uint256) private _latestPrice;
    mapping(address => uint256) private _lastUpdated;

    /// @dev Historical / resolution prices: asset → timestamp → price
    mapping(address => mapping(uint256 => uint256)) private _resolutionPrices;

    event PriceUpdated(address indexed asset, uint256 price, uint256 ts);
    event ResolutionPriceSet(address indexed asset, uint256 ts, uint256 price);

    modifier onlyOwner() {
        require(msg.sender == owner, "MockOracle: not owner");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    // ─── Admin ────────────────────────────────────────────────────────────────

    /// @notice Push a live price for an asset (called by keeper / admin script).
    function setPrice(address asset, uint256 price) external onlyOwner {
        _latestPrice[asset] = price;
        _lastUpdated[asset] = block.timestamp;
        // Also write as resolution price at this exact second so
        // cells that expire right now can resolve immediately.
        _resolutionPrices[asset][block.timestamp] = price;
        emit PriceUpdated(asset, price, block.timestamp);
    }

    /// @notice Back-fill a resolution price for a past timestamp.
    ///         Used by keepers after a time bucket closes.
    function setResolutionPrice(
        address asset,
        uint256 timestamp,
        uint256 price
    ) external onlyOwner {
        _resolutionPrices[asset][timestamp] = price;
        emit ResolutionPriceSet(asset, timestamp, price);
    }

    /// @notice Convenience: set live price and resolution price in one call.
    function setPriceAt(
        address asset,
        uint256 timestamp,
        uint256 price
    ) external onlyOwner {
        _latestPrice[asset] = price;
        _lastUpdated[asset] = timestamp;
        _resolutionPrices[asset][timestamp] = price;
        emit PriceUpdated(asset, price, timestamp);
        emit ResolutionPriceSet(asset, timestamp, price);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "zero address");
        owner = newOwner;
    }

    // ─── IOracle ──────────────────────────────────────────────────────────────

    function getLatestPrice(address asset)
        external
        view
        override
        returns (uint256 price, uint256 updatedAt)
    {
        return (_latestPrice[asset], _lastUpdated[asset]);
    }

    function getResolutionPrice(address asset, uint256 timestamp)
        external
        view
        override
        returns (uint256 price, bool available)
    {
        price = _resolutionPrices[asset][timestamp];
        available = price > 0;
    }
}
