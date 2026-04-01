"use client";

import { useMemo } from "react";
import { Bell, Bookmark, ExternalLink, Info } from "lucide-react";
import type { WatchlistItem } from "@/components/tv/Watchlist";

function pillClass() {
  return "inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-zinc-900/60 border border-zinc-800 text-[11px] text-zinc-200";
}

export function RightPanel(props: { active?: WatchlistItem }) {
  const active = props.active;

  const headlines = useMemo(
    () => [
      { title: "Market opens mixed as tech leads", source: "DemoWire", age: "2h" },
      { title: "Analysts raise target on large caps", source: "MockNews", age: "5h" },
      { title: "Rates unchanged; volatility cools", source: "PaperTerminal", age: "1d" },
    ],
    [],
  );

  return (
    <section className="h-full flex flex-col">
      <div className="h-12 px-3 flex items-center justify-between border-b border-zinc-900">
        <div className="text-xs font-semibold tracking-wide text-zinc-200">
          Details
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="size-9 rounded-xl bg-zinc-900/50 border border-zinc-800 hover:bg-zinc-900 flex items-center justify-center"
            aria-label="Alerts"
          >
            <Bell className="size-4 text-zinc-300" />
          </button>
          <button
            type="button"
            className="size-9 rounded-xl bg-zinc-900/50 border border-zinc-800 hover:bg-zinc-900 flex items-center justify-center"
            aria-label="Watch"
          >
            <Bookmark className="size-4 text-zinc-300" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto px-3 py-3 space-y-3">
        <div className="rounded-2xl border border-zinc-900 bg-zinc-950 p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-zinc-100">
                {active?.symbol ?? "—"}
              </div>
              <div className="text-[12px] text-zinc-400 truncate">
                {active?.name ?? "Select a symbol"}
              </div>
            </div>
            <span className={pillClass()}>{active?.exchange ?? "—"}</span>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <div className="rounded-xl bg-zinc-900/40 border border-zinc-900 px-3 py-2">
              <div className="text-[11px] text-zinc-500">Day range</div>
              <div className="text-sm font-semibold text-zinc-200">—</div>
            </div>
            <div className="rounded-xl bg-zinc-900/40 border border-zinc-900 px-3 py-2">
              <div className="text-[11px] text-zinc-500">Volume</div>
              <div className="text-sm font-semibold text-zinc-200">—</div>
            </div>
            <div className="rounded-xl bg-zinc-900/40 border border-zinc-900 px-3 py-2">
              <div className="text-[11px] text-zinc-500">Market cap</div>
              <div className="text-sm font-semibold text-zinc-200">—</div>
            </div>
            <div className="rounded-xl bg-zinc-900/40 border border-zinc-900 px-3 py-2">
              <div className="text-[11px] text-zinc-500">52w range</div>
              <div className="text-sm font-semibold text-zinc-200">—</div>
            </div>
          </div>

          <div className="mt-3 flex items-center justify-between">
            <span className={pillClass()}>
              <Info className="size-3 text-zinc-400" />
              Demo panel (wire real stats later)
            </span>
            <button
              type="button"
              className="text-[11px] text-zinc-300 hover:text-zinc-100 inline-flex items-center gap-1"
            >
              Open
              <ExternalLink className="size-3" />
            </button>
          </div>
        </div>

        <div className="rounded-2xl border border-zinc-900 bg-zinc-950 p-3">
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold tracking-wide text-zinc-200">
              News
            </div>
            <span className="text-[11px] text-zinc-500">Demo</span>
          </div>

          <ul className="mt-2 divide-y divide-zinc-900">
            {headlines.map((h) => (
              <li key={h.title} className="py-2">
                <div className="text-[12px] font-semibold text-zinc-200 leading-snug">
                  {h.title}
                </div>
                <div className="mt-0.5 text-[11px] text-zinc-500">
                  {h.source} · {h.age}
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

