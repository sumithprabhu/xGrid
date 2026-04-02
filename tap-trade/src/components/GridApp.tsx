import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { TopBar } from "./TopBar";
import { PriceChart } from "./PriceChart";
import { MultiplierGrid } from "./MultiplierGrid";
import { BetDock } from "./BetDock";
import { BetToast, type ToastPayload } from "./BetToast";
import { usePriceEngine } from "../hooks/usePriceEngine";
import { useBets } from "../hooks/useBets";
import { useSnakeTrail } from "../hooks/useSnakeTrail";
import { TOKENS } from "../lib/constants";
import type { Bet, BetSize } from "../lib/types";
import { celebrateWin } from "../lib/celebrate";
import { formatBetCompact, formatPnl, formatUsd } from "../lib/format";

const ANCHOR_FRAC = 0.38; // head dot sits at 38 % from left

export function GridApp() {
  const [selectedToken, setSelectedToken] = useState(TOKENS[0]);
  const [betSize, setBetSize] = useState<BetSize>(10);
  const [toast, setToast] = useState<ToastPayload | null>(null);
  const betStatusRef = useRef<Map<string, string>>(new Map());

  const containerRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ w: 1200, h: 700 });

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const m = () => setDims({ w: el.clientWidth, h: el.clientHeight });
    m();
    const ro = new ResizeObserver(m);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { currentPrice, history } = usePriceEngine(selectedToken);
  const { head, trail } = useSnakeTrail(selectedToken, currentPrice);
  const { bets, balance, placeBet } = useBets(selectedToken, currentPrice, head, trail);

  const dismissToast = useCallback(() => setToast(null), []);

  useEffect(() => {
    betStatusRef.current = new Map();
  }, [selectedToken.symbol]);

  const onSnakeHitBet = useCallback((bet: Bet) => {
    setToast({
      id: `hit-${bet.id}-${Date.now()}`,
      kind: "hit",
      title: "HIT",
      subtitle: formatBetCompact(bet.amount, bet.multiplier),
    });
  }, []);

  useEffect(() => {
    for (const b of bets) {
      const prev = betStatusRef.current.get(b.id);
      if (prev === "active" && b.status === "won") {
        celebrateWin();
        setToast({ id: `win-${b.id}`, kind: "win", title: "WIN", subtitle: formatPnl(b.pnl) });
      } else if (prev === "active" && b.status === "lost") {
        setToast({ id: `lose-${b.id}`, kind: "lose", title: "LOSS", subtitle: `Stake ${formatUsd(b.amount)}` });
      }
      betStatusRef.current.set(b.id, b.status);
    }
  }, [bets]);

  const handleCellClick = useCallback(
    (row: number, globalCol: number) => placeBet(row, globalCol, betSize),
    [placeBet, betSize]
  );

  const anchorX = Math.floor(dims.w * ANCHOR_FRAC);
  const [dotY, setDotY] = useState(0);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4 }}
      className="h-screen w-screen bg-[#0a0e1a] flex flex-col overflow-hidden select-none"
    >
      <TopBar
        tokens={TOKENS}
        selectedToken={selectedToken}
        onSelectToken={setSelectedToken}
        currentPrice={currentPrice}
        balance={balance}
      />

      {/* Main area: all layers stacked */}
      <div ref={containerRef} className="flex-1 relative min-h-0">
        {/* LAYER 1: Grid (full area, bet tiles live here) */}
        <MultiplierGrid
          token={selectedToken}
          currentPrice={currentPrice}
          betSize={betSize}
          bets={bets}
          snakeHead={head}
          snakeTrail={trail}
          anchorX={anchorX}
          onCellClick={handleCellClick}
          onSnakeHitBet={onSnakeHitBet}
          onDotY={setDotY}
        />

        {/* LAYER 2: Price chart canvas overlay — uses dotY from grid for exact alignment */}
        <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 20 }}>
          <PriceChart
            history={history}
            currentPrice={currentPrice}
            token={selectedToken}
            width={dims.w}
            height={dims.h}
            anchorX={anchorX}
            dotY={dotY}
          />
        </div>

        {/* Head dot + cursor line are rendered INSIDE MultiplierGrid (z-50)
            so they share the exact same rowH / activeRowIdx coordinates. */}

        {/* Controls */}
        <BetDock betSize={betSize} onBetSizeChange={setBetSize} />
        <BetToast toast={toast} onDismiss={dismissToast} />
      </div>
    </motion.div>
  );
}
