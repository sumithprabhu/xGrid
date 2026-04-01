"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  IChartApi,
  ISeriesApi,
  UTCTimestamp,
} from "lightweight-charts";
import { CandlestickSeries, createChart, CrosshairMode } from "lightweight-charts";
import { generateCandles, summarizeCandles, type Candle } from "@/lib/market-data";

type Timeframe = "1D" | "1W" | "1M";

function formatNumber(n: number) {
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  }).format(n);
}

function formatPct(n: number) {
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

export function ChartPanel(props: { symbol: string; timeframe: Timeframe }) {
  const { symbol, timeframe } = props;

  const candles = useMemo(() => generateCandles({ symbol, timeframe }), [symbol, timeframe]);
  const summary = useMemo(() => summarizeCandles(candles), [candles]);

  const hostRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);

  const [hover, setHover] = useState<{
    time?: UTCTimestamp;
    open?: number;
    high?: number;
    low?: number;
    close?: number;
  } | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const chart = createChart(host, {
      layout: {
        background: { color: "#09090b" },
        textColor: "#d4d4d8",
        fontFamily:
          'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
      },
      rightPriceScale: {
        borderColor: "#27272a",
      },
      timeScale: {
        borderColor: "#27272a",
        timeVisible: true,
        secondsVisible: false,
      },
      grid: {
        vertLines: { color: "#18181b" },
        horzLines: { color: "#18181b" },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: "#3f3f46", width: 1, style: 0 },
        horzLine: { color: "#3f3f46", width: 1, style: 0 },
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
      },
      handleScale: {
        axisPressedMouseMove: true,
        mouseWheel: true,
        pinch: true,
      },
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#10b981",
      downColor: "#ef4444",
      wickUpColor: "#10b981",
      wickDownColor: "#ef4444",
      borderVisible: false,
    });

    chartRef.current = chart;
    seriesRef.current = series;

    const ro = new ResizeObserver(() => {
      chart.applyOptions({
        width: host.clientWidth,
        height: host.clientHeight,
      });
    });
    ro.observe(host);
    resizeObserverRef.current = ro;

    chart.subscribeCrosshairMove((param) => {
      if (!param || !param.time || !param.seriesData) {
        setHover(null);
        return;
      }

      const point = param.seriesData.get(series as never) as Candle | undefined;
      if (!point) {
        setHover(null);
        return;
      }

      setHover({
        time: param.time as UTCTimestamp,
        open: point.open,
        high: point.high,
        low: point.low,
        close: point.close,
      });
    });

    return () => {
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
      chartRef.current?.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  useEffect(() => {
    const series = seriesRef.current;
    const chart = chartRef.current;
    if (!series || !chart) return;

    series.setData(candles);
    chart.timeScale().fitContent();
  }, [candles]);

  const ohlc = hover ?? (summary ? { open: summary.open, high: summary.high, low: summary.low, close: summary.close } : null);
  const change = summary ? summary.change : 0;
  const changePct = summary ? summary.changePct : 0;
  const changeUp = change >= 0;

  return (
    <section className="h-full flex flex-col">
      <div className="h-12 px-4 flex items-center justify-between border-b border-zinc-900">
        <div className="min-w-0">
          <div className="flex items-end gap-3">
            <div className="text-sm font-semibold tracking-wide text-zinc-100">
              {symbol}
            </div>
            <div className="text-[11px] text-zinc-500">{timeframe}</div>
            <div
              className={[
                "text-xs font-semibold",
                changeUp ? "text-emerald-400" : "text-rose-400",
              ].join(" ")}
            >
              {formatNumber(summary?.close ?? 0)} ({formatPct(changePct)})
            </div>
          </div>
          {ohlc && (
            <div className="mt-0.5 text-[11px] text-zinc-400">
              O {formatNumber(ohlc.open ?? 0)} · H {formatNumber(ohlc.high ?? 0)} · L{" "}
              {formatNumber(ohlc.low ?? 0)} · C {formatNumber(ohlc.close ?? 0)}
            </div>
          )}
        </div>

        <div className="text-[11px] text-zinc-500">
          Demo candles (no live data)
        </div>
      </div>

      <div className="flex-1 min-h-0">
        <div ref={hostRef} className="h-full w-full" />
      </div>

      <div className="h-11 px-4 border-t border-zinc-900 flex items-center justify-between text-[11px] text-zinc-500">
        <div className="flex items-center gap-3">
          <span className="text-zinc-400">Panels</span>
          <span className="px-2 py-1 rounded-md bg-zinc-900/60 border border-zinc-800 text-zinc-200">
            Chart
          </span>
          <span className="px-2 py-1 rounded-md hover:bg-zinc-900/60 hover:border-zinc-800 border border-transparent">
            Overview
          </span>
          <span className="px-2 py-1 rounded-md hover:bg-zinc-900/60 hover:border-zinc-800 border border-transparent">
            News
          </span>
        </div>
        <div>
          {summary ? (
            <span className={changeUp ? "text-emerald-400" : "text-rose-400"}>
              {changeUp ? "+" : ""}
              {formatNumber(change)} ({formatPct(changePct)})
            </span>
          ) : (
            "—"
          )}
        </div>
      </div>
    </section>
  );
}

