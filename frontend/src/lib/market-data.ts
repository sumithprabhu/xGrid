import type { UTCTimestamp } from "lightweight-charts";

export type Candle = {
  time: UTCTimestamp;
  open: number;
  high: number;
  low: number;
  close: number;
};

function hashStringToUint32(input: string) {
  // Simple deterministic hash for repeatable demo data (non-crypto).
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number) {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export function generateCandles(opts: {
  symbol: string;
  timeframe: "1D" | "1W" | "1M";
}): Candle[] {
  const { symbol, timeframe } = opts;

  const seed = hashStringToUint32(`${symbol}:${timeframe}`);
  const rand = mulberry32(seed);

  const nowSec = Math.floor(Date.now() / 1000);

  const intervalSec = timeframe === "1D" ? 60 * 15 : timeframe === "1W" ? 60 * 60 : 60 * 60 * 4;
  const count = timeframe === "1D" ? 160 : timeframe === "1W" ? 180 : 200;

  const startTime = nowSec - intervalSec * (count - 1);

  const base =
    symbol.includes("BTC") || symbol.includes("ETH")
      ? 3000 + rand() * 60000
      : 50 + rand() * 250;

  let prevClose = base;
  const out: Candle[] = [];

  for (let i = 0; i < count; i++) {
    const time = (startTime + i * intervalSec) as UTCTimestamp;

    const drift = (rand() - 0.5) * (base * 0.002);
    const shock = (rand() - 0.5) * (base * 0.01) * (timeframe === "1D" ? 1 : timeframe === "1W" ? 1.3 : 1.6);

    const open = prevClose;
    const close = clamp(open + drift + shock, base * 0.25, base * 4);

    const wick = Math.abs(rand() - 0.5) * (base * 0.01) * (timeframe === "1D" ? 1 : 1.4);
    const high = Math.max(open, close) + wick;
    const low = Math.min(open, close) - wick;

    out.push({
      time,
      open: round2(open),
      high: round2(high),
      low: round2(low),
      close: round2(close),
    });

    prevClose = close;
  }

  return out;
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

export function summarizeCandles(candles: Candle[]) {
  const last = candles[candles.length - 1];
  const first = candles[0];
  if (!last || !first) return null;

  const change = last.close - first.open;
  const changePct = (change / first.open) * 100;

  return {
    open: first.open,
    high: Math.max(...candles.map((c) => c.high)),
    low: Math.min(...candles.map((c) => c.low)),
    close: last.close,
    change,
    changePct,
  };
}

