import { useEffect, useRef, useState } from "react";
import type { TokenConfig } from "../lib/types";
import {
  SNAKE_SWEEP_MS,
  SNAKE_TRAIL_MAX_SEGMENTS,
  SNAKE_RIGHT_RESERVE,
} from "../lib/constants";

export interface SnakeSegment {
  signedRow: number;
  /** Monotonically increasing global column index (never wraps) */
  globalCol: number;
  /** Continuous float phase for smooth sub-column scrolling */
  globalPhase: number;
}

export function maxStepsAhead(token: TokenConfig) {
  return token.gridWidth - 1 - SNAKE_RIGHT_RESERVE;
}

export function useSnakeTrail(token: TokenConfig, currentPrice: number) {
  const startRef = useRef(Date.now());
  const [head, setHead] = useState<SnakeSegment>({
    signedRow: 0,
    globalCol: 0,
    globalPhase: 0,
  });
  const [trail, setTrail] = useState<SnakeSegment[]>([]);
  const prevCol = useRef(-1);
  const trailBuf = useRef<SnakeSegment[]>([]);

  // Reset on token change
  useEffect(() => {
    startRef.current = Date.now();
    prevCol.current = -1;
    trailBuf.current = [];
    setTrail([]);
  }, [token.symbol]);

  useEffect(() => {
    const { gridWidth, gridHalfHeight, tickSize } = token;
    const colMs = SNAKE_SWEEP_MS / gridWidth;
    let raf: number;

    const tick = () => {
      const elapsed = Date.now() - startRef.current;
      const globalPhase = elapsed / colMs;
      const globalCol = Math.floor(globalPhase);

      // Find the closest ACTUAL grid row to the current price.
      // Grid rows have signedRow ∈ {±1, ±2, …, ±gridHalfHeight} — there is
      // no row at signedRow=0, so we must snap to the nearest valid row.
      const center = Math.round(currentPrice / tickSize) * tickSize;
      const totalRows = gridHalfHeight * 2;
      let signedRow = 1;
      let minD = Infinity;
      for (let ri = 0; ri < totalRows; ri++) {
        const sr =
          ri < gridHalfHeight
            ? gridHalfHeight - ri
            : -(ri - gridHalfHeight + 1);
        const rowPrice = center + sr * tickSize;
        const d = Math.abs(currentPrice - rowPrice);
        if (d < minD) {
          minD = d;
          signedRow = sr;
        }
      }

      const seg: SnakeSegment = { signedRow, globalCol, globalPhase };

      if (globalCol !== prevCol.current) {
        prevCol.current = globalCol;
        trailBuf.current = [seg, ...trailBuf.current].slice(
          0,
          SNAKE_TRAIL_MAX_SEGMENTS
        );
        setTrail([...trailBuf.current]);
      }
      setHead(seg);
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [token, currentPrice]);

  return { head, trail };
}
