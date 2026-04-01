// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../PriceFeed.sol";
import "../GridToken.sol";
import "../xStocksGrid.sol";
import "../xStockVault.sol";

/// @notice Deploys the full xStocks Grid stack to Ink Sepolia testnet.
///
///  Tokens on Ink Sepolia:
///    USDC   0x6b57475467cd854d36Be7FB614caDa5207838943
///    wQQQx  0x267ED9BC43B16D832cB9Aaf0e3445f0cC9f536d9
///    wSPYx  0x9eF9f9B22d3CA9769e28e769e2AAA3C2B0072D0e
///
///  Run:
///    forge script script/Deploy.s.sol \
///      --rpc-url $RPC_URL \
///      --broadcast \
///      --private-key $PRIVATE_KEY \
///      -vvvv
contract Deploy is Script {

    // ─── Ink Sepolia addresses ────────────────────────────────────────────────

    address constant USDC  = 0x6b57475467cd854d36Be7FB614caDa5207838943;
    address constant wQQQx = 0x267ED9BC43B16D832cB9Aaf0e3445f0cC9f536d9;
    address constant wSPYx = 0x9eF9f9B22d3CA9769e28e769e2AAA3C2B0072D0e;

    // ─── Token parameters ─────────────────────────────────────────────────────
    //
    //  wQQQx  ≈  QQQ (NASDAQ-100 ETF)
    //    Annual σ  ≈ 18%
    //    Price     ≈ $480   (using $480 as placeholder — backend will update)
    //    Tick      = $0.50  (each row = $0.50 move)
    //    Bucket    = 30s
    //
    //  wSPYx  ≈  SPY (S&P 500 ETF)
    //    Annual σ  ≈ 14%
    //    Price     ≈ $540   (using $540 as placeholder — backend will update)
    //    Tick      = $0.50
    //    Bucket    = 30s

    // wQQQx
    uint256 constant QQQ_VOL_BPS         = 1800;      // 18% annual σ
    uint256 constant QQQ_TICK_USDC       = 500_000;   // $0.50 (6 dec)
    uint256 constant QQQ_BUCKET_SECS     = 30;
    uint256 constant QQQ_HOUSE_EDGE_BPS  = 1000;      // 10%
    uint256 constant QQQ_MIN_BET_USDC    = 1_000_000; // $1
    uint256 constant QQQ_MAX_BET_USDC    = 200_000_000; // $200
    uint8   constant QQQ_GRID_WIDTH      = 5;
    uint8   constant QQQ_GRID_HEIGHT     = 6;
    uint256 constant QQQ_INIT_PRICE      = 480_000_000; // $480.00 (6 dec)

    // wSPYx
    uint256 constant SPY_VOL_BPS         = 1400;      // 14% annual σ
    uint256 constant SPY_TICK_USDC       = 500_000;   // $0.50 (6 dec)
    uint256 constant SPY_BUCKET_SECS     = 30;
    uint256 constant SPY_HOUSE_EDGE_BPS  = 1000;      // 10%
    uint256 constant SPY_MIN_BET_USDC    = 1_000_000; // $1
    uint256 constant SPY_MAX_BET_USDC    = 200_000_000; // $200
    uint8   constant SPY_GRID_WIDTH      = 5;
    uint8   constant SPY_GRID_HEIGHT     = 6;
    uint256 constant SPY_INIT_PRICE      = 540_000_000; // $540.00 (6 dec)

    function run() external {
        address deployer = vm.envOr("DEPLOYER", address(0));
        if (deployer == address(0)) deployer = 0x0Fe68c895aafF3FD16d236A20c1F9113F26e7486;

        console.log("Deployer:        ", deployer);
        console.log("Chain ID:        ", block.chainid);
        console.log("USDC:            ", USDC);
        console.log("wQQQx:           ", wQQQx);
        console.log("wSPYx:           ", wSPYx);
        console.log("");

        vm.startBroadcast();

        // ── 1. PriceFeed ──────────────────────────────────────────────────────
        PriceFeed priceFeed = new PriceFeed(deployer);
        console.log("PriceFeed:       ", address(priceFeed));

        // ── 2. gdUSD — single unified grid token ──────────────────────────────
        //    Deploy with deployer as initial minter (placeholder).
        //    grid and vault will be added as proper minters below.
        GridToken gdUSD = new GridToken("gdUSD", "gdUSD", deployer);
        console.log("gdUSD:           ", address(gdUSD));

        // ── 3. xStocksGrid ────────────────────────────────────────────────────
        xStocksGrid grid = new xStocksGrid(USDC, address(priceFeed), address(gdUSD));
        console.log("xStocksGrid:     ", address(grid));

        // ── 4. xStockVault ────────────────────────────────────────────────────
        xStockVault vault = new xStockVault(address(priceFeed), address(grid), address(gdUSD));
        vault.addSupportedToken(wQQQx);
        vault.addSupportedToken(wSPYx);
        console.log("xStockVault:     ", address(vault));
        console.log("Vault supports wQQQx + wSPYx");

        // ── 5. Grant minting rights to grid and vault ─────────────────────────
        gdUSD.addMinter(address(grid));
        gdUSD.addMinter(address(vault));
        console.log("grid + vault added as gdUSD minters");

        // ── 6. Configure tokens on grid ───────────────────────────────────────
        grid.configureToken(
            wQQQx,
            QQQ_VOL_BPS,
            QQQ_TICK_USDC,
            QQQ_BUCKET_SECS,
            QQQ_HOUSE_EDGE_BPS,
            QQQ_MIN_BET_USDC,
            QQQ_MAX_BET_USDC,
            QQQ_GRID_WIDTH,
            QQQ_GRID_HEIGHT
        );
        console.log("wQQQx configured on grid");

        grid.configureToken(
            wSPYx,
            SPY_VOL_BPS,
            SPY_TICK_USDC,
            SPY_BUCKET_SECS,
            SPY_HOUSE_EDGE_BPS,
            SPY_MIN_BET_USDC,
            SPY_MAX_BET_USDC,
            SPY_GRID_WIDTH,
            SPY_GRID_HEIGHT
        );
        console.log("wSPYx configured on grid");

        // ── 7. Push initial prices ────────────────────────────────────────────
        //    Backend will overwrite these on first tick.
        //    Setting market as closed (isOpen=false) until backend takes over.
        priceFeed.setPrice(wQQQx, QQQ_INIT_PRICE, false, false, false, true, false);
        priceFeed.setPrice(wSPYx, SPY_INIT_PRICE, false, false, false, true, false);
        console.log("Initial prices pushed (market closed until backend updates)");

        vm.stopBroadcast();

        // ── Summary ───────────────────────────────────────────────────────────
        console.log("");
        console.log("=== DEPLOYMENT COMPLETE ===");
        console.log("PriceFeed:   ", address(priceFeed));
        console.log("gdUSD:       ", address(gdUSD));
        console.log("xStocksGrid: ", address(grid));
        console.log("xStockVault: ", address(vault));
        console.log("");
        console.log("Next steps:");
        console.log("  1. Seed grid LP pool:    grid.depositLiquidity(token, amount)");
        console.log("  2. Wire backend to call priceFeed.setPrice() on every tick");
        console.log("  3. Update contracts.ts in frontend with new addresses");
    }
}
