import type { TokenConfig, BetSize } from "./types";

/** Wall-clock duration for one full sweep (right → left, toward chart seam). */
export const SNAKE_SWEEP_MS = 28_000;

/** Rightmost playable column = gridWidth - 1 - SNAKE_RIGHT_RESERVE */
export const SNAKE_RIGHT_RESERVE = 1;

/** Minimum columns ahead a bet must be placed (prevents trivial near-head bets) */
export const MIN_BET_STEPS_AHEAD = 2;

/**
 * Fraction of one column (0–1) to wait before the logical column advances.
 * Matches hit/lose + “current” cell to where the sweep reads visually.
 */
export const SNAKE_COLUMN_HIT_LAG = 0.42;

export const SNAKE_TRAIL_MAX_SEGMENTS = 28;

/** Per-column hold / expiry horizon labels (8 columns). */
export const GRID_TIME_HORIZONS_SEC = [5, 10, 15, 30, 45, 60, 300, 600] as const;

export const TOKENS: TokenConfig[] = [
  // ── Tech ──
  { symbol: "AAPLx", ticker: "AAPL", name: "Apple", basePrice: 255, tickSize: 0.1, volatility: 0.0008, gridWidth: 8, gridHalfHeight: 6, houseEdgeBps: 1000 },
  { symbol: "NVDAx", ticker: "NVDA", name: "NVIDIA", basePrice: 177, tickSize: 0.1, volatility: 0.0012, gridWidth: 8, gridHalfHeight: 6, houseEdgeBps: 1000 },
  { symbol: "TSLAx", ticker: "TSLA", name: "Tesla", basePrice: 380, tickSize: 0.1, volatility: 0.0015, gridWidth: 8, gridHalfHeight: 6, houseEdgeBps: 1000 },
  { symbol: "MSFTx", ticker: "MSFT", name: "Microsoft", basePrice: 376, tickSize: 0.1, volatility: 0.0007, gridWidth: 8, gridHalfHeight: 6, houseEdgeBps: 1000 },
  { symbol: "GOOGx", ticker: "GOOG", name: "Alphabet", basePrice: 165, tickSize: 0.1, volatility: 0.0009, gridWidth: 8, gridHalfHeight: 6, houseEdgeBps: 1000 },
  { symbol: "AMZNx", ticker: "AMZN", name: "Amazon", basePrice: 205, tickSize: 0.1, volatility: 0.0010, gridWidth: 8, gridHalfHeight: 6, houseEdgeBps: 1000 },
  { symbol: "METAx", ticker: "META", name: "Meta", basePrice: 595, tickSize: 0.1, volatility: 0.0011, gridWidth: 8, gridHalfHeight: 6, houseEdgeBps: 1000 },
  // ── Indices / ETFs ──
  { symbol: "SPYx", ticker: "SPY", name: "S&P 500", basePrice: 656, tickSize: 0.1, volatility: 0.0005, gridWidth: 8, gridHalfHeight: 6, houseEdgeBps: 1000 },
  { symbol: "QQQx", ticker: "QQQ", name: "Nasdaq 100", basePrice: 540, tickSize: 0.1, volatility: 0.0006, gridWidth: 8, gridHalfHeight: 6, houseEdgeBps: 1000 },
  { symbol: "IWMx", ticker: "IWM", name: "Russell 2000", basePrice: 210, tickSize: 0.1, volatility: 0.0009, gridWidth: 8, gridHalfHeight: 6, houseEdgeBps: 1000 },
  // ── Finance ──
  { symbol: "JPMx", ticker: "JPM", name: "JPMorgan", basePrice: 260, tickSize: 0.1, volatility: 0.0007, gridWidth: 8, gridHalfHeight: 6, houseEdgeBps: 1000 },
  { symbol: "GSx", ticker: "GS", name: "Goldman Sachs", basePrice: 570, tickSize: 0.1, volatility: 0.0008, gridWidth: 8, gridHalfHeight: 6, houseEdgeBps: 1000 },
  // ── Other ──
  { symbol: "COINx", ticker: "COIN", name: "Coinbase", basePrice: 235, tickSize: 0.1, volatility: 0.0018, gridWidth: 8, gridHalfHeight: 6, houseEdgeBps: 1000 },
  { symbol: "PLTRx", ticker: "PLTR", name: "Palantir", basePrice: 115, tickSize: 0.1, volatility: 0.0016, gridWidth: 8, gridHalfHeight: 6, houseEdgeBps: 1000 },
];

export const BET_SIZES: BetSize[] = [1, 5, 10, 50];
export const INITIAL_BALANCE = 1000;
export const POLL_MS = 500;
export const MAX_CHART_POINTS = 500;
