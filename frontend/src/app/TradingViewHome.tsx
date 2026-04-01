"use client";

import { useMemo, useState } from "react";
import { TopBar } from "@/components/tv/TopBar";
import { Watchlist, type WatchlistItem } from "@/components/tv/Watchlist";
import { ChartPanel } from "@/components/tv/ChartPanel";
import { RightPanel } from "@/components/tv/RightPanel";

const DEFAULT_WATCHLIST: WatchlistItem[] = [
  { symbol: "AAPL", name: "Apple", exchange: "NASDAQ" },
  { symbol: "MSFT", name: "Microsoft", exchange: "NASDAQ" },
  { symbol: "NVDA", name: "NVIDIA", exchange: "NASDAQ" },
  { symbol: "TSLA", name: "Tesla", exchange: "NASDAQ" },
  { symbol: "SPY", name: "S&P 500 ETF", exchange: "NYSEARCA" },
  { symbol: "BTCUSD", name: "Bitcoin", exchange: "CRYPTO" },
  { symbol: "ETHUSD", name: "Ethereum", exchange: "CRYPTO" },
];

export function TradingViewHome() {
  const watchlist = useMemo(() => DEFAULT_WATCHLIST, []);
  const [activeSymbol, setActiveSymbol] = useState(watchlist[0]?.symbol ?? "AAPL");
  const [timeframe, setTimeframe] = useState<"1D" | "1W" | "1M">("1D");

  const active = watchlist.find((w) => w.symbol === activeSymbol) ?? watchlist[0];

  return (
    <div className="min-h-dvh bg-zinc-950 text-zinc-100">
      <TopBar
        activeSymbol={activeSymbol}
        timeframe={timeframe}
        onTimeframeChange={setTimeframe}
        onSymbolSubmit={(s) => setActiveSymbol(s)}
      />

      <div className="grid grid-cols-[280px_1fr_320px] gap-px bg-zinc-900 min-h-[calc(100dvh-56px)]">
        <aside className="bg-zinc-950">
          <Watchlist
            items={watchlist}
            activeSymbol={activeSymbol}
            onSelectSymbol={setActiveSymbol}
          />
        </aside>

        <main className="bg-zinc-950">
          <ChartPanel symbol={activeSymbol} timeframe={timeframe} />
        </main>

        <aside className="bg-zinc-950">
          <RightPanel active={active} />
        </aside>
      </div>
    </div>
  );
}

