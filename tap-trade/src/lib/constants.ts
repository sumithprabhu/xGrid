import type { TokenConfig, BetSize } from "./types";

/** Wall-clock duration for one full sweep (right → left, toward chart seam). */
export const SNAKE_SWEEP_MS = 28_000;

/** Rightmost playable column = gridWidth - 1 - SNAKE_RIGHT_RESERVE */
export const SNAKE_RIGHT_RESERVE = 1;

/**
 * Fraction of one column (0–1) to wait before the logical column advances.
 * Matches hit/lose + “current” cell to where the sweep reads visually.
 */
export const SNAKE_COLUMN_HIT_LAG = 0.42;

export const SNAKE_TRAIL_MAX_SEGMENTS = 28;

/** Per-column hold / expiry horizon labels (8 columns). */
export const GRID_TIME_HORIZONS_SEC = [5, 10, 15, 30, 45, 60, 300, 600] as const;

export const TOKENS: TokenConfig[] = [
  {
    symbol: "AAPLx",
    ticker: "AAPL",
    name: "Apple",
    basePrice: 255.26,
    tickSize: 0.1,
    volatility: 0.0008,
    gridWidth: 8,
    gridHalfHeight: 6,
    houseEdgeBps: 1000,
  },
  {
    symbol: "NVDAx",
    ticker: "NVDA",
    name: "NVIDIA",
    basePrice: 176.92,
    tickSize: 0.1,
    volatility: 0.0012,
    gridWidth: 8,
    gridHalfHeight: 6,
    houseEdgeBps: 1000,
  },
  {
    symbol: "TSLAx",
    ticker: "TSLA",
    name: "Tesla",
    basePrice: 380.35,
    tickSize: 0.1,
    volatility: 0.0015,
    gridWidth: 8,
    gridHalfHeight: 6,
    houseEdgeBps: 1000,
  },
  {
    symbol: "MSFTx",
    ticker: "MSFT",
    name: "Microsoft",
    basePrice: 375.94,
    tickSize: 0.1,
    volatility: 0.0007,
    gridWidth: 8,
    gridHalfHeight: 6,
    houseEdgeBps: 1000,
  },
  {
    symbol: "SPYx",
    ticker: "SPY",
    name: "S&P 500",
    basePrice: 655.5,
    tickSize: 0.1,
    volatility: 0.0005,
    gridWidth: 8,
    gridHalfHeight: 6,
    houseEdgeBps: 1000,
  },
];

export const BET_SIZES: BetSize[] = [1, 5, 10, 50];
export const INITIAL_BALANCE = 1000;
export const POLL_MS = 500;
export const MAX_CHART_POINTS = 500;
