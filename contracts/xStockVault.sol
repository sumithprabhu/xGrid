// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interfaces/IOracle.sol";

/// @title xStockVault
/// @notice Collateralised borrowing: deposit xStock tokens, borrow up to 70 % of
///         their current value in USDC — so a winner can stay in the xStocks
///         ecosystem while still accessing USDC liquidity for the next game.
///
///  Rates & limits (v1 — no per-block interest accrual)
///  ----------------------------------------------------
///  MAX_LTV            70 %   — maximum you can borrow against collateral
///  LIQ_THRESHOLD      78 %   — health factor below this triggers liquidation
///  LIQ_BONUS           5 %   — liquidator reward on top of seized collateral
///  BORROW_FEE_BPS     50 bp  — one-time 0.5 % fee on each borrow (goes to protocol)
///
///  Health factor
///  -------------
///  healthFactor = (collateral_value_usdc × LIQ_THRESHOLD_BPS) / (borrowed_usdc × 10_000)
///  Position is safe when healthFactor ≥ 1.0 (expressed as ≥ 10_000 in BPS form).
///
///  Decimal conventions
///  -------------------
///  xStock token  : 18 decimals
///  USDC          : 6 decimals
///  Oracle price  : 8 decimals  (see xStockToken for the scaling formula)
///  SCALE = 1e20 (same as xStockToken)

contract xStockVault is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─── Constants ────────────────────────────────────────────────────────────

    uint256 public constant MAX_LTV_BPS         = 7_000;   // 70 %
    uint256 public constant LIQ_THRESHOLD_BPS   = 7_800;   // 78 %
    uint256 public constant LIQ_BONUS_BPS       = 500;     // 5 %
    uint256 public constant BORROW_FEE_BPS      = 50;      // 0.5 %
    uint256 internal constant SCALE             = 1e20;    // TOKEN_UNIT/USDC_UNIT*ORACLE_UNIT

    // ─── Types ────────────────────────────────────────────────────────────────

    struct Position {
        uint256 collateral;  // xStock tokens deposited (18 dec)
        uint256 borrowed;    // USDC outstanding (6 dec)
    }

    // ─── State ────────────────────────────────────────────────────────────────

    IERC20  public immutable usdc;
    IOracle public oracle;

    /// @dev Supported collateral tokens (must be xStockToken instances).
    mapping(address => bool) public supportedTokens;

    /// @dev user → token → Position
    mapping(address => mapping(address => Position)) public positions;

    /// @dev Accumulated borrow fees in USDC (withdrawable by owner).
    uint256 public feesCollected;

    // ─── Events ───────────────────────────────────────────────────────────────

    event TokenAdded(address indexed token);
    event TokenRemoved(address indexed token);
    event Deposited(address indexed user, address indexed token, uint256 amount);
    event Borrowed(address indexed user, address indexed token, uint256 usdcAmount, uint256 fee);
    event Repaid(address indexed user, address indexed token, uint256 usdcAmount);
    event Withdrawn(address indexed user, address indexed token, uint256 amount);
    event Liquidated(
        address indexed user,
        address indexed token,
        address indexed liquidator,
        uint256 collateralSeized,
        uint256 debtRepaid
    );
    event PoolFunded(uint256 usdcAmount);
    event FeesWithdrawn(uint256 usdcAmount);
    event OracleUpdated(address indexed newOracle);

    // ─── Constructor ──────────────────────────────────────────────────────────

    constructor(address usdc_, address oracle_) Ownable(msg.sender) {
        require(usdc_   != address(0), "zero usdc");
        require(oracle_ != address(0), "zero oracle");
        usdc   = IERC20(usdc_);
        oracle = IOracle(oracle_);
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

    /// @notice Fund the USDC lending pool.
    function fundPool(uint256 usdcAmount) external onlyOwner {
        require(usdcAmount > 0, "zero amount");
        usdc.safeTransferFrom(msg.sender, address(this), usdcAmount);
        emit PoolFunded(usdcAmount);
    }

    /// @notice Withdraw collected borrow fees.
    function withdrawFees() external onlyOwner {
        uint256 amount = feesCollected;
        require(amount > 0, "no fees");
        feesCollected = 0;
        usdc.safeTransfer(msg.sender, amount);
        emit FeesWithdrawn(amount);
    }

    function setOracle(address oracle_) external onlyOwner {
        require(oracle_ != address(0), "zero oracle");
        oracle = IOracle(oracle_);
        emit OracleUpdated(oracle_);
    }

    // ─── User-facing ─────────────────────────────────────────────────────────

    /// @notice Deposit xStock tokens as collateral.
    function deposit(address token, uint256 amount) external nonReentrant {
        _requireSupported(token);
        require(amount > 0, "zero amount");
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        positions[msg.sender][token].collateral += amount;
        emit Deposited(msg.sender, token, amount);
    }

    /// @notice Borrow USDC against deposited collateral.
    /// @param token       The collateral xStock token.
    /// @param usdcAmount  USDC to borrow BEFORE fees (6 dec).
    function borrow(address token, uint256 usdcAmount) external nonReentrant {
        _requireSupported(token);
        require(usdcAmount > 0, "zero amount");

        Position storage pos = positions[msg.sender][token];
        require(pos.collateral > 0, "no collateral");

        uint256 maxBorrow = getMaxBorrow(msg.sender, token);
        require(pos.borrowed + usdcAmount <= maxBorrow, "exceeds 70% LTV");

        uint256 fee = (usdcAmount * BORROW_FEE_BPS) / 10_000;
        uint256 netUsdc = usdcAmount - fee;

        require(
            usdc.balanceOf(address(this)) - feesCollected >= netUsdc,
            "pool insufficient"
        );

        pos.borrowed += usdcAmount;
        feesCollected += fee;

        usdc.safeTransfer(msg.sender, netUsdc);

        emit Borrowed(msg.sender, token, usdcAmount, fee);
    }

    /// @notice Convenience: deposit collateral and borrow in a single call.
    function depositAndBorrow(
        address token,
        uint256 collateralAmount,
        uint256 borrowAmount
    ) external nonReentrant {
        _requireSupported(token);
        require(collateralAmount > 0, "zero collateral");
        require(borrowAmount > 0,     "zero borrow");

        IERC20(token).safeTransferFrom(msg.sender, address(this), collateralAmount);
        positions[msg.sender][token].collateral += collateralAmount;
        emit Deposited(msg.sender, token, collateralAmount);

        Position storage pos = positions[msg.sender][token];
        uint256 maxBorrow = getMaxBorrow(msg.sender, token);
        require(pos.borrowed + borrowAmount <= maxBorrow, "exceeds 70% LTV");

        uint256 fee    = (borrowAmount * BORROW_FEE_BPS) / 10_000;
        uint256 netUsdc = borrowAmount - fee;

        require(
            usdc.balanceOf(address(this)) - feesCollected >= netUsdc,
            "pool insufficient"
        );

        pos.borrowed  += borrowAmount;
        feesCollected += fee;

        usdc.safeTransfer(msg.sender, netUsdc);

        emit Borrowed(msg.sender, token, borrowAmount, fee);
    }

    /// @notice Repay outstanding USDC debt.
    /// @param token      The collateral token whose debt to repay.
    /// @param usdcAmount USDC to repay (6 dec). Capped at outstanding debt.
    function repay(address token, uint256 usdcAmount) external nonReentrant {
        _requireSupported(token);
        require(usdcAmount > 0, "zero amount");

        Position storage pos = positions[msg.sender][token];
        uint256 repayAmount = usdcAmount > pos.borrowed ? pos.borrowed : usdcAmount;
        require(repayAmount > 0, "no debt");

        pos.borrowed -= repayAmount;
        usdc.safeTransferFrom(msg.sender, address(this), repayAmount);

        emit Repaid(msg.sender, token, repayAmount);
    }

    /// @notice Withdraw collateral that is not backing outstanding debt.
    function withdraw(address token, uint256 amount) external nonReentrant {
        _requireSupported(token);
        require(amount > 0, "zero amount");

        Position storage pos = positions[msg.sender][token];
        require(pos.collateral >= amount, "exceeds collateral");

        // Compute health factor after withdrawal
        uint256 newCollateral = pos.collateral - amount;
        if (pos.borrowed > 0) {
            uint256 price           = _oraclePrice(token);
            uint256 newCollateralUsdc = _tokenToUsdc(newCollateral, price);
            uint256 minCollateral   = (pos.borrowed * 10_000) / LIQ_THRESHOLD_BPS;
            require(newCollateralUsdc >= minCollateral, "would breach LIQ threshold");
        }

        pos.collateral -= amount;
        IERC20(token).safeTransfer(msg.sender, amount);

        emit Withdrawn(msg.sender, token, amount);
    }

    /// @notice Liquidate an under-collateralised position.
    ///         Liquidator repays the user's full USDC debt and receives the
    ///         equivalent xStock collateral plus a 5 % bonus.
    /// @param user   Position owner to liquidate.
    /// @param token  Collateral token.
    function liquidate(address user, address token) external nonReentrant {
        _requireSupported(token);
        require(user != msg.sender, "cannot liquidate self");

        Position storage pos = positions[user][token];
        require(pos.borrowed > 0,    "no debt");
        require(!_isHealthy(user, token), "position is healthy");

        uint256 debt  = pos.borrowed;
        uint256 price = _oraclePrice(token);

        // Collateral equivalent to debt + liquidation bonus
        uint256 debtInTokens  = _usdcToToken(debt, price);
        uint256 bonus         = (debtInTokens * LIQ_BONUS_BPS) / 10_000;
        uint256 seize         = debtInTokens + bonus;

        // Cap at total collateral (can't seize more than exists)
        if (seize > pos.collateral) {
            seize = pos.collateral;
        }

        pos.borrowed   = 0;
        pos.collateral -= seize;

        // Liquidator pays the full debt in USDC
        usdc.safeTransferFrom(msg.sender, address(this), debt);

        // Liquidator receives seized xStock tokens
        IERC20(token).safeTransfer(msg.sender, seize);

        emit Liquidated(user, token, msg.sender, seize, debt);
    }

    // ─── Views ────────────────────────────────────────────────────────────────

    /// @notice Maximum additional USDC the user can borrow right now.
    function getMaxBorrow(address user, address token) public view returns (uint256) {
        Position memory pos = positions[user][token];
        if (pos.collateral == 0) return 0;
        uint256 price        = _oraclePrice(token);
        uint256 collateralUsdc = _tokenToUsdc(pos.collateral, price);
        uint256 maxDebt      = (collateralUsdc * MAX_LTV_BPS) / 10_000;
        return maxDebt > pos.borrowed ? maxDebt - pos.borrowed : 0;
    }

    /// @notice Current USDC value of a user's collateral.
    function getCollateralValue(address user, address token) public view returns (uint256) {
        uint256 price = _oraclePrice(token);
        return _tokenToUsdc(positions[user][token].collateral, price);
    }

    /// @notice Health factor as a BPS value (10_000 = 1.0 exactly at threshold).
    ///         Values ≥ 10_000 are safe.
    function getHealthFactor(address user, address token) public view returns (uint256) {
        Position memory pos = positions[user][token];
        if (pos.borrowed == 0) return type(uint256).max;
        uint256 price            = _oraclePrice(token);
        uint256 collateralUsdc   = _tokenToUsdc(pos.collateral, price);
        // healthFactor BPS = collateralUsdc * LIQ_THRESHOLD_BPS / borrowed
        return (collateralUsdc * LIQ_THRESHOLD_BPS) / pos.borrowed;
    }

    // ─── Internal ─────────────────────────────────────────────────────────────

    function _requireSupported(address token) internal view {
        require(supportedTokens[token], "token not supported");
    }

    function _isHealthy(address user, address token) internal view returns (bool) {
        return getHealthFactor(user, token) >= 10_000;
    }

    function _oraclePrice(address token) internal view returns (uint256 price) {
        (price,) = oracle.getLatestPrice(token);
        require(price > 0, "xStockVault: stale oracle");
    }

    /// @dev xStock tokens (18 dec) → USDC value (6 dec) given oracle price (8 dec).
    ///      usdcValue = tokenAmount × price / SCALE
    function _tokenToUsdc(uint256 tokenAmount, uint256 price)
        internal
        pure
        returns (uint256)
    {
        return (tokenAmount * price) / SCALE;
    }

    /// @dev USDC amount (6 dec) → xStock tokens (18 dec) given oracle price (8 dec).
    ///      tokens = usdcAmount × SCALE / price
    function _usdcToToken(uint256 usdcAmount, uint256 price)
        internal
        pure
        returns (uint256)
    {
        return (usdcAmount * SCALE) / price;
    }
}
