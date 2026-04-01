import { useCallback, useEffect, useRef, useState } from "react";
import type { Bet, BetSize, TokenConfig } from "../lib/types";
import { calculateMultiplier } from "../lib/multiplier";
import { INITIAL_BALANCE } from "../lib/constants";

let counter = 0;

export function useBets(token: TokenConfig, currentPrice: number) {
  const [bets, setBets] = useState<Bet[]>([]);
  const [balance, setBalance] = useState(INITIAL_BALANCE);
  const [totalPnl, setTotalPnl] = useState(0);
  const betsRef = useRef(bets);
  betsRef.current = bets;

  // Reset on token change
  const prevSym = useRef(token.symbol);
  useEffect(() => {
    if (prevSym.current === token.symbol) return;
    prevSym.current = token.symbol;
    setBets([]);
    setBalance(INITIAL_BALANCE);
    setTotalPnl(0);
  }, [token.symbol]);

  const centerPrice =
    Math.round(currentPrice / token.tickSize) * token.tickSize;

  const placeBet = useCallback(
    (row: number, col: number, betSize: BetSize) => {
      if (balance < betSize) return null;

      const absRow = Math.abs(row);
      const mult = calculateMultiplier(absRow, col, token.houseEdgeBps);
      const priceLevel =
        Math.round((centerPrice + row * token.tickSize) * 100) / 100;

      const now = Math.floor(Date.now() / 1000);
      const nextBucket =
        Math.ceil(now / token.bucketSeconds) * token.bucketSeconds;
      const expiresAt = nextBucket + (col - 1) * token.bucketSeconds;

      const bet: Bet = {
        id: `b${++counter}`,
        tokenSymbol: token.symbol,
        row,
        col,
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

  // Resolve expired bets
  useEffect(() => {
    const iv = setInterval(() => {
      const now = Math.floor(Date.now() / 1000);
      const current = betsRef.current;
      const toResolve = current.filter(
        (b) => b.status === "active" && now >= b.expiresAt
      );
      if (toResolve.length === 0) return;

      const results = toResolve.map((bet) => {
        const winProb = 0.9 / bet.multiplier;
        const won = Math.random() < winProb;
        const pnl = won
          ? bet.amount * bet.multiplier - bet.amount
          : -bet.amount;
        return { id: bet.id, won, pnl };
      });

      setBets((prev) =>
        prev.map((bet) => {
          const r = results.find((x) => x.id === bet.id);
          if (!r) return bet;
          return {
            ...bet,
            status: r.won ? ("won" as const) : ("lost" as const),
            pnl: r.pnl,
          };
        })
      );

      let balDelta = 0;
      let pnlDelta = 0;
      for (const r of results) {
        const bet = toResolve.find((b) => b.id === r.id)!;
        if (r.won) balDelta += bet.amount * bet.multiplier;
        pnlDelta += r.pnl;
      }
      if (balDelta) setBalance((b) => b + balDelta);
      setTotalPnl((p) => p + pnlDelta);
    }, 1000);
    return () => clearInterval(iv);
  }, []);

  // Remove old resolved bets after 4s
  useEffect(() => {
    const iv = setInterval(() => {
      const now = Math.floor(Date.now() / 1000);
      setBets((prev) =>
        prev.filter((b) => b.status === "active" || now - b.expiresAt < 4)
      );
    }, 2000);
    return () => clearInterval(iv);
  }, []);

  return { bets, balance, totalPnl, placeBet };
}
