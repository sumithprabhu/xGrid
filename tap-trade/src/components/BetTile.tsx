import type { Bet } from "../lib/types";
import { formatUsd, formatMult, formatPnl } from "../lib/format";

interface Props {
  bet: Bet;
  x: number;
  y: number;
}

export function BetTile({ bet, x, y }: Props) {
  const won = bet.status === "won";
  const lost = bet.status === "lost";

  return (
    <div
      className={`absolute -translate-x-1/2 -translate-y-1/2 pointer-events-none transition-all duration-500 ${
        lost ? "opacity-0 scale-75" : "opacity-100 scale-100"
      } ${bet.status === "active" ? "animate-[fadeIn_0.25s_ease-out]" : ""}`}
      style={{ left: x, top: y }}
    >
      <div
        className={`px-2.5 py-1 rounded-md text-center min-w-[56px] backdrop-blur-sm ${
          won
            ? "bg-emerald-500/25 border border-emerald-400/40 shadow-[0_0_16px_rgba(16,185,129,0.25)]"
            : "bg-emerald-950/50 border border-emerald-900/25"
        }`}
      >
        <div
          className={`text-xs font-mono font-semibold leading-tight ${
            won ? "text-emerald-300" : "text-zinc-200"
          }`}
        >
          {won ? formatPnl(bet.pnl) : formatUsd(bet.amount)}
        </div>
        <div className="text-[9px] font-mono text-emerald-600 leading-tight mt-0.5">
          {formatMult(bet.multiplier)}
        </div>
      </div>
    </div>
  );
}
