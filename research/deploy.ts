// SPDX-License-Identifier: MIT
// deploy.ts — Hardhat deployment script for xStocks Grid

import { ethers } from 'hardhat';

/**
 * Token configurations derived from Tivnan et al. empirical data
 * and standard equity volatility research.
 *
 * Annual σ sources:
 *   - AAPL: 3-year realized vol ≈ 25%
 *   - MSFT: 3-year realized vol ≈ 28%
 *   - GS:   3-year realized vol ≈ 32%
 *   - TSLA: 3-year realized vol ≈ 65%
 *   - JPM:  3-year realized vol ≈ 30%
 *
 * Tick size calibration:
 *   Target: nearest-column nearest-row cell ≈ x1.4 multiplier
 *   Formula: tickSize ≈ 0.5 × (annualVol × √(bucketSec/SECONDS_PER_YEAR) × price)
 */
const TOKEN_CONFIGS = [
  {
    symbol:        'xAAPL',
    annualVolBps:  2500,   // 25%
    tickSizeUSDC:  50000,  // $0.05 (6 decimals = 50000)
    bucketSeconds: 30,
    houseEdgeBps:  1000,   // 10%
    minBetUSDC:    1e6,    // $1
    maxBetUSDC:    500e6,  // $500
  },
  {
    symbol:        'xMSFT',
    annualVolBps:  2800,   // 28%
    tickSizeUSDC:  80000,  // $0.08
    bucketSeconds: 30,
    houseEdgeBps:  1000,
    minBetUSDC:    1e6,
    maxBetUSDC:    500e6,
  },
  {
    symbol:        'xGS',
    annualVolBps:  3200,   // 32%  (higher ROC/share from paper)
    tickSizeUSDC:  150000, // $0.15
    bucketSeconds: 60,     // Slower bucket — more liquid feel
    houseEdgeBps:  1200,   // 12%  (higher for more volatile token)
    minBetUSDC:    1e6,
    maxBetUSDC:    500e6,
  },
  {
    symbol:        'xTSLA',
    annualVolBps:  6500,   // 65%  (very volatile)
    tickSizeUSDC:  200000, // $0.20
    bucketSeconds: 30,
    houseEdgeBps:  1200,
    minBetUSDC:    1e6,
    maxBetUSDC:    200e6,  // Lower max for volatile token
  },
  {
    symbol:        'xJPM',
    annualVolBps:  3000,   // 30%
    tickSizeUSDC:  100000, // $0.10
    bucketSeconds: 60,
    houseEdgeBps:  1000,
    minBetUSDC:    1e6,
    maxBetUSDC:    500e6,
  },
];

async function main() {
  const [deployer, keeper] = await ethers.getSigners();
  console.log('Deployer:', deployer.address);
  console.log('Keeper:  ', keeper?.address || deployer.address);
  console.log('Network: ', (await ethers.provider.getNetwork()).name);

  // ── Deploy GridMath Library ───────────────────────────────────────────────
  console.log('\n[1/5] Deploying GridMath library...');
  const GridMathLib = await ethers.getContractFactory('GridMath');
  const gridMathLib = await GridMathLib.deploy();
  await gridMathLib.waitForDeployment();
  console.log('GridMath library:', await gridMathLib.getAddress());

  // ── Deploy GridOracle ─────────────────────────────────────────────────────
  console.log('\n[2/5] Deploying GridOracle...');
  const GridOracle = await ethers.getContractFactory('GridOracle');
  const gridOracle = await GridOracle.deploy(keeper?.address || deployer.address);
  await gridOracle.waitForDeployment();
  const oracleAddr = await gridOracle.getAddress();
  console.log('GridOracle:', oracleAddr);

  // ── Deploy xStocksGrid ────────────────────────────────────────────────────
  console.log('\n[3/5] Deploying xStocksGrid...');
  const USDC_ADDRESS   = process.env.USDC_ADDRESS   || ethers.ZeroAddress;
  const EULER_ADDRESS  = process.env.EULER_ADDRESS  || ethers.ZeroAddress;

  const XStocksGrid = await ethers.getContractFactory('xStocksGrid', {
    libraries: { GridMath: await gridMathLib.getAddress() }
  });

  const grid = await XStocksGrid.deploy(
    USDC_ADDRESS,
    oracleAddr,
    EULER_ADDRESS,
    keeper?.address || deployer.address
  );
  await grid.waitForDeployment();
  const gridAddr = await grid.getAddress();
  console.log('xStocksGrid:', gridAddr);

  // ── Configure Tokens ──────────────────────────────────────────────────────
  console.log('\n[4/5] Configuring tokens...');
  for (const cfg of TOKEN_CONFIGS) {
    const tokenAddress = process.env[`${cfg.symbol}_ADDRESS`] || ethers.ZeroAddress;

    console.log(`  Configuring ${cfg.symbol} (${tokenAddress})...`);
    const tx = await grid.configureToken(
      tokenAddress,
      cfg.symbol,
      cfg.annualVolBps,
      cfg.tickSizeUSDC,
      cfg.bucketSeconds,
      cfg.houseEdgeBps,
      cfg.minBetUSDC,
      cfg.maxBetUSDC,
    );
    await tx.wait();
    console.log(`  ✓ ${cfg.symbol} configured`);

    // Verify the math: print expected multiplier matrix for this token
    await printExpectedMultipliers(cfg);
  }

  // ── Seed Liquidity Pool (optional) ───────────────────────────────────────
  console.log('\n[5/5] Deployment summary...');
  console.log('─'.repeat(50));
  console.log(`GridMath Library: ${await gridMathLib.getAddress()}`);
  console.log(`GridOracle:       ${oracleAddr}`);
  console.log(`xStocksGrid:      ${gridAddr}`);
  console.log('─'.repeat(50));

  // Write deployment addresses to file
  const fs = await import('fs');
  const addresses = {
    network:     (await ethers.provider.getNetwork()).name,
    deployedAt:  new Date().toISOString(),
    gridMathLib: await gridMathLib.getAddress(),
    gridOracle:  oracleAddr,
    xStocksGrid: gridAddr,
    tokens:      Object.fromEntries(
      TOKEN_CONFIGS.map(c => [c.symbol, process.env[`${c.symbol}_ADDRESS`] || ethers.ZeroAddress])
    ),
  };
  fs.writeFileSync('deployments.json', JSON.stringify(addresses, null, 2));
  console.log('\nAddresses saved to deployments.json');
}

/**
 * Print expected multiplier matrix for a token configuration.
 * Used to verify the math is reasonable before deployment.
 */
async function printExpectedMultipliers(cfg: typeof TOKEN_CONFIGS[0]) {
  // Import the JS math engine from server.ts
  const { GridMathJS } = await import('./backend/src/server');

  // Simulate: xAAPL at $190, market open (normal hours)
  const mockPrice = 190; // $190
  const now = new Date('2024-01-15T15:00:00Z'); // Monday 3pm ET = normal hours

  console.log(`\n  Expected multiplier matrix for ${cfg.symbol} @ $${mockPrice}:`);
  console.log(`  (Annual σ=${cfg.annualVolBps/100}%, tick=$${cfg.tickSizeUSDC/1e6}, bucket=${cfg.bucketSeconds}s)`);

  const header = '  Ticks\\Time |' + [1,2,3,4,5].map(c => `  T+${c}  `).join('|');
  console.log(header);
  console.log('  ' + '-'.repeat(header.length - 2));

  for (let tick = 4; tick >= 1; tick--) {
    let row = `  +${tick} ticks   |`;
    for (let col = 1; col <= 5; col++) {
      const { displayStr } = GridMathJS.calculateMultiplier({
        priceTicks:    tick,
        timeBuckets:   col,
        currentPrice:  mockPrice,
        annualVol:     cfg.annualVolBps / 10000,
        tickSize:      cfg.tickSizeUSDC / 1e6,
        bucketSeconds: cfg.bucketSeconds,
        houseEdge:     cfg.houseEdgeBps / 10000,
        now,
      });
      row += `  ${displayStr.padEnd(5)} |`;
    }
    console.log(row);
  }
  console.log();
}

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error(err); process.exit(1); });
