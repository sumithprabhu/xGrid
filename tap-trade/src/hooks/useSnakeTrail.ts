import { useEffect, useState } from "react";
import {
  SNAKE_COLUMN_HIT_LAG,
  SNAKE_RIGHT_RESERVE,
  SNAKE_SWEEP_MS,
  SNAKE_TRAIL_MAX_SEGMENTS,
} from "../lib/constants";
import type { TokenConfig } from "../lib/types";

/** Logical column for UI + hit detection (lagged vs raw phase). */
export function effectiveSnakeColumn(colFloat: number, cap: number): number {
  const shifted = colFloat - SNAKE_COLUMN_HIT_LAG;
  const f = shifted < 0 ? 0 : Math.floor(shifted);
  return Math.min(f, cap);
}

export interface SnakeSegment {
  signedRow: number;
  /** Effective column (see SNAKE_COLUMN_HIT_LAG); 0 = chart seam, sweep moves toward 0. */
  col: number;
  /** Fractional position [0, gridWidth) — continuous treadmill */
  colFloat: number;
  /** Monotonic column epoch; header labels shift when this increments */
  floorGlobalCol: number;
}

export function maxSnakeCol(token: TokenConfig): number {
  return Math.max(0, token.gridWidth - 1 - SNAKE_RIGHT_RESERVE);
}

/** Row from live price; column from continuous global phase. */
export function computeSnakeHead(
  token: TokenConfig,
  currentPrice: number,
  nowMs: number
): SnakeSegment {
  const { tickSize, gridHalfHeight } = token;
  const rows = gridHalfHeight * 2;
  const center = Math.round(currentPrice / tickSize) * tickSize;
  let bestSigned = 0;
  let minD = Infinity;
  for (let ri = 0; ri < rows; ri++) {
    const signedRow =
      ri < gridHalfHeight
        ? gridHalfHeight - ri
        : -(ri - gridHalfHeight + 1);
    const price = center + signedRow * tickSize;
    const d = Math.abs(currentPrice - price);
    if (d < minD) {
      minD = d;
      bestSigned = signedRow;
    }
  }

  const w = token.gridWidth;
  const cap = maxSnakeCol(token);
  const msPerCol = SNAKE_SWEEP_MS / w;
  const globalPhase = nowMs / msPerCol;
  /** Right → left: seam is col 0 (chart edge); head starts ocean-side and rolls to shore. */
  const phaseMod = ((globalPhase % w) + w) % w;
  const colFloat = w - 1 - phaseMod;
  const col = effectiveSnakeColumn(colFloat, cap);
  const floorGlobalCol = Math.floor(globalPhase);

  return { signedRow: bestSigned, col, colFloat, floorGlobalCol };
}

export function useSnakeTrail(token: TokenConfig, currentPrice: number) {
  const [head, setHead] = useState<SnakeSegment>(() =>
    computeSnakeHead(token, currentPrice, Date.now())
  );
  const [trail, setTrail] = useState<SnakeSegment[]>([]);

  useEffect(() => {
    let raf = 0;
    const loop = () => {
      setHead(computeSnakeHead(token, currentPrice, Date.now()));
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [token, currentPrice]);

  useEffect(() => {
    setTrail((prev) => {
      if (
        prev[0]?.signedRow === head.signedRow &&
        prev[0]?.col === head.col &&
        prev[0]?.floorGlobalCol === head.floorGlobalCol
      ) {
        return prev;
      }
      return [head, ...prev].slice(0, SNAKE_TRAIL_MAX_SEGMENTS);
    });
  }, [head]);

  return { head, trail };
}
