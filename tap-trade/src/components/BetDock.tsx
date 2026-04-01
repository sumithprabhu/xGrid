import { ChevronDown, ChevronUp } from "lucide-react";
import type { BetSize } from "../lib/types";
import { BET_SIZES } from "../lib/constants";

interface Props {
  betSize: BetSize;
  onBetSizeChange: (s: BetSize) => void;
}

export function BetDock({ betSize, onBetSizeChange }: Props) {
  const idx = BET_SIZES.indexOf(betSize);
  const up = () => {
    if (idx < BET_SIZES.length - 1) onBetSizeChange(BET_SIZES[idx + 1]);
  };
  const down = () => {
    if (idx > 0) onBetSizeChange(BET_SIZES[idx - 1]);
  };

  return (
    <div className="absolute bottom-5 left-5 z-30 flex flex-row items-center gap-1 rounded-lg border-2 border-[#ff3b8d]/80 bg-[#0a0e1a]/95 py-1 px-1 shadow-[0_0_24px_rgba(255,59,141,0.15)] backdrop-blur-sm">
      <button
        type="button"
        onClick={down}
        disabled={idx <= 0}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[#ff3b8d] text-white shadow-[0_0_12px_rgba(255,59,141,0.5)] transition hover:bg-[#ff5ba8] disabled:opacity-30 disabled:shadow-none"
        aria-label="Decrease bet size"
      >
        <ChevronDown size={18} strokeWidth={2.5} />
      </button>
      <span className="min-w-[2.25rem] text-center text-[13px] font-semibold text-white font-mono tabular-nums px-0.5">
        ${betSize}
      </span>
      <button
        type="button"
        onClick={up}
        disabled={idx >= BET_SIZES.length - 1}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[#ff3b8d] text-white shadow-[0_0_12px_rgba(255,59,141,0.5)] transition hover:bg-[#ff5ba8] disabled:opacity-30 disabled:shadow-none"
        aria-label="Increase bet size"
      >
        <ChevronUp size={18} strokeWidth={2.5} />
      </button>
    </div>
  );
}
