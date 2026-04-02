import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { useAccount } from "wagmi";
import { TopBar } from "./TopBar";
import { PriceChart } from "./PriceChart";
import { MultiplierGrid } from "./MultiplierGrid";
import { BetDock } from "./BetDock";
import { BetToast, type ToastPayload } from "./BetToast";
import { TxToast } from "./TxToast";
import { usePriceEngine } from "../hooks/usePriceEngine";
import { useBets } from "../hooks/useBets";
import { useSnakeTrail } from "../hooks/useSnakeTrail";
import { useGdUsdBalance } from "../hooks/useGdUsdBalance";
import { useOnChainBets } from "../hooks/useOnChainBets";
import { useGridMatrix } from "../hooks/useGridMatrix";
import { TOKENS, MIN_BET_STEPS_AHEAD, SNAKE_COLUMN_HIT_LAG } from "../lib/constants";
import type { Bet, BetSize } from "../lib/types";
import { celebrateWin } from "../lib/celebrate";
import { formatBetCompact, formatUsd } from "../lib/format";

const ANCHOR_FRAC = 0.38;

export function GridApp() {
  const [selectedToken, setSelectedToken] = useState(TOKENS[0]);
  const [betSize, setBetSize] = useState<BetSize>(10);
  const [toast, setToast] = useState<ToastPayload | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
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

  // ── On-chain data ─────────────────────────────────────────────────────────
  const { address } = useAccount();
  const { formatted: gdUsdBalance, refetch: refetchBalance } = useGdUsdBalance(address);
  const onTxSent = useCallback((h: string) => setTxHash(h), []);
  const { placeBetOnChain, ensureApproval } = useOnChainBets(address, refetchBalance, onTxSent);
  const { matrix: contractMatrix } = useGridMatrix(selectedToken.contractAddress);

  // Pre-warm approval as soon as the user lands on the grid
  useEffect(() => {
    if (address) void ensureApproval();
  }, [address, ensureApproval]);

  // ── Local game loop ───────────────────────────────────────────────────────
  const { currentPrice, history } = usePriceEngine(selectedToken);
  const { head, trail } = useSnakeTrail(selectedToken, currentPrice);
  const { bets, balance: localBalance, placeBet } = useBets(
    selectedToken,
    currentPrice,
    head,
    trail,
    gdUsdBalance,
    contractMatrix,
  );

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
    let totalWon = 0;
    let totalLost = 0;
    let wonCount = 0;
    let lostCount = 0;

    for (const b of bets) {
      const prev = betStatusRef.current.get(b.id);
      if (prev === "active" && b.status === "won") {
        totalWon += b.amount * b.multiplier;
        wonCount++;
      } else if (prev === "active" && b.status === "lost") {
        totalLost += b.amount;
        lostCount++;
      }
      betStatusRef.current.set(b.id, b.status);
    }

    if (wonCount > 0) {
      celebrateWin();
      setToast({ id: `win-${Date.now()}`, kind: "win", title: "WIN", subtitle: `+${formatUsd(totalWon)}` });
    } else if (lostCount > 0) {
      setToast({
        id: `lose-${Date.now()}`,
        kind: "lose",
        title: "LOSS",
        subtitle: `-${formatUsd(totalLost)}${lostCount > 1 ? ` (${lostCount} bets)` : ""}`,
      });
    }
  }, [bets]);

  // Keep refs so handleCellClick closures never go stale
  const headRef = useRef(head);
  headRef.current = head;
  const contractMatrixRef = useRef(contractMatrix);
  contractMatrixRef.current = contractMatrix;
  const balanceRef = useRef(localBalance);
  balanceRef.current = localBalance;

  const handleCellClick = useCallback(
    (row: number, globalCol: number) => {
      // Use the same lag-adjusted head that MultiplierGrid uses for canBet checks
      const h = headRef.current;
      const visualHead = Math.floor(Math.max(0, h.globalPhase - SNAKE_COLUMN_HIT_LAG));
      const stepsAhead = globalCol - visualHead;
      if (stepsAhead < MIN_BET_STEPS_AHEAD) return;

      // Don't fire on-chain if user can't afford the bet
      if (betSize > balanceRef.current) return;

      const timeBuckets = Math.max(1, Math.min(8, stepsAhead));
      console.log("[grid] cell clicked:", { row, globalCol, stepsAhead, timeBuckets, betSize, balance: balanceRef.current });

      // Place locally for instant UX feedback
      placeBet(row, globalCol, betSize);

      // Place on-chain silently — no popup, fires in background
      placeBetOnChain(
        selectedToken.contractAddress,
        row,         // priceTicks = signed row offset
        timeBuckets,
        betSize,
      );
    },
    [placeBet, placeBetOnChain, betSize, selectedToken.contractAddress]
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
        balance={localBalance}
      />

      <div ref={containerRef} className="flex-1 relative min-h-0">
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
          contractMatrix={contractMatrix}
        />

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

        <BetDock betSize={betSize} onBetSizeChange={setBetSize} />
        <BetToast toast={toast} onDismiss={dismissToast} />
        <TxToast hash={txHash} />
      </div>
    </motion.div>
  );
}
