"use client";

import { useMemo, useState } from "react";
import { Search, CandlestickChart, Settings2 } from "lucide-react";

export function TopBar(props: {
  activeSymbol: string;
  timeframe: "1D" | "1W" | "1M";
  onTimeframeChange: (t: "1D" | "1W" | "1M") => void;
  onSymbolSubmit: (symbol: string) => void;
}) {
  const { activeSymbol, timeframe, onTimeframeChange, onSymbolSubmit } = props;
  const [query, setQuery] = useState(activeSymbol);

  const timeframes = useMemo(() => ["1D", "1W", "1M"] as const, []);

  return (
    <header className="h-14 bg-zinc-950 border-b border-zinc-900 flex items-center gap-3 px-3">
      <div className="flex items-center gap-2">
        <div className="size-9 rounded-lg bg-zinc-900/60 border border-zinc-800 flex items-center justify-center">
          <CandlestickChart className="size-5 text-zinc-100" />
        </div>
        <div className="leading-tight">
          <div className="text-sm font-semibold tracking-wide">xStocks</div>
          <div className="text-[11px] text-zinc-400">Trading-style demo UI</div>
        </div>
      </div>

      <form
        className="ml-2 flex-1 max-w-[520px]"
        onSubmit={(e) => {
          e.preventDefault();
          const next = query.trim().toUpperCase();
          if (next) onSymbolSubmit(next);
        }}
      >
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-zinc-500" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full h-10 rounded-xl bg-zinc-900/50 border border-zinc-800 pl-9 pr-3 text-sm outline-none focus:border-zinc-700 focus:ring-2 focus:ring-zinc-800"
            placeholder="Search symbol (e.g. AAPL, BTCUSD)"
            aria-label="Symbol search"
          />
        </div>
      </form>

      <div className="flex items-center gap-2">
        <div className="flex rounded-xl bg-zinc-900/50 border border-zinc-800 p-1">
          {timeframes.map((tf) => {
            const active = tf === timeframe;
            return (
              <button
                key={tf}
                type="button"
                onClick={() => onTimeframeChange(tf)}
                className={[
                  "h-8 px-3 rounded-lg text-xs font-semibold transition",
                  active
                    ? "bg-zinc-100 text-zinc-950"
                    : "text-zinc-300 hover:bg-zinc-800/70 hover:text-zinc-100",
                ].join(" ")}
              >
                {tf}
              </button>
            );
          })}
        </div>

        <button
          type="button"
          className="size-10 rounded-xl bg-zinc-900/50 border border-zinc-800 hover:bg-zinc-900 flex items-center justify-center"
          aria-label="Settings"
        >
          <Settings2 className="size-4 text-zinc-300" />
        </button>
      </div>
    </header>
  );
}

