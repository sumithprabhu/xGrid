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
    let timeoutId: ReturnType<typeof setTimeout>;

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

  /** Time → horizontal slide (treadmill); spring smooths frame-to-frame updates */
  const targetX = useMotionValue(0);
  const springX = useSpring(targetX, {
    stiffness: 140,
    damping: 26,
    mass: 0.55,
  });
  useEffect(() => {
    const m = Math.max(0.001, maxPlay);
    const pxPerPhase = 52;
    targetX.set(-(snakeHead.colFloat / m) * pxPerPhase);
  }, [snakeHead.colFloat, maxPlay, targetX]);

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
      <motion.div
        className="multiplier-grid-drift flex-1 flex flex-col min-w-[720px] will-change-transform"
        style={{ x: springX, y: springY }}
      >
        <motion.div
          key={snakeHead.floorGlobalCol}
          initial={{ opacity: 0.82, x: 6 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          className="flex h-7 shrink-0 border-b border-[#141c2e]/80"
        >
          <div className="w-[52px] shrink-0" />
          {Array.from({ length: numCols }, (_, ci) => {
            const isPast = ci < headFloor;
            const isNow = ci === headFloor;
            const reserved = ci > maxPlay;
            const idx =
              (snakeHead.floorGlobalCol + ci) %
              GRID_TIME_HORIZONS_SEC.length;
            const sec = GRID_TIME_HORIZONS_SEC[idx] ?? 0;
            const label = formatHorizonLabel(sec);
            return (
              <div
                key={`${snakeHead.floorGlobalCol}-${ci}`}
                style={{ width: cellW }}
                className={`shrink-0 flex items-center justify-center text-[11px] font-mono tabular-nums tracking-tight ${
                  isNow
                    ? "text-[#ff3b8d] font-semibold"
                    : isPast
                      ? "text-zinc-600"
                      : reserved
                        ? "text-zinc-600"
                        : "text-zinc-400"
                } ${isNow ? "bg-[#ff3b8d]/[0.08]" : ""} ${
                  spotlightCol === ci ? "grid-header-col-spotlight" : ""
                }`}
                title={`Target horizon ${label}`}
              >
                {reserved ? "—" : label}
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
                  const isPast = ci < headFloor;
                  const isNow = ci === headFloor;
                  const reserved = ci > maxPlay;
                  const canBet = !reserved && ci > headFloor;

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

                  return (
                    <motion.button
                      key={ci}
                      type="button"
                      style={{ width: cellW }}
                      disabled={!canBet}
                      whileTap={canBet ? { scale: 0.96 } : undefined}
                      transition={{
                        type: "spring",
                        stiffness: 520,
                        damping: 28,
                      }}
                      onClick={(e) =>
                        handleClick(e, signedRow, ci, canBet)
                      }
                      className={`shrink-0 grid-cell flex items-center justify-center border-l border-[#141c2e] relative cursor-pointer ${
                        !canBet ? "cursor-default" : ""
                      } ${isPast ? "cell-past" : ""} ${
                        isNow ? "cell-now" : ""
                      } ${
                        isColumnSpotlight ? "cell-column-spotlight" : ""
                      } ${
                        ci <= maxPlay && !reserved
                          ? "cell-snake-zone"
                          : ""
                      } ${reserved ? "cell-reserved" : ""} ${
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
      </motion.div>
    </div>
  );
}
