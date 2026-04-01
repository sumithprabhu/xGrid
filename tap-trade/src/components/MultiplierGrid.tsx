import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { motion, useMotionValue, useSpring } from "framer-motion";
import type { TokenConfig, Bet, BetSize } from "../lib/types";
import type { SnakeSegment } from "../hooks/useSnakeTrail";
import { maxSnakeCol } from "../hooks/useSnakeTrail";
import { GRID_TIME_HORIZONS_SEC } from "../lib/constants";
import { formatHorizonLabel } from "../lib/gridHorizons";
import { calculateMultiplier } from "../lib/multiplier";
import { formatMult, formatBetCompact, formatPnl } from "../lib/format";

interface Props {
  token: TokenConfig;
  currentPrice: number;
  betSize: BetSize;
  bets: Bet[];
  snakeHead: SnakeSegment;
  snakeTrail: SnakeSegment[];
  onCellClick: (row: number, targetCol: number) => void;
  onSnakeHitBet?: (bet: Bet) => void;
}

export function MultiplierGrid({
  token,
  currentPrice,
  bets,
  snakeHead,
  snakeTrail,
  onCellClick,
  onSnakeHitBet,
}: Props) {
  const [, setTick] = useState(0);
  const [hitKey, setHitKey] = useState<string | null>(null);
  /** Random playable column — full column highlight (no full-row wash). */
  const [spotlightCol, setSpotlightCol] = useState<number | null>(null);
  const prevHeadKeyRef = useRef<string>("");

  useEffect(() => {
    const iv = setInterval(() => setTick((x) => x + 1), 250);
    return () => clearInterval(iv);
  }, []);

  const { gridHalfHeight, gridWidth, houseEdgeBps, tickSize } = token;
  const rows = gridHalfHeight * 2;
  const center = Math.round(currentPrice / tickSize) * tickSize;

  const headFloor = snakeHead.col;
  const maxPlay = maxSnakeCol(token);
  const numCols = gridWidth;

  useEffect(() => {
    let cancelled = false;
    let timeoutId: number;

    function scheduleNext() {
      const delay = 1800 + Math.floor(Math.random() * 1600);
      timeoutId = window.setTimeout(() => {
        if (cancelled) return;
        const playable = maxPlay + 1;
        if (playable >= 1) {
          setSpotlightCol(Math.floor(Math.random() * playable));
        } else {
          setSpotlightCol(null);
        }
        scheduleNext();
      }, delay);
    }

    scheduleNext();
    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [maxPlay]);

  /** Price within tick → vertical micro-shift (rows track live quote) */
  const rowsAreaRef = useRef<HTMLDivElement>(null);
  const [rowHeightPx, setRowHeightPx] = useState(36);
  useLayoutEffect(() => {
    const el = rowsAreaRef.current;
    if (!el) return;
    const measure = () => {
      const h = el.clientHeight / Math.max(1, rows);
      if (h > 8) setRowHeightPx(h);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [rows]);

  const targetY = useMotionValue(0);
  const springY = useSpring(targetY, {
    stiffness: 90,
    damping: 22,
    mass: 0.65,
  });
  useEffect(() => {
    const anchor =
      Math.round(currentPrice / tickSize) * tickSize;
    const fracTicks = (currentPrice - anchor) / tickSize;
    targetY.set(-fracTicks * rowHeightPx);
  }, [currentPrice, tickSize, rowHeightPx, targetY]);

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

  const activeRowIdx = useMemo(() => {
    let closest = 0;
    let minDist = Infinity;
    for (let i = 0; i < rowData.length; i++) {
      const d = Math.abs(currentPrice - rowData[i].price);
      if (d < minDist) {
        minDist = d;
        closest = i;
      }
    }
    return closest;
  }, [currentPrice, rowData]);

  const cellBets = useMemo(() => {
    const m = new Map<string, Bet>();
    for (const bet of bets) {
      const key = `${bet.row}:${bet.targetCol}`;
      const existing = m.get(key);
      if (!existing || bet.status === "active") m.set(key, bet);
    }
    return m;
  }, [bets]);

  useEffect(() => {
    const h = snakeHead;
    const key = `${h.signedRow}:${h.col}`;
    if (key === prevHeadKeyRef.current) return;
    prevHeadKeyRef.current = key;

    const bet = cellBets.get(key);
    if (bet?.status === "active") {
      setHitKey(key);
      onSnakeHitBet?.(bet);
      const t = window.setTimeout(() => setHitKey(null), 800);
      return () => clearTimeout(t);
    }
  }, [snakeHead, cellBets, onSnakeHitBet]);

  const snakeBodyAtCell = useMemo(() => {
    const map = new Set<string>();
    for (const seg of snakeTrail.slice(1)) {
      map.add(`${seg.signedRow}:${seg.col}`);
    }
    return map;
  }, [snakeTrail]);

  const handleClick = useCallback(
    (
      e: React.MouseEvent<HTMLButtonElement>,
      row: number,
      col: number,
      canBet: boolean
    ) => {
      if (!canBet) return;
      onCellClick(row, col);
      const btn = e.currentTarget;
      btn.classList.add("cell-flash");
      setTimeout(() => btn.classList.remove("cell-flash"), 350);
    },
    [onCellClick]
  );

  const cellW = `${100 / numCols}%`;

  return (
    <div className="h-full flex flex-col select-none overflow-hidden">
      <p className="shrink-0 px-2 py-1 text-center text-[10px] font-medium tracking-wide text-zinc-500 border-b border-[#141c2e]/60 bg-[#080c14]/80">
        <span className="text-zinc-400">LIVE</span>
        <span className="mx-1.5 text-[#ff3b8d]/90">←</span>
        <span className="text-emerald-400/90">meets</span>
        <span className="mx-1.5 text-zinc-400">chart</span>
        <span className="text-zinc-600">·</span>
        <span className="ml-1.5 text-emerald-500/80">
          Tap green · wave rolls to the shore
        </span>
      </p>
      <div className="grid-cylinder-shell flex-1 min-h-0 min-w-0 overflow-hidden flex flex-col">
        <motion.div
          className="flex-1 flex flex-col min-h-0 min-w-0 will-change-transform"
          style={{ y: springY }}
        >
          <div className="grid-cylinder-inner multiplier-grid-drift flex h-full min-h-0 flex-col min-w-[720px]">
        <motion.div
          key={snakeHead.floorGlobalCol}
          initial={{ opacity: 0.82, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          className="flex h-10 shrink-0 border-b border-[#1e293b] bg-[#0c101c]/95"
        >
          <div className="w-[52px] shrink-0 border-r border-[#1e293b]/90 relative z-[2] bg-[#0c101c]/95" />
          {Array.from({ length: numCols }, (_, ci) => {
            const isPast = ci > headFloor;
            const isNow = ci === headFloor;
            const reserved = ci > maxPlay;
            const canBetHere = !reserved && ci < headFloor;
            const idx =
              (snakeHead.floorGlobalCol + ci) %
              GRID_TIME_HORIZONS_SEC.length;
            const sec = GRID_TIME_HORIZONS_SEC[idx] ?? 0;
            const label = formatHorizonLabel(sec);
            const firstPlay = canBetHere && ci === headFloor - 1;
            const lastPlay = canBetHere && ci === 0;
            return (
              <div
                key={`${snakeHead.floorGlobalCol}-${ci}`}
                style={{ width: cellW }}
                className={`grid-header-time shrink-0 flex flex-col items-center justify-center gap-0.5 border-l border-[#1e293b]/80 px-0.5 ${
                  isNow
                    ? "grid-header-time--now"
                    : isPast
                      ? "grid-header-time--past"
                      : reserved
                        ? "grid-header-time--off"
                        : "grid-header-time--play"
                } ${firstPlay ? "grid-header-time--play-end" : ""} ${
                  lastPlay ? "grid-header-time--play-start" : ""
                } ${spotlightCol === ci ? "grid-header-col-spotlight" : ""}`}
                title={
                  reserved
                    ? "No bets — past settlement window"
                    : isPast || isNow
                      ? `Locked — ${label}`
                      : `Tap cells below — hold to ${label}`
                }
              >
                {isNow && (
                  <span className="grid-header-time__pill">LIVE</span>
                )}
                <span className="grid-header-time__label font-mono tabular-nums">
                  {reserved ? "—" : label}
                </span>
              </div>
            );
          })}
        </motion.div>

        <div
          ref={rowsAreaRef}
          className="flex-1 flex flex-col min-h-0 relative grid-rows-parallax"
        >
          {rowData.map(({ signedRow, absRow, price }, ri) => {
            const isActive = ri === activeRowIdx;
            const isGap = ri === gridHalfHeight - 1;

            return (
              <div
                key={ri}
                className={`flex-1 flex items-stretch min-h-0 transition-colors duration-500 ease-out ${
                  isGap
                    ? "border-b border-[#ff3b8d]/10"
                    : "border-b border-[#141c2e]"
                } ${isActive ? "price-row-active" : ""}`}
              >
                <div
                  className={`w-[52px] shrink-0 flex items-center justify-end pr-2 transition-colors duration-500 ${
                    isActive ? "text-[#ff3b8d] font-semibold" : "text-zinc-600"
                  }`}
                >
                  <span className="text-[11px] font-mono tabular-nums">
                    {price.toFixed(2)}
                  </span>
                </div>

                {Array.from({ length: numCols }, (_, ci) => {
                  const isPast = ci > headFloor;
                  const isNow = ci === headFloor;
                  const reserved = ci > maxPlay;
                  const canBet = !reserved && ci < headFloor;

                  /** Distance from snake column so multipliers stay visible in past/now/future (not just "—"). */
                  const timeBucketsForLabel = Math.max(1, Math.abs(ci - headFloor));
                  const mult = calculateMultiplier(
                    absRow,
                    timeBucketsForLabel,
                    houseEdgeBps
                  );

                  const bet = cellBets.get(`${signedRow}:${ci}`);
                  const state = bet?.status;

                  const snakeKey = `${signedRow}:${ci}`;
                  const isHeadHere =
                    snakeHead.signedRow === signedRow && ci === headFloor;
                  const isBodyHere =
                    !isHeadHere && snakeBodyAtCell.has(snakeKey);
                  const isHitFlash = snakeKey === hitKey;
                  const isColumnSpotlight =
                    spotlightCol !== null && spotlightCol === ci;
                  const firstPlay = canBet && ci === headFloor - 1;
                  const lastPlay = canBet && ci === 0;

                  return (
                    <motion.button
                      key={ci}
                      type="button"
                      style={{ width: cellW }}
                      disabled={!canBet}
                      tabIndex={canBet ? 0 : -1}
                      aria-disabled={!canBet}
                      aria-label={
                        canBet
                          ? `Place bet, multiplier ${formatMult(mult)}`
                          : reserved
                            ? "Column closed"
                            : isNow
                              ? "LIVE column"
                              : isPast
                                ? "Past column"
                                : "Column"
                      }
                      whileHover={
                        canBet
                          ? { scale: 1.015, transition: { duration: 0.12 } }
                          : undefined
                      }
                      whileTap={canBet ? { scale: 0.97 } : undefined}
                      transition={{
                        type: "spring",
                        stiffness: 520,
                        damping: 28,
                      }}
                      onClick={(e) =>
                        handleClick(e, signedRow, ci, canBet)
                      }
                      className={`shrink-0 grid-cell flex items-center justify-center border-l border-[#1a2235] relative ${
                        canBet
                          ? "cell-playable cursor-pointer"
                          : "cell-locked cursor-not-allowed"
                      } ${isPast ? "cell-past" : ""} ${
                        isNow ? "cell-now" : ""
                      } ${reserved ? "cell-col-off" : ""} ${
                        isColumnSpotlight ? "cell-column-spotlight" : ""
                      } ${
                        ci <= maxPlay && !reserved
                          ? "cell-snake-zone"
                          : ""
                      } ${firstPlay ? "cell-play-band-end" : ""} ${
                        lastPlay ? "cell-play-band-start" : ""
                      } ${
                        state === "active"
                          ? "has-bet"
                          : state === "won"
                            ? "cell-won"
                            : state === "lost"
                              ? "cell-lost"
                              : ""
                      } ${isHitFlash ? "cell-bet-hit" : ""}`}
                    >
                      {isBodyHere && (
                        <span
                          className="pointer-events-none absolute inset-1.5 rounded-sm bg-[#3a1028]/90 border border-[#ff3b8d]/35 z-[1]"
                          aria-hidden
                        />
                      )}

                      <span className="dot dot-tl" />
                      <span className="dot dot-tr" />
                      <span className="dot dot-bl" />
                      <span className="dot dot-br" />

                      {bet ? (
                        <div className="bet-inline bet-compact relative z-[2]">
                          <div
                            className={`bet-amount ${
                              state === "lost"
                                ? "line-through opacity-70"
                                : ""
                            }`}
                          >
                            {state === "won"
                              ? formatPnl(bet.pnl)
                              : formatBetCompact(
                                  bet.amount,
                                  bet.multiplier
                                )}
                          </div>
                        </div>
                      ) : (
                        <span className="cell-label relative z-[2]">
                          {reserved ? "×" : formatMult(mult)}
                        </span>
                      )}
                    </motion.button>
                  );
                })}
              </div>
            );
          })}
        </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
