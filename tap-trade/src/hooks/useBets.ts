import { useCallback, useEffect, useRef, useState } from "react";
import type { Bet, BetSize, TokenConfig } from "../lib/types";
import type { SnakeSegment } from "./useSnakeTrail";
import { maxSnakeCol } from "./useSnakeTrail";
import { calculateMultiplier } from "../lib/multiplier";
import { GRID_TIME_HORIZONS_SEC, INITIAL_BALANCE } from "../lib/constants";

let counter = 0;

function resolveColumnsEntered(
  prevBets: Bet[],
  h: SnakeSegment,
  fromCol: number,
  toCol: number
): { next: Bet[]; balanceAdd: number; pnlAdd: number } {
  let balanceAdd = 0;
  let pnlAdd = 0;
  let next = prevBets;

  for (let c = fromCol; c <= toCol; c++) {
    next = next.map((bet) => {
      if (bet.status !== "active" || bet.targetCol !== c) return bet;
      const won = bet.row === h.signedRow;
      const pnl = won
        ? bet.amount * bet.multiplier - bet.amount
        : -bet.amount;
      pnlAdd += pnl;
      if (won) balanceAdd += bet.amount * bet.multiplier;
      return {
        ...bet,
        status: won ? ("won" as const) : ("lost" as const),
        pnl,
      };
    });
  }

  return { next, balanceAdd, pnlAdd };
}

export function useBets(
  token: TokenConfig,
  currentPrice: number,
  snakeHead: SnakeSegment | null
) {
  const [bets, setBets] = useState<Bet[]>([]);
  const [balance, setBalance] = useState(INITIAL_BALANCE);
  const [totalPnl, setTotalPnl] = useState(0);
  const betsRef = useRef(bets);
  betsRef.current = bets;
  const snakeRef = useRef(snakeHead);
  snakeRef.current = snakeHead;
  const prevSnakeColRef = useRef<number | null>(null);

  const prevSym = useRef(token.symbol);
  useEffect(() => {
    if (prevSym.current === token.symbol) return;
    prevSym.current = token.symbol;
    setBets([]);
    setBalance(INITIAL_BALANCE);
    setTotalPnl(0);
    prevSnakeColRef.current = null;
  }, [token.symbol]);

  const centerPrice =
    Math.round(currentPrice / token.tickSize) * token.tickSize;

  const placeBet = useCallback(
    (row: number, targetCol: number, betSize: BetSize) => {
      if (balance < betSize) return null;

      const now = Math.floor(Date.now() / 1000);
      const h = snakeRef.current;
      if (!h) return null;

      const cap = maxSnakeCol(token);
      const floor = h.col;
      /** Bets only on columns still ahead toward the chart (strictly left / lower index). */
      if (targetCol >= floor) return null;
      if (targetCol < 0 || targetCol > cap) return null;

      const absRow = Math.abs(row);
      const stepsAhead = Math.max(1, floor - targetCol);
      const mult = calculateMultiplier(
        absRow,
        stepsAhead,
        token.houseEdgeBps
      );
      const priceLevel =
        Math.round((centerPrice + row * token.tickSize) * 100) / 100;

      const horizonSec = GRID_TIME_HORIZONS_SEC[targetCol] ?? 60;
      const expiresAt = now + horizonSec;

      const bet: Bet = {
        id: `b${++counter}`,
        tokenSymbol: token.symbol,
        row,
        targetCol,
        col: stepsAhead,
        priceLevel,
        amount: betSize,
        multiplier: mult,
        placedAt: now,
        expiresAt,
        status: "active",
        pnl: 0,
      };

      setBets((prev) => [...prev, bet]);
      setBalance((b) => b - betSize);
      return bet;
    },
    [balance, centerPrice, token]
  );

  useEffect(() => {
    const iv = setInterval(() => {
      const now = Math.floor(Date.now() / 1000);
      setBets((prev) =>
        prev.filter((b) => b.status === "active" || now - b.expiresAt < 4)
      );
    }, 2000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    const h = snakeHead;
    if (!h) return;

    const nowCol = h.col;
    const prevCol = prevSnakeColRef.current;
    if (prevCol === null) {
      prevSnakeColRef.current = nowCol;
      return;
    }

    if (prevCol === nowCol) return;

    prevSnakeColRef.current = nowCol;

    const cap = maxSnakeCol(token);

    /** Head moves right → left: resolve columns stepped into (decreasing index). */
    if (nowCol < prevCol) {
      const { next, balanceAdd, pnlAdd } = resolveColumnsEntered(
        betsRef.current,
        h,
        nowCol,
        prevCol - 1
      );
      setBets(next);
      if (balanceAdd !== 0) setBalance((b) => b + balanceAdd);
      if (pnlAdd !== 0) setTotalPnl((p) => p + pnlAdd);
      return;
    }

    /* Wrapped lap: shore (low col) → ocean (high col) */
    let next = betsRef.current;
    let balanceAdd = 0;
    let pnlAdd = 0;
    if (prevCol > 0) {
      const r = resolveColumnsEntered(next, h, 0, prevCol - 1);
      next = r.next;
      balanceAdd += r.balanceAdd;
      pnlAdd += r.pnlAdd;
    }
    if (nowCol <= cap) {
      const r = resolveColumnsEntered(next, h, nowCol, cap);
      next = r.next;
      balanceAdd += r.balanceAdd;
      pnlAdd += r.pnlAdd;
    }
    setBets(next);
    if (balanceAdd !== 0) setBalance((b) => b + balanceAdd);
    if (pnlAdd !== 0) setTotalPnl((p) => p + pnlAdd);
  }, [snakeHead, token]);

  useEffect(() => {
    const iv = setInterval(() => {
      const now = Math.floor(Date.now() / 1000);
      const prev = betsRef.current;
      let pnlAdd = 0;
      let changed = false;
      const next = prev.map((bet) => {
        if (bet.status !== "active" || now < bet.expiresAt) return bet;
        changed = true;
        pnlAdd += -bet.amount;
        return {
          ...bet,
          status: "lost" as const,
          pnl: -bet.amount,
        };
      });
      if (changed) {
        setBets(next);
        if (pnlAdd !== 0) setTotalPnl((p) => p + pnlAdd);
      }
    }, 250);
    return () => clearInterval(iv);
  }, []);

  return { bets, balance, totalPnl, placeBet };
}
