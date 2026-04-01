// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./PriceFeed.sol";
import "./GridToken.sol";
import "./xStocksGrid.sol";

/// @title xStockVault
/// @notice Stake real xStock tokens (wQQQx, wSPYx, …) to get GridTokens.
///
///  FLOW
///  ----
///  1. User wins GridTokens on the grid.
///  2. User redeems GridTokens → USDC (via xStocksGrid.redeemForUsdc).
///  3. Backend calls xChange API → swaps USDC → real xQQQ → sent to user's wallet.
///  4. User now holds real wQQQx (from Backed).
///  5. User calls stake(wQQQx, amount):
///       → Locks wQQQx as collateral
///       → Mints 70% of its USDC value as gxQQQx GridTokens
///       → User plays the grid again with fresh GridTokens
///  6. To unlock: call unstake(wQQQx, amount) — burns proportional GridTokens.
///
///  EXAMPLE
///  -------
///  wQQQx price = $480.  User stakes 1 wQQQx.
///    Collateral value = 1 × $480 = $480 USDC
///    GridTokens minted = $480 × 70% = 336 GridTokens (gxQQQx)
///    (each GridToken = $1, so 336 GridTokens = $336 of play credit)
///
///  LIQUIDATION
///  -----------
///  If wQQQx price drops so that:
///    gridTokensMinted > collateralUsdcValue × LIQ_THRESHOLD (78%)
///  the position can be liquidated. Liquidator repays GridTokens,
///  receives the collateral + 5% bonus.
///
///  RATES
///  -----
///  STAKE_LTV_BPS       70%  — GridTokens minted = collateral × 70%
///  LIQ_THRESHOLD_BPS   78%  — liquidation trigger
///  LIQ_BONUS_BPS        5%  — liquidator reward
///
contract xStockVault is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─── Constants ────────────────────────────────────────────────────────────

    uint256 public constant STAKE_LTV_BPS      = 7_000;  // 70%
    uint256 public constant LIQ_THRESHOLD_BPS  = 7_800;  // 78%
    uint256 public constant LIQ_BONUS_BPS      = 500;    // 5%

    // token(18dec) * price(6dec) / PRICE_SCALE = usdc(6dec)
    uint256 internal constant PRICE_SCALE = 1e18;

    // GridToken(18dec) = USDC(6dec) * GT_TO_USDC
    uint256 internal constant GT_TO_USDC  = 1e12;

    // ─── Types ────────────────────────────────────────────────────────────────

    struct Position {
        uint256 collateral;        // xStock tokens staked (18 dec)
        uint256 gridTokensMinted;  // GridTokens minted against this collateral (18 dec)
    }

    // ─── State ────────────────────────────────────────────────────────────────

    PriceFeed    public priceFeed;
    GridToken    public gdUSD;     // single unified grid token
    xStocksGrid  public grid;      // to verify token is active on the grid

    mapping(address => bool)    public supportedTokens;

    /// @dev user => xStockToken => Position
    mapping(address => mapping(address => Position)) public positions;

    // ─── Events ───────────────────────────────────────────────────────────────

    event TokenAdded(address indexed token);
    event TokenRemoved(address indexed token);
    event Staked(
        address indexed user,
        address indexed token,
        uint256 collateralAmount,
        uint256 gridTokensMinted
    );
    event Unstaked(
        address indexed user,
        address indexed token,
        uint256 collateralReturned,
        uint256 gridTokensBurned
    );
    event Liquidated(
        address indexed user,
        address indexed token,
        address indexed liquidator,
        uint256 collateralSeized,
        uint256 gridTokensRepaid
    );

    // ─── Constructor ──────────────────────────────────────────────────────────

    constructor(address priceFeed_, address grid_, address gdUSD_) Ownable(msg.sender) {
        require(priceFeed_ != address(0), "zero priceFeed");
        require(grid_      != address(0), "zero grid");
        require(gdUSD_     != address(0), "zero gdUSD");
        priceFeed = PriceFeed(priceFeed_);
        grid      = xStocksGrid(grid_);
        gdUSD     = GridToken(gdUSD_);
    }

    // ─── Admin ────────────────────────────────────────────────────────────────

    function addSupportedToken(address token) external onlyOwner {
        supportedTokens[token] = true;
        emit TokenAdded(token);
    }

    function removeSupportedToken(address token) external onlyOwner {
        supportedTokens[token] = false;
        emit TokenRemoved(token);
    }

    function setPriceFeed(address pf) external onlyOwner {
        require(pf != address(0), "zero");
        priceFeed = PriceFeed(pf);
    }

    // ─── Staking ──────────────────────────────────────────────────────────────

    /// @notice Stake real xStock tokens, receive GridTokens = 70% of stake value.
    ///
    ///         Example: stake 1 wQQQx worth $480
    ///           → mints 336 gxQQQx GridTokens (= $336 play credit)
    ///
    /// @param token   xStock token address (e.g. wQQQx).
    /// @param amount  Amount of xStock tokens to stake (18 dec).
    /// @return gridTokensMinted  GridTokens received (18 dec = USDC value).
    function stake(address token, uint256 amount)
        external nonReentrant
        returns (uint256 gridTokensMinted)
    {
        require(supportedTokens[token], "token not supported");
        require(amount > 0, "zero amount");

        uint256 price = _price(token);

        // collateralUsdc = amount(18dec) * price(6dec) / 1e18  →  usdc(6dec)
        uint256 collateralUsdc = (amount * price) / PRICE_SCALE;
        require(collateralUsdc > 0, "too small");

        // GridTokens = 70% of collateral value  (1 GT = $1)
        // usdc(6dec) * GT_TO_USDC → gridTokens(18dec)
        uint256 stakeUsdc    = (collateralUsdc * STAKE_LTV_BPS) / 10_000;
        gridTokensMinted     = stakeUsdc * GT_TO_USDC;

        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

        positions[msg.sender][token].collateral       += amount;
        positions[msg.sender][token].gridTokensMinted += gridTokensMinted;

        gdUSD.mint(msg.sender, gridTokensMinted);

        emit Staked(msg.sender, token, amount, gridTokensMinted);
    }

    /// @notice Unstake xStock tokens by burning GridTokens.
    ///         Burns proportional GridTokens and returns proportional collateral.
    ///
    ///         Example: staked 1 wQQQx, received 336 gxQQQx.
    ///           Burn 336 gxQQQx → get back 1 wQQQx.
    ///           Burn 168 gxQQQx → get back 0.5 wQQQx.
    ///
    /// @param token            xStock token address.
    /// @param gridTokenAmount  GridTokens to burn (18 dec).
    /// @return collateralOut   xStock tokens returned (18 dec).
    function unstake(address token, uint256 gridTokenAmount)
        external nonReentrant
        returns (uint256 collateralOut)
    {
        require(supportedTokens[token], "token not supported");

        Position storage pos = positions[msg.sender][token];
        require(pos.gridTokensMinted >= gridTokenAmount, "exceeds minted");
        require(pos.collateral > 0, "no collateral");

        // Proportional collateral: collateralOut / collateral = gridTokensBurned / gridTokensMinted
        collateralOut = (gridTokenAmount * pos.collateral) / pos.gridTokensMinted;
        require(collateralOut > 0, "rounds to zero");

        pos.gridTokensMinted -= gridTokenAmount;
        pos.collateral       -= collateralOut;

        gdUSD.burn(msg.sender, gridTokenAmount);
        IERC20(token).safeTransfer(msg.sender, collateralOut);

        emit Unstaked(msg.sender, token, collateralOut, gridTokenAmount);
    }

    /// @notice Liquidate an undercollateralised position.
    ///         Callable by anyone when:
    ///           gridTokensMinted > collateralUsdcValue × 78%
    ///
    ///         Liquidator repays all GridTokens, receives collateral + 5% bonus.
    function liquidate(address user, address token) external nonReentrant {
        require(supportedTokens[token], "not supported");
        require(user != msg.sender, "cannot liquidate self");

        Position storage pos = positions[user][token];
        require(pos.gridTokensMinted > 0, "no position");
        require(!_isHealthy(user, token),  "position is healthy");

        uint256 debt  = pos.gridTokensMinted;       // GridTokens to repay (18 dec)
        uint256 price = _price(token);

        // Collateral tokens equivalent to the debt value + 5% bonus
        // debtUsdc = debt(18dec) / GT_TO_USDC → usdc(6dec)
        uint256 debtUsdc    = debt / GT_TO_USDC;
        // debtTokens = debtUsdc(6dec) / price(6dec) * PRICE_SCALE → tokens(18dec)
        uint256 debtTokens  = (debtUsdc * PRICE_SCALE) / price;
        uint256 bonus       = (debtTokens * LIQ_BONUS_BPS) / 10_000;
        uint256 seize       = debtTokens + bonus;
        if (seize > pos.collateral) seize = pos.collateral;

        pos.gridTokensMinted = 0;
        pos.collateral      -= seize;

        gdUSD.burn(msg.sender, debt);
        IERC20(token).safeTransfer(msg.sender, seize);

        emit Liquidated(user, token, msg.sender, seize, debt);
    }

    // ─── Views ────────────────────────────────────────────────────────────────

    /// @notice Health factor as BPS. >= 10_000 = safe.
    ///         health = (collateralUsdcValue × LIQ_THRESHOLD) / gridTokensMintedUsdc
    function getHealthFactor(address user, address token) public view returns (uint256) {
        Position memory pos = positions[user][token];
        if (pos.gridTokensMinted == 0) return type(uint256).max;

        uint256 price          = priceFeed.latestPrice(token);
        uint256 collateralUsdc = (pos.collateral * price) / PRICE_SCALE;
        uint256 debtUsdc       = pos.gridTokensMinted / GT_TO_USDC;

        return (collateralUsdc * LIQ_THRESHOLD_BPS) / debtUsdc;
    }

    /// @notice How many more GridTokens can be minted against current collateral.
    function getAvailableGridTokens(address user, address token)
        external view returns (uint256)
    {
        Position memory pos    = positions[user][token];
        if (pos.collateral == 0) return 0;

        uint256 price          = priceFeed.latestPrice(token);
        uint256 collateralUsdc = (pos.collateral * price) / PRICE_SCALE;
        uint256 maxUsdc        = (collateralUsdc * STAKE_LTV_BPS) / 10_000;
        uint256 maxGT          = maxUsdc * GT_TO_USDC;

        return maxGT > pos.gridTokensMinted ? maxGT - pos.gridTokensMinted : 0;
    }

    /// @notice Current USDC value of staked collateral.
    function getCollateralValue(address user, address token)
        external view returns (uint256 usdcValue)
    {
        Position memory pos = positions[user][token];
        uint256 price       = priceFeed.latestPrice(token);
        usdcValue           = (pos.collateral * price) / PRICE_SCALE;
    }

    // ─── Internal ─────────────────────────────────────────────────────────────

    function _price(address token) internal view returns (uint256 price) {
        price = priceFeed.latestPrice(token);
        require(price > 0, "xStockVault: price not available");
    }

    function _isHealthy(address user, address token) internal view returns (bool) {
        return getHealthFactor(user, token) >= 10_000;
    }
}
