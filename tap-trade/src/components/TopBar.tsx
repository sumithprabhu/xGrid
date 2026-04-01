import { useState } from "react";
import { Link } from "wouter";
import { ChevronDown } from "lucide-react";
import type { TokenConfig } from "../lib/types";
import { formatUsd, formatPrice } from "../lib/format";
import { NavAuthControls } from "./NavAuthControls";

/** Shared size for balance + wallet pills; balance keeps strong border, wallet lighter */
const GRID_NAV_PILL_CORE =
  "h-10 w-[11.5rem] sm:w-[12.5rem] shrink-0 flex items-center justify-center gap-1.5 rounded-full bg-[#0d1220] px-2 shadow-[0_0_20px_rgba(255,59,141,0.12)] min-w-0";
const GRID_NAV_PILL_BALANCE = `${GRID_NAV_PILL_CORE} border-2 border-[#ff3b8d]`;
const GRID_NAV_PILL_WALLET = `${GRID_NAV_PILL_CORE} border-2 border-[#ff3b8d]/30`;

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

  return (
    <header className="shrink-0 px-5 pt-4 pb-3 flex items-start justify-between gap-6 bg-[#0a0e1a]">
      <div className="flex flex-col gap-1 min-w-0">
        <div className="relative flex items-baseline gap-3">
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="text-left group"
          >
            <span className="font-logo text-[1.75rem] leading-none text-[#ff3b8d] drop-shadow-[0_0_18px_rgba(255,59,141,0.45)]">
              xGrid
            </span>
            <ChevronDown
              size={14}
              className="inline ml-1 text-[#ff3b8d]/60 align-middle -mt-1"
            />
          </button>
          {open && (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => setOpen(false)}
                aria-hidden
              />
              <div className="absolute top-full left-0 mt-2 z-50 bg-[#12182a] border border-[#ff3b8d]/25 rounded-xl overflow-hidden min-w-[220px] shadow-2xl shadow-black/50">
                {tokens.map((t) => (
                  <button
                    type="button"
                    key={t.symbol}
                    onClick={() => {
                      onSelectToken(t);
                      setOpen(false);
                    }}
                    className={`w-full text-left px-4 py-3 flex items-center justify-between hover:bg-[#ff3b8d]/10 transition-colors ${
                      t.symbol === selectedToken.symbol
                        ? "text-[#ff3b8d] bg-[#ff3b8d]/5"
                        : "text-zinc-300"
                    }`}
                  >
                    <span className="font-semibold text-sm">{t.symbol}</span>
                    <span className="text-[11px] text-zinc-500">{t.name}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        <p className="text-[15px] text-white/95 font-medium tracking-tight">
          <span className="text-white">{selectedToken.symbol}</span>
          <span className="text-zinc-500 mx-1.5">—</span>
          <span className="text-white tabular-nums">
            $ {formatPrice(currentPrice)}
          </span>
        </p>
      </div>

      <div className="shrink-0 flex items-center gap-2 sm:gap-2.5">
        <Link
          href="/portfolio"
          className={`${GRID_NAV_PILL_BALANCE} cursor-pointer no-underline transition-colors hover:bg-[#ff3b8d]/10 active:scale-[0.98]`}
          title={`Balance: ${formatUsd(balance)} — open portfolio`}
          aria-label="View portfolio"
        >
          <span className="text-[12px] sm:text-[13px] font-medium text-[#ff3b8d] font-mono tabular-nums truncate text-center w-full min-w-0">
            Balance: {formatUsd(balance)}
          </span>
        </Link>
        <NavAuthControls gridPillClassName={GRID_NAV_PILL_WALLET} />
      </div>
    </header>
  );
}
