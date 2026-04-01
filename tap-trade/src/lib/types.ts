export interface TokenConfig {
  symbol: string;
  ticker: string;
  name: string;
  basePrice: number;
  tickSize: number;
  volatility: number;
  gridWidth: number;
  gridHalfHeight: number;
  bucketSeconds: number;
  houseEdgeBps: number;
}

export type BetStatus = "active" | "won" | "lost";

export interface Bet {
  id: string;
  tokenSymbol: string;
  row: number;
  col: number;
  priceLevel: number;
  amount: number;
  multiplier: number;
  placedAt: number;
  expiresAt: number;
  status: BetStatus;
  pnl: number;
}

export interface PricePoint {
  time: number;
  value: number;
}

export type BetSize = 1 | 5 | 10 | 50;
