// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IGridOracle {
    function getPrice(address token) external view returns (uint256);
    function getPriceAt(address token, uint256 targetTs)
        external view returns (uint256 price, uint256 high, uint256 low);
    function getPriceRange(address token, uint256 fromTs, uint256 toTs)
        external view returns (uint256 high, uint256 low);
    function getMarketState(address token)
        external view returns (
            bool isOpen,
            bool isOpeningWindow,
            bool isClosingWindow,
            bool isAfterHours,
            bool isWeekend
        );
}

interface IxStocksToken {
    function balanceOf(address account) external view returns (uint256);
    function symbol() external view returns (string memory);
    function decimals() external view returns (uint8);
}

interface IEulerLending {
    function deposit(uint256 subAccountId, uint256 amount) external;
    function withdraw(uint256 subAccountId, uint256 amount) external;
    function balanceOfUnderlying(address account) external view returns (uint256);
}

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
}
