import { useEffect, useRef, useState } from "react";
import type { TokenConfig, PricePoint } from "../lib/types";
import { fetchQuote } from "../lib/price-api";
import { POLL_MS, MAX_CHART_POINTS } from "../lib/constants";

export function usePriceEngine(token: TokenConfig) {
  const [history, setHistory] = useState<PricePoint[]>([]);
  const [isLive, setIsLive] = useState(false);
  const lastTimeRef = useRef(0);
  const lastPriceRef = useRef(token.basePrice);

  const currentPrice =
    history.length > 0 ? history[history.length - 1].value : token.basePrice;

  useEffect(() => {
    if (history.length > 0) {
      lastTimeRef.current = history[history.length - 1].time;
      lastPriceRef.current = history[history.length - 1].value;
    }
  }, [history]);

  // Reset on token change
  useEffect(() => {
    setHistory([]);
    setIsLive(false);
    lastTimeRef.current = 0;
    lastPriceRef.current = token.basePrice;
  }, [token.symbol, token.basePrice]);

  // Poll the xStocks API
  useEffect(() => {
    let cancelled = false;

    async function poll() {
      const result = await fetchQuote(token);
      if (cancelled) return;

      // Update price if API returned data
      if (result) {
        lastPriceRef.current = result.price;
        setIsLive(true);
      }

      // Always add a point — use last known real price if this poll failed.
      // This keeps the chart dense without inventing data;
      // it just says "price hasn't changed since last successful read".
      let t = Math.floor(Date.now() / 1000);
      if (t <= lastTimeRef.current) t = lastTimeRef.current + 1;
      lastTimeRef.current = t;

      const point: PricePoint = { time: t, value: lastPriceRef.current };
      setHistory((prev) => {
        const next = [...prev, point];
        return next.length > MAX_CHART_POINTS
          ? next.slice(-MAX_CHART_POINTS)
          : next;
      });
    }

    poll();
    const iv = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [token.symbol, token.ticker]);

  return { currentPrice, history, isLive };
}
