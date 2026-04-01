import { useCallback, useRef, useState } from "react";
import { TopBar } from "./components/TopBar";
import { PriceChart, type ChartHandle } from "./components/PriceChart";
import { MultiplierGrid } from "./components/MultiplierGrid";
import { BucketTimer } from "./components/BucketTimer";
import { usePriceEngine } from "./hooks/usePriceEngine";
import { useBets } from "./hooks/useBets";
import { TOKENS } from "./lib/constants";
import type { BetSize } from "./lib/types";

export default function App() {
  const [selectedToken, setSelectedToken] = useState(TOKENS[0]);
  const [betSize, setBetSize] = useState<BetSize>(5);
  const chartRef = useRef<ChartHandle>(null);

  const { currentPrice, history, isLive } = usePriceEngine(selectedToken);
  const { bets, balance, totalPnl, placeBet } = useBets(
    selectedToken,
    currentPrice
  );

  const handleCellClick = useCallback(
    (row: number, col: number) => placeBet(row, col, betSize),
    [placeBet, betSize]
  );

  return (
    <div className="h-screen w-screen bg-black flex flex-col overflow-hidden select-none">
      <TopBar
        tokens={TOKENS}
        selectedToken={selectedToken}
        onSelectToken={setSelectedToken}
        currentPrice={currentPrice}
        isLive={isLive}
        balance={balance}
        betSize={betSize}
        onBetSizeChange={setBetSize}
        totalPnl={totalPnl}
      />

      <div className="flex-1 relative min-h-0">
        {/* Chart — full width, line extends through the grid */}
        <div className="absolute inset-0 z-0">
          <PriceChart
            ref={chartRef}
            history={history}
            currentPrice={currentPrice}
            tickSize={selectedToken.tickSize}
            gridHalfHeight={selectedToken.gridHalfHeight}
          />
        </div>

        {/* Grid — overlaid on right, transparent so line shows through */}
        <div className="absolute inset-y-0 right-0 w-[52%] z-10 grid-fade-left">
          <MultiplierGrid
            token={selectedToken}
            currentPrice={currentPrice}
            betSize={betSize}
            bets={bets}
            onCellClick={handleCellClick}
          />
        </div>

        <BucketTimer bucketSeconds={selectedToken.bucketSeconds} />
      </div>
    </div>
  );
}
