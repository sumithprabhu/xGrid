import { useCallback, useEffect, useMemo, useRef } from "react";
import type { TokenConfig, Bet, BetSize } from "../lib/types";
import { calculateMultiplier } from "../lib/multiplier";
import { formatMult, formatUsd, formatPnl } from "../lib/format";

interface Props {
  token: TokenConfig;
  currentPrice: number;
  betSize: BetSize;
  bets: Bet[];
  onCellClick: (row: number, col: number) => void;
}

export function MultiplierGrid({ token, currentPrice, bets, onCellClick }: Props) {
  const { gridHalfHeight, gridWidth, houseEdgeBps, tickSize, bucketSeconds } =
    token;
  const cols = gridWidth + 1;
  const rows = gridHalfHeight * 2;
  const center = Math.round(currentPrice / tickSize) * tickSize;

  const rowData = useMemo(() => {
    const out: { signedRow: number; absRow: number; price: number }[] = [];
    for (let ri = 0; ri < rows; ri++) {
      const signedRow =
        ri < gridHalfHeight
          ? gridHalfHeight - ri
          : -(ri - gridHalfHeight + 1);
      out.push({
        signedRow,
        absRow: Math.abs(signedRow),
        price: center + signedRow * tickSize,
      });
    }
    return out;
  }, [gridHalfHeight, rows, center, tickSize]);

  // Which row is the line currently in?
  const activeRowIdx = useMemo(() => {
    let closest = 0;
    let minDist = Infinity;
    for (let i = 0; i < rowData.length; i++) {
      const d = Math.abs(currentPrice - rowData[i].price);
      if (d < minDist) { minDist = d; closest = i; }
    }
    return closest;
  }, [currentPrice, rowData]);

  // Map cells to bets by absolute expiry
  const cellBets = useMemo(() => {
    const m = new Map<string, Bet>();
    for (const b of bets) {
      const key = `${b.row}:${b.expiresAt}`;
      const existing = m.get(key);
      if (!existing || b.status === "active") m.set(key, b);
    }
    return m;
  }, [bets]);

  // Smooth scroll via RAF
  const outerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let raf: number;
    const outer = outerRef.current;
    const inner = scrollRef.current;
    if (!outer || !inner) return;
    function tick() {
      const now = Date.now() / 1000;
      const progress = (now % bucketSeconds) / bucketSeconds;
      const cellW = outer!.clientWidth / gridWidth;
      inner!.style.transform = `translateX(${-progress * cellW}px)`;
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [bucketSeconds, gridWidth]);

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>, row: number, col: number) => {
      onCellClick(row, col);
      const btn = e.currentTarget;
      btn.classList.add("cell-flash");
      setTimeout(() => btn.classList.remove("cell-flash"), 350);
    },
    [onCellClick]
  );

  const cellW = `${100 / cols}%`;

  return (
    <div className="h-full flex flex-col select-none">
      <div ref={outerRef} className="flex-1 flex flex-col overflow-hidden">
        <div
          ref={scrollRef}
          className="h-full flex flex-col will-change-transform"
          style={{ width: `${(cols / gridWidth) * 100}%` }}
        >
          {/* Time headers */}
          <div className="flex h-6 shrink-0">
            <div className="w-[52px] shrink-0" />
            {Array.from({ length: cols }, (_, c) => (
              <div
                key={c}
                style={{ width: cellW }}
                className="shrink-0 flex items-center justify-center text-[9px] text-zinc-700 font-mono"
              >
                {(c + 1) * bucketSeconds}s
              </div>
            ))}
          </div>

          {/* Grid rows */}
          <div className="flex-1 flex flex-col min-h-0">
            {rowData.map(({ signedRow, absRow, price }, ri) => {
              const isActive = ri === activeRowIdx;
              const isGap = ri === gridHalfHeight - 1;

              return (
                <div
                  key={ri}
                  className={`flex-1 flex items-stretch min-h-0 transition-colors duration-300 ${
                    isGap ? "border-b border-emerald-500/10" : "border-b border-white/[0.02]"
                  } ${isActive ? "price-row-active" : ""}`}
                >
                  {/* Price label */}
                  <div className={`w-[52px] shrink-0 flex items-center justify-end pr-2 transition-colors duration-300 ${
                    isActive ? "text-emerald-400" : "text-zinc-700"
                  }`}>
                    <span className="text-[10px] font-mono tabular-nums">
                      {price.toFixed(2)}
                    </span>
                  </div>

                  {/* Cells */}
                  {Array.from({ length: cols }, (_, ci) => {
                    const tb = ci + 1;
                    const mult = calculateMultiplier(absRow, tb, houseEdgeBps);

                    const now = Math.floor(Date.now() / 1000);
                    const nextBucket = Math.ceil(now / bucketSeconds) * bucketSeconds;
                    const cellExpiry = nextBucket + ci * bucketSeconds;
                    const bet = cellBets.get(`${signedRow}:${cellExpiry}`);
                    const state = bet?.status;

                    return (
                      <button
                        key={ci}
                        style={{ width: cellW }}
                        onClick={(e) => handleClick(e, signedRow, tb)}
                        className={`shrink-0 grid-cell flex items-center justify-center border-l border-white/[0.02] relative cursor-pointer ${
                          state === "active" ? "has-bet" :
                          state === "won" ? "cell-won" :
                          state === "lost" ? "cell-lost" : ""
                        } ${isActive ? "row-glow" : ""}`}
                      >
                        <span className="dot dot-tl" />
                        <span className="dot dot-tr" />
                        <span className="dot dot-bl" />
                        <span className="dot dot-br" />

                        {bet ? (
                          <div className="bet-inline">
                            <div className="bet-amount">
                              {state === "won" ? formatPnl(bet.pnl) : formatUsd(bet.amount)}
                            </div>
                            <div className="bet-mult">{formatMult(bet.multiplier)}</div>
                          </div>
                        ) : (
                          <span className="cell-label">{formatMult(mult)}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
