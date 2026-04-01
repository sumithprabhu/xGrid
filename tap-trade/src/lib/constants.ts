import type { TokenConfig, BetSize } from "./types";

export const TOKENS: TokenConfig[] = [
  {
    symbol: "AAPLx",
    ticker: "AAPL",
    name: "Apple",
    basePrice: 255.26,
    tickSize: 0.10,
    volatility: 0.0008,
    gridWidth: 8,
    gridHalfHeight: 6,
    bucketSeconds: 30,
    houseEdgeBps: 1000,
  },
  {
    symbol: "NVDAx",
    ticker: "NVDA",
    name: "NVIDIA",
    basePrice: 176.92,
    tickSize: 0.10,
    volatility: 0.0012,
    gridWidth: 8,
    gridHalfHeight: 6,
    bucketSeconds: 30,
    houseEdgeBps: 1000,
  },
  {
    symbol: "TSLAx",
    ticker: "TSLA",
    name: "Tesla",
    basePrice: 380.35,
    tickSize: 0.10,
    volatility: 0.0015,
    gridWidth: 8,
    gridHalfHeight: 6,
    bucketSeconds: 30,
    houseEdgeBps: 1000,
  },
  {
    symbol: "MSFTx",
    ticker: "MSFT",
    name: "Microsoft",
    basePrice: 375.94,
    tickSize: 0.10,
    volatility: 0.0007,
    gridWidth: 8,
    gridHalfHeight: 6,
    bucketSeconds: 30,
    houseEdgeBps: 1000,
  },
  {
    symbol: "SPYx",
    ticker: "SPY",
    name: "S&P 500",
    basePrice: 655.50,
    tickSize: 0.10,
    volatility: 0.0005,
    gridWidth: 8,
    gridHalfHeight: 6,
    bucketSeconds: 30,
    houseEdgeBps: 1000,
  },
];

export const BET_SIZES: BetSize[] = [1, 5, 10, 50];
export const INITIAL_BALANCE = 1000;
export const POLL_MS = 500;
export const MAX_CHART_POINTS = 500;
