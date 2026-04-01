import { useState } from "react";
import { ChevronDown, Wallet, TrendingUp } from "lucide-react";
import type { TokenConfig, BetSize } from "../lib/types";
import { formatUsd, formatPrice, formatPnl } from "../lib/format";
import { BET_SIZES } from "../lib/constants";

interface Props {
  tokens: TokenConfig[];
  selectedToken: TokenConfig;
  onSelectToken: (t: TokenConfig) => void;
  currentPrice: number;
  isLive: boolean;
  balance: number;
  betSize: BetSize;
  onBetSizeChange: (s: BetSize) => void;
  totalPnl: number;
}

export function TopBar({
  tokens,
  selectedToken,
  onSelectToken,
  currentPrice,
  isLive,
  balance,
  betSize,
  onBetSizeChange,
  totalPnl,
}: Props) {
  const [open, setOpen] = useState(false);

  return (
    <header className="h-14 shrink-0 border-b border-[#111] flex items-center justify-between px-5 gap-6 bg-[#050505]">
      {/* Token Selector */}
      <div className="relative">
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-[#1a1a1a] hover:border-emerald-800/60 transition-colors"
        >
          <TrendingUp size={14} className="text-emerald-500" />
          <span className="text-emerald-400 font-semibold text-sm tracking-wide">
            {selectedToken.symbol}
          </span>
          <ChevronDown size={12} className="text-zinc-600" />
        </button>

        {open && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <div className="absolute top-full left-0 mt-1 z-50 bg-[#0a0a0a] border border-[#1a1a1a] rounded-lg overflow-hidden min-w-[180px] shadow-xl shadow-black/60">
              {tokens.map((t) => (
                <button
                  key={t.symbol}
                  onClick={() => {
                    onSelectToken(t);
                    setOpen(false);
                  }}
                  className={`w-full text-left px-4 py-2.5 flex items-center justify-between hover:bg-[#111] transition-colors ${
                    t.symbol === selectedToken.symbol
                      ? "text-emerald-400"
                      : "text-zinc-400"
                  }`}
                >
                  <span className="font-medium text-sm">{t.symbol}</span>
                  <span className="text-[11px] text-zinc-600">{t.name}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Current Price */}
      <div className="flex items-center gap-2">
        <div className="text-lg font-semibold text-emerald-400 tracking-tight font-mono">
          ${formatPrice(currentPrice)}
        </div>
        {isLive && (
          <span className="flex items-center gap-1 text-[10px] text-emerald-600 uppercase tracking-widest">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            live
          </span>
        )}
      </div>

      {/* Bet Size Selector */}
      <div className="flex items-center gap-1.5">
        <span className="text-[11px] text-zinc-600 mr-1 uppercase tracking-wider">
          Bet
        </span>
        {BET_SIZES.map((s) => (
          <button
            key={s}
            onClick={() => onBetSizeChange(s)}
            className={`px-3 py-1 rounded text-xs font-semibold transition-all ${
              betSize === s
                ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                : "text-zinc-500 border border-[#1a1a1a] hover:text-zinc-300 hover:border-zinc-700"
            }`}
          >
            ${s}
          </button>
        ))}
      </div>

      {/* P&L */}
      <div
        className={`text-sm font-mono font-medium ${
          totalPnl >= 0 ? "text-emerald-400" : "text-rose-400"
        }`}
      >
        P&L {formatPnl(totalPnl)}
      </div>

      {/* Balance */}
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-[#1a1a1a]">
        <Wallet size={13} className="text-zinc-600" />
        <span className="text-zinc-300 font-mono text-sm font-medium">
          {formatUsd(balance)}
        </span>
        <span className="text-[10px] text-zinc-600 uppercase tracking-wider">
          USDC
        </span>
      </div>
    </header>
  );
}
