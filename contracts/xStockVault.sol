// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./PriceFeed.sol";

/// @title xStockVault
/// @notice Collateralised USDC borrowing against xStocks tokenized equities.
///         Users deposit real xStocks ERC-20 tokens (xAAPL, xTSLA, …) as
///         collateral and borrow up to 70 % of their current value in USDC.
///         Prices come from the xStocks API, pushed on-chain via PriceFeed.sol.
///
///  Rates (v1 — no per-block interest)
///  ------------------------------------
///  MAX_LTV            70 %   — max borrow against collateral
///  LIQ_THRESHOLD      78 %   — liquidation kicks in here
///  LIQ_BONUS           5 %   — liquidator reward
///  BORROW_FEE_BPS     50 bp  — one-time 0.5 % fee per borrow call
///
///  SCALE = 1e18  (token(18dec) * price(6dec) / 1e18 = USDC(6dec))
contract xStockVault is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─── Constants ────────────────────────────────────────────────────────────

    uint256 public constant MAX_LTV_BPS       = 7_000;  // 70%
    uint256 public constant LIQ_THRESHOLD_BPS = 7_800;  // 78%
    uint256 public constant LIQ_BONUS_BPS     = 500;    // 5%
    uint256 public constant BORROW_FEE_BPS    = 50;     // 0.5%
    uint256 internal constant SCALE           = 1e18;

    // ─── Types ────────────────────────────────────────────────────────────────

    struct Position {
        uint256 collateral; // xStock tokens deposited (18 dec)
        uint256 borrowed;   // USDC outstanding (6 dec)
    }

    // ─── State ────────────────────────────────────────────────────────────────

    IERC20    public immutable usdc;
    PriceFeed public priceFeed;

    mapping(address => bool) public supportedTokens;

    /// @dev user => token => Position
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

    // ─── Constructor ──────────────────────────────────────────────────────────

    constructor(address usdc_, address priceFeed_) Ownable(msg.sender) {
        require(usdc_      != address(0), "zero usdc");
        require(priceFeed_ != address(0), "zero priceFeed");
        usdc      = IERC20(usdc_);
        priceFeed = PriceFeed(priceFeed_);
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

    function fundPool(uint256 usdcAmount) external onlyOwner {
        require(usdcAmount > 0, "zero amount");
        usdc.safeTransferFrom(msg.sender, address(this), usdcAmount);
        emit PoolFunded(usdcAmount);
    }

    function withdrawFees() external onlyOwner {
        uint256 amount = feesCollected;
        require(amount > 0, "no fees");
        feesCollected = 0;
        usdc.safeTransfer(msg.sender, amount);
        emit FeesWithdrawn(amount);
    }

    function setPriceFeed(address priceFeed_) external onlyOwner {
        require(priceFeed_ != address(0), "zero address");
        priceFeed = PriceFeed(priceFeed_);
    }

    // ─── User-facing ─────────────────────────────────────────────────────────

    function deposit(address token, uint256 amount) external nonReentrant {
        _requireSupported(token);
        require(amount > 0, "zero amount");
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        positions[msg.sender][token].collateral += amount;
        emit Deposited(msg.sender, token, amount);
    }

    /// @notice Borrow USDC against deposited collateral (up to 70% LTV).
    /// @param token       Collateral xStock token.
    /// @param usdcAmount  Gross USDC to borrow before the 0.5% fee.
    function borrow(address token, uint256 usdcAmount) external nonReentrant {
        _requireSupported(token);
        require(usdcAmount > 0, "zero amount");

        Position storage pos = positions[msg.sender][token];
        require(pos.collateral > 0, "no collateral");

        uint256 maxBorrow = getMaxBorrow(msg.sender, token);
        require(pos.borrowed + usdcAmount <= maxBorrow, "exceeds 70% LTV");

        uint256 fee     = (usdcAmount * BORROW_FEE_BPS) / 10_000;
        uint256 netUsdc = usdcAmount - fee;
        require(usdc.balanceOf(address(this)) - feesCollected >= netUsdc, "pool insufficient");

        pos.borrowed  += usdcAmount;
        feesCollected += fee;

        usdc.safeTransfer(msg.sender, netUsdc);
        emit Borrowed(msg.sender, token, usdcAmount, fee);
    }

    /// @notice Deposit collateral and borrow USDC in one transaction.
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

        uint256 fee     = (borrowAmount * BORROW_FEE_BPS) / 10_000;
        uint256 netUsdc = borrowAmount - fee;
        require(usdc.balanceOf(address(this)) - feesCollected >= netUsdc, "pool insufficient");

        pos.borrowed  += borrowAmount;
        feesCollected += fee;

        usdc.safeTransfer(msg.sender, netUsdc);
        emit Borrowed(msg.sender, token, borrowAmount, fee);
    }

    /// @notice Repay outstanding USDC debt.
    function repay(address token, uint256 usdcAmount) external nonReentrant {
        _requireSupported(token);
        require(usdcAmount > 0, "zero amount");

        Position storage pos = positions[msg.sender][token];
        uint256 repayAmount  = usdcAmount > pos.borrowed ? pos.borrowed : usdcAmount;
        require(repayAmount > 0, "no debt");

        pos.borrowed -= repayAmount;
        usdc.safeTransferFrom(msg.sender, address(this), repayAmount);
        emit Repaid(msg.sender, token, repayAmount);
    }

    /// @notice Withdraw collateral not backing outstanding debt.
    function withdraw(address token, uint256 amount) external nonReentrant {
        _requireSupported(token);
        require(amount > 0, "zero amount");

        Position storage pos = positions[msg.sender][token];
        require(pos.collateral >= amount, "exceeds collateral");

        if (pos.borrowed > 0) {
            uint256 price             = _price(token);
            uint256 newCollateralUsdc = _toUsdc(pos.collateral - amount, price);
            uint256 minCollateral     = (pos.borrowed * 10_000) / LIQ_THRESHOLD_BPS;
            require(newCollateralUsdc >= minCollateral, "would breach liquidation threshold");
        }

        pos.collateral -= amount;
        IERC20(token).safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, token, amount);
    }

    /// @notice Liquidate an undercollateralised position.
    ///         Liquidator repays all USDC debt and receives collateral + 5% bonus.
    function liquidate(address user, address token) external nonReentrant {
        _requireSupported(token);
        require(user != msg.sender,    "cannot liquidate self");

        Position storage pos = positions[user][token];
        require(pos.borrowed > 0,      "no debt");
        require(!_isHealthy(user, token), "position is healthy");

        uint256 debt      = pos.borrowed;
        uint256 price     = _price(token);
        uint256 debtTokens = _toToken(debt, price);
        uint256 bonus      = (debtTokens * LIQ_BONUS_BPS) / 10_000;
        uint256 seize      = debtTokens + bonus;

        if (seize > pos.collateral) seize = pos.collateral;

        pos.borrowed   = 0;
        pos.collateral -= seize;

        usdc.safeTransferFrom(msg.sender, address(this), debt);
        IERC20(token).safeTransfer(msg.sender, seize);

        emit Liquidated(user, token, msg.sender, seize, debt);
    }

    // ─── Views ────────────────────────────────────────────────────────────────

    function getMaxBorrow(address user, address token) public view returns (uint256) {
        Position memory pos = positions[user][token];
        if (pos.collateral == 0) return 0;
        uint256 maxDebt = (_toUsdc(pos.collateral, _price(token)) * MAX_LTV_BPS) / 10_000;
        return maxDebt > pos.borrowed ? maxDebt - pos.borrowed : 0;
    }

    function getCollateralValue(address user, address token) public view returns (uint256) {
        return _toUsdc(positions[user][token].collateral, _price(token));
    }

    /// @notice Health factor as BPS. ≥ 10_000 = safe.
    function getHealthFactor(address user, address token) public view returns (uint256) {
        Position memory pos = positions[user][token];
        if (pos.borrowed == 0) return type(uint256).max;
        return (_toUsdc(pos.collateral, _price(token)) * LIQ_THRESHOLD_BPS) / pos.borrowed;
    }

    // ─── Internal ─────────────────────────────────────────────────────────────

    function _requireSupported(address token) internal view {
        require(supportedTokens[token], "token not supported");
    }

    function _isHealthy(address user, address token) internal view returns (bool) {
        return getHealthFactor(user, token) >= 10_000;
    }

    function _price(address token) internal view returns (uint256 price) {
        price = priceFeed.latestPrice(token);
        require(price > 0, "xStockVault: price not available");
    }

    function _toUsdc(uint256 tokenAmount, uint256 price) internal pure returns (uint256) {
        return (tokenAmount * price) / SCALE;
    }

    function _toToken(uint256 usdcAmount, uint256 price) internal pure returns (uint256) {
        return (usdcAmount * SCALE) / price;
    }
}
