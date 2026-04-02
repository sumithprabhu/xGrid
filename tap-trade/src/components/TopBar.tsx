import { useState, useRef, useEffect } from "react";
import { Link } from "wouter";
import { ChevronDown, Search, TrendingUp } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import type { TokenConfig } from "../lib/types";
import { formatUsd, formatPrice } from "../lib/format";
import { NavAuthControls } from "./NavAuthControls";

const PILL_BASE =
  "h-10 w-[11.5rem] sm:w-[12.5rem] shrink-0 flex items-center justify-center gap-1.5 rounded-full bg-[#0d1220] px-2 shadow-[0_0_20px_rgba(255,59,141,0.12)] min-w-0";
const PILL_BALANCE = `${PILL_BASE} border-2 border-[#ff3b8d]`;
const PILL_WALLET = `${PILL_BASE} border-2 border-[#ff3b8d]/30`;

/** Category labels for visual grouping */
const CATEGORIES: Record<string, string[]> = {
  Tech: ["AAPL", "NVDA", "TSLA", "MSFT", "GOOG", "AMZN", "META"],
  "Indices / ETFs": ["SPY", "QQQ", "IWM"],
  Finance: ["JPM", "GS"],
  Other: ["COIN", "PLTR"],
};

function getCategoryFor(ticker: string): string {
  for (const [cat, tickers] of Object.entries(CATEGORIES)) {
    if (tickers.includes(ticker)) return cat;
  }
  return "Other";
}

interface Props {
  tokens: TokenConfig[];
  selectedToken: TokenConfig;
  onSelectToken: (t: TokenConfig) => void;
  currentPrice: number;
  balance: number;
}

export function TopBar({
  tokens,
  selectedToken,
  onSelectToken,
  currentPrice,
  balance,
}: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  // Focus search when dropdown opens
  useEffect(() => {
    if (open) {
      setTimeout(() => searchRef.current?.focus(), 50);
    } else {
      setSearch("");
    }
  }, [open]);

  // Filter tokens by search
  const filtered = tokens.filter(
    (t) =>
      !search ||
      t.name.toLowerCase().includes(search.toLowerCase()) ||
      t.ticker.toLowerCase().includes(search.toLowerCase()) ||
      t.symbol.toLowerCase().includes(search.toLowerCase())
  );

  // Group filtered tokens by category
  const grouped = new Map<string, TokenConfig[]>();
  for (const t of filtered) {
    const cat = getCategoryFor(t.ticker);
    if (!grouped.has(cat)) grouped.set(cat, []);
    grouped.get(cat)!.push(t);
  }

  return (
    <header className="shrink-0 px-5 pt-4 pb-3 flex items-start justify-between gap-6 bg-[#0a0e1a] z-[60] relative">
      <div className="flex flex-col gap-1 min-w-0">
        <div className="relative flex items-baseline gap-3">
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="text-left group flex items-center gap-2"
          >
            <span className="font-logo text-[1.75rem] leading-none text-[#ff3b8d] drop-shadow-[0_0_18px_rgba(255,59,141,0.45)] mr-3">
              xGrid
            </span>
            <span className="text-white/60 text-sm font-medium hidden sm:inline">
              {selectedToken.ticker}
            </span>
            <ChevronDown
              size={14}
              className={`text-[#ff3b8d]/60 transition-transform duration-200 ${
                open ? "rotate-180" : ""
              }`}
            />
          </button>

          {/* ── Dropdown ── */}
          <AnimatePresence>
            {open && (
              <>
                <div
                  className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm"
                  onClick={() => setOpen(false)}
                  aria-hidden
                />
                <motion.div
                  initial={{ opacity: 0, y: -8, scale: 0.96 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -6, scale: 0.97 }}
                  transition={{ duration: 0.15, ease: "easeOut" }}
                  className="absolute top-full left-0 mt-2 z-50 bg-[#0d1220] border border-[#ff3b8d]/20 rounded-xl overflow-hidden w-[280px] shadow-2xl shadow-black/60"
                >
                  {/* Search */}
                  <div className="p-2 border-b border-white/5">
                    <div className="flex items-center gap-2 bg-white/5 rounded-lg px-3 py-2">
                      <Search size={14} className="text-zinc-500 shrink-0" />
                      <input
                        ref={searchRef}
                        type="text"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search tokens..."
                        className="bg-transparent border-none outline-none text-sm text-white placeholder-zinc-500 w-full font-mono"
                      />
                    </div>
                  </div>

                  {/* Token list */}
                  <div className="max-h-[360px] overflow-y-auto py-1">
                    {filtered.length === 0 && (
                      <p className="text-center text-zinc-500 text-xs py-6">
                        No tokens match "{search}"
                      </p>
                    )}

                    {[...grouped.entries()].map(([category, items]) => (
                      <div key={category}>
                        <div className="px-3 pt-2.5 pb-1">
                          <span className="text-[10px] font-semibold tracking-wider text-zinc-500 uppercase">
                            {category}
                          </span>
                        </div>
                        {items.map((t) => {
                          const isSelected =
                            t.symbol === selectedToken.symbol;
                          return (
                            <button
                              type="button"
                              key={t.symbol}
                              onClick={() => {
                                onSelectToken(t);
                                setOpen(false);
                              }}
                              className={`w-full text-left px-3 py-2.5 flex items-center gap-3 transition-colors ${
                                isSelected
                                  ? "bg-[#ff3b8d]/10"
                                  : "hover:bg-white/[0.04]"
                              }`}
                            >
                              {/* Icon circle */}
                              <div
                                className={`w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 ${
                                  isSelected
                                    ? "bg-[#ff3b8d]/20 text-[#ff3b8d] ring-1 ring-[#ff3b8d]/40"
                                    : "bg-white/5 text-zinc-400"
                                }`}
                              >
                                {t.ticker.slice(0, 2)}
                              </div>

                              {/* Info */}
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <span
                                    className={`text-sm font-semibold ${
                                      isSelected
                                        ? "text-[#ff3b8d]"
                                        : "text-white"
                                    }`}
                                  >
                                    {t.symbol}
                                  </span>
                                  {isSelected && (
                                    <TrendingUp
                                      size={12}
                                      className="text-[#ff3b8d]"
                                    />
                                  )}
                                </div>
                                <span className="text-[11px] text-zinc-500">
                                  {t.name}
                                </span>
                              </div>

                              {/* Volatility indicator */}
                              <div className="text-right shrink-0">
                                <div className="flex gap-0.5 justify-end">
                                  {[1, 2, 3].map((lvl) => (
                                    <div
                                      key={lvl}
                                      className={`w-1 rounded-full ${
                                        t.volatility >= lvl * 0.0005
                                          ? "bg-[#ff3b8d]"
                                          : "bg-white/10"
                                      }`}
                                      style={{
                                        height: 4 + lvl * 3,
                                      }}
                                    />
                                  ))}
                                </div>
                                <span className="text-[9px] text-zinc-600 mt-0.5 block">
                                  vol
                                </span>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                </motion.div>
              </>
            )}
          </AnimatePresence>
        </div>

        <p className="text-[15px] text-white/95 font-medium tracking-tight mt-2">
          <span className="text-white">{selectedToken.symbol}</span>
          <span className="text-zinc-500 mx-1.5">-</span>
          <span className="text-white tabular-nums">
            $ {formatPrice(currentPrice)}
          </span>
        </p>
      </div>

      <div className="shrink-0 flex items-center gap-2 sm:gap-2.5">
        <Link
          href="/portfolio"
          className={`${PILL_BALANCE} cursor-pointer no-underline transition-colors hover:bg-[#ff3b8d]/10 active:scale-[0.98]`}
          title={`Balance: ${formatUsd(balance)} — open portfolio`}
          aria-label="View portfolio"
        >
          <span className="text-[12px] sm:text-[13px] font-medium text-[#ff3b8d] font-mono tabular-nums truncate text-center w-full min-w-0">
            Balance: {formatUsd(balance)}
          </span>
        </Link>
        <NavAuthControls gridPillClassName={PILL_WALLET} />
      </div>
    </header>
  );
}
