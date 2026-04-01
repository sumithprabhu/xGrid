"use client";

import { ChevronDown } from "lucide-react";

export type WatchlistItem = {
  symbol: string;
  name: string;
  exchange: string;
};

export function Watchlist(props: {
  items: WatchlistItem[];
  activeSymbol: string;
  onSelectSymbol: (symbol: string) => void;
}) {
  const { items, activeSymbol, onSelectSymbol } = props;

  return (
    <section className="h-full flex flex-col">
      <div className="h-12 px-3 flex items-center justify-between border-b border-zinc-900">
        <div className="flex items-center gap-2">
          <div className="text-xs font-semibold tracking-wide text-zinc-200">
            Watchlist
          </div>
          <ChevronDown className="size-4 text-zinc-500" />
        </div>
        <div className="text-[11px] text-zinc-500">{items.length} symbols</div>
      </div>

      <div className="flex-1 overflow-auto">
        <ul className="divide-y divide-zinc-900">
          {items.map((it) => {
            const active = it.symbol === activeSymbol;
            return (
              <li key={it.symbol}>
                <button
                  type="button"
                  onClick={() => onSelectSymbol(it.symbol)}
                  className={[
                    "w-full px-3 py-3 text-left flex items-start justify-between gap-3 transition",
                    active ? "bg-zinc-900/60" : "hover:bg-zinc-900/40",
                  ].join(" ")}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <div className="text-sm font-semibold text-zinc-100">
                        {it.symbol}
                      </div>
                      <div className="text-[11px] text-zinc-500 truncate">
                        {it.exchange}
                      </div>
                    </div>
                    <div className="text-[12px] text-zinc-400 truncate">
                      {it.name}
                    </div>
                  </div>

                  <div className="text-right">
                    <div className="text-[11px] text-zinc-400">Demo</div>
                    <div className="text-xs font-semibold text-emerald-400">
                      +0.00%
                    </div>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

