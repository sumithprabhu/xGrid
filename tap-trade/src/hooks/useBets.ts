import { useCallback, useEffect, useRef, useState } from "react";
import type { Bet, BetSize, TokenConfig } from "../lib/types";
import type { SnakeSegment } from "./useSnakeTrail";
import { calculateMultiplier } from "../lib/multiplier";
import { INITIAL_BALANCE, SNAKE_COLUMN_HIT_LAG } from "../lib/constants";

let betSeq = 0;

export function useBets(
  token: TokenConfig,
  currentPrice: number,
  head: SnakeSegment,
  trail: SnakeSegment[] = []
) {
  const [bets, setBets] = useState<Bet[]>([]);
  const [balance, setBalance] = useState(INITIAL_BALANCE);
  const headRef = useRef(head);
  headRef.current = head;

  useEffect(() => {
    setBets([]);
    setBalance(INITIAL_BALANCE);
  }, [token.symbol]);

  const placeBet = useCallback(
    (signedRow: number, globalCol: number, size: BetSize) => {
      const { tickSize, houseEdgeBps } = token;
      const h = headRef.current;

      const stepsAhead = globalCol - h.globalCol;
      if (stepsAhead <= 0) return;
      if (size > balance) return;

      const absRow = Math.abs(signedRow);
      const mult = calculateMultiplier(absRow, stepsAhead, houseEdgeBps);
      if (mult <= 0) return;

      const center = Math.round(currentPrice / tickSize) * tickSize;
      const priceLevel = center + signedRow * tickSize;

      const bet: Bet = {
        id: `bet-${++betSeq}`,
        tokenSymbol: token.symbol,
        row: signedRow,
        targetCol: globalCol, // absolute global column
        col: stepsAhead,
        priceLevel,
        amount: size,
        multiplier: mult,
        placedAt: Date.now(),
        expiresAt: Date.now() + 120_000,
        status: "active",
        pnl: 0,
      };

      setBalance((b) => b - size);
      setBets((prev) => [...prev, bet]);
    },
    [token, currentPrice, balance]
  );

  // Resolve bets as snake advances (column-based, not time-based).
  // Use trail data to get the row the snake was on WHEN it crossed the
  // target column — head.signedRow may have moved since then.
  useEffect(() => {
    const effectiveCol = Math.floor(
      Math.max(0, head.globalPhase - SNAKE_COLUMN_HIT_LAG)
    );

    // Build lookup: column → row the snake occupied at that moment
    const rowAtCol = new Map<number, number>();
    for (const seg of trail) rowAtCol.set(seg.globalCol, seg.signedRow);
    rowAtCol.set(head.globalCol, head.signedRow);

    setBets((prev) => {
      let changed = false;
      const next = prev.map((b) => {
        if (b.status !== "active") return b;
        if (effectiveCol < b.targetCol) return b;

        changed = true;
        const snakeRow = rowAtCol.get(b.targetCol) ?? head.signedRow;
        const won = snakeRow === b.row;
        const pnl = won ? b.amount * b.multiplier - b.amount : -b.amount;
        return {
          ...b,
          status: won ? ("won" as const) : ("lost" as const),
          pnl,
        };
      });

      if (!changed) return prev;

      const newWinnings = next
        .filter(
          (b) =>
            b.status === "won" &&
            prev.find((p) => p.id === b.id)?.status === "active"
        )
        .reduce((sum, b) => sum + b.amount * b.multiplier, 0);
      if (newWinnings > 0) setBalance((bal) => bal + newWinnings);

      return next;
    });
  }, [head, trail]);

  // Clean up old resolved bets
  useEffect(() => {
    const iv = setInterval(() => {
      setBets((prev) => {
        const now = Date.now();
        return prev.filter(
          (b) => b.status === "active" || now - b.placedAt < 15_000
        );
      });
    }, 5000);
    return () => clearInterval(iv);
  }, []);

  return { bets, balance, placeBet };
}
