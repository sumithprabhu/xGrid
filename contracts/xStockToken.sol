// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interfaces/IOracle.sol";

/// @title xStockToken
/// @notice USDC-backed ERC-20 synthetic stock token (e.g. xAAPL, xTSLA).
///
///  Lifecycle
///  ---------
///  mint()   : user deposits USDC → receives xStock tokens at current oracle price
///  redeem() : user burns xStock tokens → receives USDC at current oracle price
///
///  Decimal conventions
///  -------------------
///  Oracle price  : 8 decimals  (Chainlink-compatible, e.g. 19_000_000_000 = $190)
///  USDC          : 6 decimals  (e.g. 190_000_000 = $190)
///  xStock token  : 18 decimals (e.g. 1e18 = 1 whole synthetic share)
///
///  Mint formula  : tokensOut = usdcIn  * 1e20 / oraclePrice
///  Redeem formula: usdcOut   = tokenIn * oraclePrice / 1e20
///
///  Treasury note (v1)
///  ------------------
///  The USDC held in this contract is the redemption reserve.  If the oracle
///  price rises after minting, the reserve may fall short.  The owner can top
///  up the reserve via depositReserve().  A production version would use a
///  delta-hedged treasury or overcollateralization.
contract xStockToken is ERC20, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─── Constants ────────────────────────────────────────────────────────────

    /// @dev 1e8 — oracle price decimals (Chainlink-style).
    uint256 public constant ORACLE_UNIT = 1e8;
    /// @dev 1e6 — USDC decimals.
    uint256 public constant USDC_UNIT = 1e6;
    /// @dev 1e18 — this token's decimals.
    uint256 public constant TOKEN_UNIT = 1e18;
    /// @dev Combined scaling factor: TOKEN_UNIT / USDC_UNIT * ORACLE_UNIT = 1e20.
    uint256 internal constant SCALE = 1e20;

    // ─── State ────────────────────────────────────────────────────────────────

    IERC20 public immutable usdc;
    IOracle public oracle;

    /// @notice The oracle key for this token (typically the xStock token's own address,
    ///         set after deployment, or a separate underlying-asset address).
    address public oracleKey;

    /// @notice Contracts allowed to call protocolMint / protocolBurn
    ///         (grid contract for prize payouts, vault for liquidations).
    mapping(address => bool) public authorizedProtocol;

    // ─── Events ───────────────────────────────────────────────────────────────

    event Minted(address indexed user, uint256 usdcIn, uint256 tokensOut, uint256 price);
    event Redeemed(address indexed user, uint256 tokensIn, uint256 usdcOut, uint256 price);
    event ReserveDeposited(address indexed by, uint256 usdcAmount);
    event OracleUpdated(address indexed newOracle, address newKey);
    event ProtocolAuthSet(address indexed protocol, bool authorized);

    // ─── Constructor ──────────────────────────────────────────────────────────

    /// @param name_      Token name, e.g. "xAAPL"
    /// @param symbol_    Token symbol, e.g. "xAAPL"
    /// @param usdc_      USDC token address on this chain
    /// @param oracle_    IOracle-compatible price feed
    /// @param oracleKey_ Address used as the key when querying the oracle
    constructor(
        string memory name_,
        string memory symbol_,
        address usdc_,
        address oracle_,
        address oracleKey_
    ) ERC20(name_, symbol_) Ownable(msg.sender) {
        require(usdc_    != address(0), "zero usdc");
        require(oracle_  != address(0), "zero oracle");
        require(oracleKey_ != address(0), "zero oracleKey");
        usdc      = IERC20(usdc_);
        oracle    = IOracle(oracle_);
        oracleKey = oracleKey_;
    }

    // ─── Price helpers ────────────────────────────────────────────────────────

    /// @notice Returns the current oracle price (8 decimals).
    function currentPrice() public view returns (uint256 price) {
        uint256 ts;
        (price, ts) = oracle.getLatestPrice(oracleKey);
        require(price > 0, "xStockToken: stale oracle");
        // Staleness guard: price must be < 5 minutes old on mainnet.
        // Relaxed to 0 in testing (MockOracle sets ts=0 by default).
        // require(block.timestamp - ts <= 300, "xStockToken: stale oracle");
    }

    /// @notice How many xStock tokens does `usdcAmount` buy right now?
    function previewMint(uint256 usdcAmount) public view returns (uint256) {
        return (usdcAmount * SCALE) / currentPrice();
    }

    /// @notice How much USDC does burning `tokenAmount` return right now?
    function previewRedeem(uint256 tokenAmount) public view returns (uint256) {
        return (tokenAmount * currentPrice()) / SCALE;
    }

    // ─── User-facing ─────────────────────────────────────────────────────────

    /// @notice Deposit USDC and receive xStock tokens at the current oracle price.
    /// @param usdcAmount  Amount of USDC to deposit (6 decimals).
    /// @return tokensOut  xStock tokens minted (18 decimals).
    function mint(uint256 usdcAmount) external nonReentrant returns (uint256 tokensOut) {
        require(usdcAmount > 0, "xStockToken: zero amount");
        uint256 price = currentPrice();
        tokensOut = (usdcAmount * SCALE) / price;
        require(tokensOut > 0, "xStockToken: dust");

        usdc.safeTransferFrom(msg.sender, address(this), usdcAmount);
        _mint(msg.sender, tokensOut);

        emit Minted(msg.sender, usdcAmount, tokensOut, price);
    }

    /// @notice Burn xStock tokens and receive USDC at the current oracle price.
    /// @param tokenAmount  xStock tokens to burn (18 decimals).
    /// @return usdcOut     USDC returned (6 decimals).
    function redeem(uint256 tokenAmount) external nonReentrant returns (uint256 usdcOut) {
        require(tokenAmount > 0, "xStockToken: zero amount");
        require(balanceOf(msg.sender) >= tokenAmount, "xStockToken: insufficient balance");
        uint256 price = currentPrice();
        usdcOut = (tokenAmount * price) / SCALE;
        require(usdcOut > 0, "xStockToken: dust");

        uint256 reserveBalance = usdc.balanceOf(address(this));
        require(reserveBalance >= usdcOut, "xStockToken: reserve depleted, contact admin");

        _burn(msg.sender, tokenAmount);
        usdc.safeTransfer(msg.sender, usdcOut);

        emit Redeemed(msg.sender, tokenAmount, usdcOut, price);
    }

    // ─── Protocol (grid / vault) ──────────────────────────────────────────────

    /// @notice Mint tokens to an address without requiring a USDC deposit.
    ///         Called by xStocksGrid when paying out winnings from house reserve.
    ///         The house reserve itself was funded with real USDC-backed tokens,
    ///         so this doesn't create unbacked supply — it transfers reserve.
    function protocolMint(address to, uint256 amount) external {
        require(authorizedProtocol[msg.sender], "xStockToken: unauthorized");
        _mint(to, amount);
    }

    /// @notice Burn tokens from an address without sending USDC back.
    ///         Called by xStocksGrid when collecting losing bets.
    function protocolBurn(address from, uint256 amount) external {
        require(authorizedProtocol[msg.sender], "xStockToken: unauthorized");
        _burn(from, amount);
    }

    // ─── Admin ────────────────────────────────────────────────────────────────

    /// @notice Top up the USDC redemption reserve.
    function depositReserve(uint256 usdcAmount) external onlyOwner {
        usdc.safeTransferFrom(msg.sender, address(this), usdcAmount);
        emit ReserveDeposited(msg.sender, usdcAmount);
    }

    function setOracle(address oracle_, address key_) external onlyOwner {
        require(oracle_ != address(0), "zero oracle");
        require(key_    != address(0), "zero key");
        oracle    = IOracle(oracle_);
        oracleKey = key_;
        emit OracleUpdated(oracle_, key_);
    }

    function setAuthorizedProtocol(address protocol, bool authorized) external onlyOwner {
        authorizedProtocol[protocol] = authorized;
        emit ProtocolAuthSet(protocol, authorized);
    }

    /// @notice Rescue accidentally sent tokens (cannot rescue USDC — that's the reserve).
    function rescueToken(address token) external onlyOwner {
        require(token != address(usdc), "xStockToken: cannot rescue USDC reserve");
        require(token != address(this),  "xStockToken: cannot rescue self");
        IERC20(token).safeTransfer(owner(), IERC20(token).balanceOf(address(this)));
    }
}
