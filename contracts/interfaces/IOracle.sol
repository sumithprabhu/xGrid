// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IOracle
/// @notice Price oracle interface used by xStockToken, xStocksGrid, and xStockVault.
///         Prices are expressed with 8 decimal places (Chainlink-compatible).
///         Example: $190.00 → 19_000_000_000
interface IOracle {
    /// @notice Returns the latest price for a tracked asset.
    /// @param asset The asset identifier (address of xStockToken or underlying symbol hash).
    /// @return price   Current price, 8 decimals.
    /// @return updatedAt Unix timestamp of the price update.
    function getLatestPrice(address asset)
        external
        view
        returns (uint256 price, uint256 updatedAt);

    /// @notice Returns the settlement price for a specific past timestamp.
    ///         Used by xStocksGrid to resolve expired cells.
    /// @param asset        The asset identifier.
    /// @param timestamp    The Unix timestamp to query.
    /// @return price       Price at that timestamp, 8 decimals.
    /// @return available   False if no data exists for that timestamp yet.
    function getResolutionPrice(address asset, uint256 timestamp)
        external
        view
        returns (uint256 price, bool available);
}
