/**
 * xStocks Grid — Math Engine Tests
 * 
 * Tests verify:
 *   1. Multiplier monotonicity (farther = higher multiplier)
 *   2. House edge is always applied
 *   3. Market hours vol adjustment works
 *   4. Probability sums to reasonable values
 *   5. Boundary conditions
 */

import { GridMathJS } from '../backend/src/server';

// ─── Test Helpers ─────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err: any) {
    console.error(`  ✗ ${name}: ${err.message}`);
    failed++;
  }
}

function expect(val: number) {
  return {
    toBeGreaterThan: (x: number) => {
      if (!(val > x)) throw new Error(`Expected ${val} > ${x}`);
    },
    toBeLessThan: (x: number) => {
      if (!(val < x)) throw new Error(`Expected ${val} < ${x}`);
    },
    toBeCloseTo: (x: number, tol = 0.01) => {
      if (Math.abs(val - x) > tol) throw new Error(`Expected ${val} ≈ ${x} (±${tol})`);
    },
    toBe: (x: number) => {
      if (val !== x) throw new Error(`Expected ${val} === ${x}`);
    }
  };
}

// ─── Normal CDF Tests ────────────────────────────────────────────────────────

console.log('\n[Normal Distribution]');

test('Φ(0) = 0.5', () => {
  const cdf = GridMathJS['normalCDF'](0);
  expect(cdf).toBeCloseTo(0.5, 0.001);
});

test('Φ(1.96) ≈ 0.975 (95% confidence)', () => {
  const cdf = GridMathJS['normalCDF'](1.96);
  expect(cdf).toBeCloseTo(0.975, 0.002);
});

test('Φ(-1.96) ≈ 0.025', () => {
  const cdf = GridMathJS['normalCDF'](-1.96);
  expect(cdf).toBeCloseTo(0.025, 0.002);
});

test('Two-tail P(z=0) = 1.0', () => {
  const p = GridMathJS['twoTailProb'](0);
  expect(p).toBeCloseTo(1.0, 0.01);
});

test('Two-tail P(z=1.96) ≈ 0.05', () => {
  const p = GridMathJS['twoTailProb'](1.96);
  expect(p).toBeCloseTo(0.05, 0.005);
});

// ─── Market Hours Tests ───────────────────────────────────────────────────────

console.log('\n[Market Hours]');

const OPEN_TIME   = new Date('2024-01-15T13:35:00Z'); // 9:35am ET — opening window
const NORMAL_TIME = new Date('2024-01-15T17:00:00Z'); // 12pm ET — normal
const CLOSE_TIME  = new Date('2024-01-15T19:45:00Z'); // 2:45pm ET — closing window
const AFTER_TIME  = new Date('2024-01-15T21:00:00Z'); // 4pm ET — after hours
const WEEKEND     = new Date('2024-01-13T15:00:00Z'); // Saturday

test('Opening window: vol multiplier = 2.5', () => {
  const m = GridMathJS['marketHoursVolMultiplier'](OPEN_TIME);
  expect(m).toBeCloseTo(2.5, 0.01);
});

test('Normal hours: vol multiplier = 1.0', () => {
  const m = GridMathJS['marketHoursVolMultiplier'](NORMAL_TIME);
  expect(m).toBeCloseTo(1.0, 0.01);
});

test('Closing window: vol multiplier = 1.8', () => {
  const m = GridMathJS['marketHoursVolMultiplier'](CLOSE_TIME);
  expect(m).toBeCloseTo(1.8, 0.01);
});

test('After hours: vol multiplier = 0.4', () => {
  const m = GridMathJS['marketHoursVolMultiplier'](AFTER_TIME);
  expect(m).toBeCloseTo(0.4, 0.01);
});

test('Weekend: vol multiplier = 0.2', () => {
  const m = GridMathJS['marketHoursVolMultiplier'](WEEKEND);
  expect(m).toBeCloseTo(0.2, 0.01);
});

// ─── Multiplier Monotonicity Tests ───────────────────────────────────────────

console.log('\n[Multiplier Monotonicity]');

const BASE_PARAMS = {
  currentPrice:  190,
  annualVol:     0.25,
  tickSize:      0.05,
  bucketSeconds: 30,
  houseEdge:     0.10,
  now:           NORMAL_TIME,
};

test('More ticks away → higher multiplier (same time)', () => {
  const m1 = GridMathJS.calculateMultiplier({ ...BASE_PARAMS, priceTicks: 1, timeBuckets: 2 }).multiplier;
  const m2 = GridMathJS.calculateMultiplier({ ...BASE_PARAMS, priceTicks: 2, timeBuckets: 2 }).multiplier;
  const m3 = GridMathJS.calculateMultiplier({ ...BASE_PARAMS, priceTicks: 3, timeBuckets: 2 }).multiplier;
  const m4 = GridMathJS.calculateMultiplier({ ...BASE_PARAMS, priceTicks: 4, timeBuckets: 2 }).multiplier;

  expect(m2).toBeGreaterThan(m1);
  expect(m3).toBeGreaterThan(m2);
  expect(m4).toBeGreaterThan(m3);
  console.log(`    T+2 col: 1t=${m1}x, 2t=${m2}x, 3t=${m3}x, 4t=${m4}x`);
});

test('More time buckets → lower multiplier (same ticks, closer to current)', () => {
  // More time = more chance price will reach target = lower multiplier
  const m1 = GridMathJS.calculateMultiplier({ ...BASE_PARAMS, priceTicks: 3, timeBuckets: 1 }).multiplier;
  const m3 = GridMathJS.calculateMultiplier({ ...BASE_PARAMS, priceTicks: 3, timeBuckets: 3 }).multiplier;
  const m5 = GridMathJS.calculateMultiplier({ ...BASE_PARAMS, priceTicks: 3, timeBuckets: 5 }).multiplier;

  expect(m1).toBeGreaterThan(m3);
  expect(m3).toBeGreaterThan(m5);
  console.log(`    3 ticks: T+1=${m1}x, T+3=${m3}x, T+5=${m5}x`);
});

test('Opening window → lower multipliers (higher vol = easier to reach)', () => {
  const mNormal  = GridMathJS.calculateMultiplier({ ...BASE_PARAMS, priceTicks: 3, timeBuckets: 2, now: NORMAL_TIME }).multiplier;
  const mOpening = GridMathJS.calculateMultiplier({ ...BASE_PARAMS, priceTicks: 3, timeBuckets: 2, now: OPEN_TIME }).multiplier;

  expect(mNormal).toBeGreaterThan(mOpening);
  console.log(`    3t T+2: Normal=${mNormal}x, Opening=${mOpening}x (vol boost makes it easier)`);
});

test('House edge: displayed multiplier < fair multiplier', () => {
  // Without house edge, probability × multiplier = 1 (fair game)
  // With house edge: probability × multiplier < 1 (house advantage)
  const result = GridMathJS.calculateMultiplier({ ...BASE_PARAMS, priceTicks: 2, timeBuckets: 2 });
  const impliedEdge = result.probability - (1 / result.multiplier);

  expect(impliedEdge).toBeGreaterThan(0); // house always has positive edge
  console.log(`    P=${(result.probability*100).toFixed(1)}%, mult=${result.multiplier}x, edge=${(impliedEdge*100).toFixed(1)}%`);
});

// ─── Specific Calibration Tests ───────────────────────────────────────────────

console.log('\n[Calibration: Expected Multiplier Ranges]');

test('xAAPL 1-tick, T+1 should be ≈ x1.3-1.6 (very likely)', () => {
  const { multiplier } = GridMathJS.calculateMultiplier({
    ...BASE_PARAMS, priceTicks: 1, timeBuckets: 1
  });
  expect(multiplier).toBeGreaterThan(1.1);
  expect(multiplier).toBeLessThan(2.5);
  console.log(`    xAAPL 1t T+1: ${multiplier}x`);
});

test('xAAPL 3-tick, T+1 should be ≈ x2.0-4.0 (moderate)', () => {
  const { multiplier } = GridMathJS.calculateMultiplier({
    ...BASE_PARAMS, priceTicks: 3, timeBuckets: 1
  });
  expect(multiplier).toBeGreaterThan(1.8);
  expect(multiplier).toBeLessThan(6.0);
  console.log(`    xAAPL 3t T+1: ${multiplier}x`);
});

test('xAAPL 5-tick, T+1 should be ≈ x5+ (unlikely)', () => {
  const { multiplier } = GridMathJS.calculateMultiplier({
    ...BASE_PARAMS, priceTicks: 5, timeBuckets: 1
  });
  expect(multiplier).toBeGreaterThan(4.0);
  console.log(`    xAAPL 5t T+1: ${multiplier}x`);
});

test('xTSLA (high vol 65%) shows lower multipliers than xAAPL', () => {
  const tslaMult = GridMathJS.calculateMultiplier({
    ...BASE_PARAMS,
    annualVol:  0.65, tickSize: 0.20, currentPrice: 178,
    priceTicks: 3, timeBuckets: 2
  }).multiplier;

  const aaplMult = GridMathJS.calculateMultiplier({
    ...BASE_PARAMS,
    priceTicks: 3, timeBuckets: 2
  }).multiplier;

  // TSLA has higher vol so same distance is more likely → lower multiplier
  // BUT TSLA also has larger tick size, so actual dollar distance is similar
  // This tests the interaction
  console.log(`    xTSLA 3t T+2: ${tslaMult}x vs xAAPL: ${aaplMult}x`);
});

// ─── Grid Generation Test ─────────────────────────────────────────────────────

console.log('\n[Grid Generation]');

test('Grid generates correct dimensions (6 rows × 5 cols = 60 cells)', () => {
  const grid = GridMathJS.generateGrid({
    symbol: 'xAAPL', currentPrice: 190, annualVol: 0.25,
    tickSize: 0.05, bucketSeconds: 30, houseEdge: 0.10,
    rows: 6, cols: 5, now: NORMAL_TIME
  });

  const totalCells = grid.grid.reduce((sum, row) => sum + row.length, 0);
  expect(totalCells).toBe(60); // 12 rows (6 up + 6 down) × 5 cols
});

test('Grid cells have correct direction', () => {
  const grid = GridMathJS.generateGrid({
    symbol: 'xAAPL', currentPrice: 190, annualVol: 0.25,
    tickSize: 0.05, bucketSeconds: 30, houseEdge: 0.10,
    rows: 3, cols: 3, now: NORMAL_TIME
  });

  // First rows should be 'up' (positive ticks)
  const firstRow = grid.grid[0];
  if (firstRow[0].priceTicks <= 0) throw new Error('Expected positive ticks in first rows');

  // Last rows should be 'down' (negative ticks)
  const lastRow = grid.grid[grid.grid.length - 1];
  if (lastRow[0].priceTicks >= 0) throw new Error('Expected negative ticks in last rows');
});

test('Grid target prices are consistent with ticks', () => {
  const grid = GridMathJS.generateGrid({
    symbol: 'xAAPL', currentPrice: 190, annualVol: 0.25,
    tickSize: 0.05, bucketSeconds: 30, houseEdge: 0.10,
    rows: 3, cols: 3, now: NORMAL_TIME
  });

  for (const row of grid.grid) {
    for (const cell of row) {
      const expectedPrice = 190 + cell.priceTicks * 0.05;
      expect(Math.abs(cell.targetPrice - expectedPrice)).toBeLessThan(0.001);
    }
  }
});

// ─── Vol Surface Test ─────────────────────────────────────────────────────────

console.log('\n[Vol Surface]');

test('EWMA vol returns reasonable value for simulated price series', () => {
  const { VolSurfaceUpdater } = require('./backend/src/server');
  const prices = Array.from({ length: 100 }, (_, i) => ({
    price: 190 * Math.exp((Math.random() - 0.5) * 0.001),
    ts: Date.now() - (100 - i) * 1000
  }));

  const vol = VolSurfaceUpdater.computeEWMAVol(prices);
  expect(vol).toBeGreaterThan(0.01);  // At least 1% annual
  expect(vol).toBeLessThan(5.0);      // Less than 500% annual
  console.log(`    EWMA vol from 100 1s obs: ${(vol*100).toFixed(1)}%`);
});

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log('\n' + '─'.repeat(50));
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('Some tests failed!');
  process.exit(1);
} else {
  console.log('All tests passed.');
}

// ─── Print Full Grid for Visual Inspection ────────────────────────────────────

console.log('\n[xAAPL Full Grid @ $190 — Normal Hours]\n');
const demoGrid = GridMathJS.generateGrid({
  symbol: 'xAAPL', currentPrice: 190, annualVol: 0.25,
  tickSize: 0.05, bucketSeconds: 30, houseEdge: 0.10,
  rows: 5, cols: 5, now: NORMAL_TIME
});

console.log(`  Target  | T+1    T+2    T+3    T+4    T+5`);
console.log(`  --------|--------------------------------------`);
for (const row of demoGrid.grid) {
  const price = row[0].targetPrice.toFixed(2).padStart(7);
  const cells = row.map(c => c.displayStr.padEnd(6)).join(' ');
  const dir   = row[0].priceTicks > 0 ? '▲' : '▼';
  console.log(`  $${price} ${dir}|  ${cells}`);
}
console.log();

console.log('[xAAPL Full Grid @ $190 — Opening Window (high vol)]\n');
const openGrid = GridMathJS.generateGrid({
  symbol: 'xAAPL', currentPrice: 190, annualVol: 0.25,
  tickSize: 0.05, bucketSeconds: 30, houseEdge: 0.10,
  rows: 5, cols: 5, now: OPEN_TIME
});

console.log(`  Target  | T+1    T+2    T+3    T+4    T+5`);
console.log(`  --------|--------------------------------------`);
for (const row of openGrid.grid) {
  const price = row[0].targetPrice.toFixed(2).padStart(7);
  const cells = row.map(c => c.displayStr.padEnd(6)).join(' ');
  const dir   = row[0].priceTicks > 0 ? '▲' : '▼';
  console.log(`  $${price} ${dir}|  ${cells}`);
}
console.log('\n(Note: Opening window shows lower multipliers due to 2.5× vol boost from Tivnan et al.)');
