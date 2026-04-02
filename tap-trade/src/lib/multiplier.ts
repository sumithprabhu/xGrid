/**
 * Black-Scholes inspired multiplier for the xStocks grid.
 *
 * Models each cell as a "touch digital option" — the snake must hit an exact
 * price row within a time window.  The probability of touching a barrier at
 * distance `d` ticks within time `T` under geometric Brownian motion is:
 *
 *   P ≈ exp(-d² / (2 σ² T))          (simplified barrier-touch probability)
 *
 * The fair multiplier is 1 / P, then reduced by the house edge.
 *
 * Inputs come from the grid:
 *   absDistance  — rows away from current price (1-6)
 *   timeBuckets — columns ahead (1-6, each ≈ 3.5 s of wall-clock)
 *   volatility  — per-token σ  (annualised-style, but scaled for tick moves)
 *   tickSize    — price increment per row
 *   currentPrice— live price (used to normalise distance)
 *   houseEdgeBps— house take in basis points (1000 = 10 %)
 */

// ── helpers ──

/** Standard-normal CDF (Abramowitz & Stegun approximation, max error 7.5e-8) */
function normCdf(x: number): number {
  if (x > 8) return 1;
  if (x < -8) return 0;
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const t = 1 / (1 + p * Math.abs(x));
  const y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x / 2);
  return 0.5 * (1 + sign * y);
}

/**
 * Probability that a GBM process touches a barrier at relative distance
 * `relDist` (as fraction of price) within time `T` (in years-equivalent).
 *
 * Uses the reflection principle:  P_touch = 2 · N(-|d| / (σ√T))
 * where d = ln(barrier/spot).  For small moves d ≈ relDist.
 */
function touchProbability(relDist: number, sigma: number, T: number): number {
  if (T <= 0 || sigma <= 0) return 0;
  const sigSqrtT = sigma * Math.sqrt(T);
  if (sigSqrtT < 1e-12) return 0;
  return 2 * normCdf(-Math.abs(relDist) / sigSqrtT);
}

// ── Seconds → "years" scaling ──
// The token volatility values (0.0005 – 0.0018) are calibrated to
// per-second price moves, so 1 second = 1 unit of T is the natural scale.
// No annualisation needed.

const SECONDS_PER_BUCKET = 3.5; // SNAKE_SWEEP_MS / gridWidth

// ── public API ──

/**
 * Black-Scholes multiplier for a single grid cell.
 *
 * @param absDistance  Rows from current price (1 … gridHalfHeight)
 * @param timeBuckets Columns ahead of snake head (1 … maxStepsAhead)
 * @param houseEdgeBps House edge in basis points (1000 = 10 %)
 * @param volatility  Per-token σ (from TokenConfig.volatility)
 * @param tickSize    Price step per grid row
 * @param currentPrice Current spot price
 * @returns display multiplier (e.g. 2.4)
 */
export function calculateMultiplier(
  absDistance: number,
  timeBuckets: number,
  houseEdgeBps: number = 1000,
  volatility: number = 0.001,
  tickSize: number = 0.1,
  currentPrice: number = 250,
): number {
  if (absDistance <= 0 || timeBuckets <= 0) return 0;

  // Relative price distance (fraction of spot)
  const relDist = (absDistance * tickSize) / currentPrice;

  // Time in the natural σ-scale (seconds)
  const T = timeBuckets * SECONDS_PER_BUCKET;

  // Touch probability
  const prob = touchProbability(relDist, volatility, T);

  // Fair multiplier = 1 / prob, floored to avoid infinity / huge numbers
  if (prob < 0.005) return (200 * (10_000 - houseEdgeBps)) / 10_000 / 100; // cap at ~20x
  const fairMult = 1 / prob;

  // Apply house edge
  const mult = (fairMult * (10_000 - houseEdgeBps)) / 10_000;

  // Clamp to sensible range [1.1 … 50]
  return Math.round(Math.max(1.1, Math.min(50, mult)) * 10) / 10;
}

/**
 * Build the full multiplier grid (kept for compatibility).
 */
export function buildMultiplierGrid(
  halfHeight: number,
  width: number,
  houseEdgeBps: number,
  volatility: number = 0.001,
  tickSize: number = 0.1,
  currentPrice: number = 250,
): number[][] {
  const rows = halfHeight * 2;
  const grid: number[][] = [];

  for (let r = 0; r < rows; r++) {
    const absRow = r < halfHeight ? halfHeight - r : r - halfHeight + 1;
    const row: number[] = [];
    for (let c = 0; c < width; c++) {
      row.push(
        calculateMultiplier(absRow, c + 1, houseEdgeBps, volatility, tickSize, currentPrice)
      );
    }
    grid.push(row);
  }
  return grid;
}
