import { PriceChart } from "./PriceChart";
import { MultiplierGrid } from "./MultiplierGrid";
import type { Bet, BetSize, PricePoint, TokenConfig } from "../lib/types";
import type { SnakeSegment } from "../hooks/useSnakeTrail";

export interface ChartGridSplitProps {
  token: TokenConfig;
  currentPrice: number;
  history: PricePoint[];
  head: SnakeSegment;
  trail: SnakeSegment[];
  bets: Bet[];
  betSize: BetSize;
  onCellClick: (row: number, targetCol: number) => void;
  onSnakeHitBet?: (bet: Bet) => void;
}

/**
 * Chart left (~35%) + grid right (~65%). LIVE sweeps right → left; col 0 is the chart seam (“shore”).
 */
export function ChartGridSplit({
  token,
  currentPrice,
  history,
  head,
  trail,
  bets,
  betSize,
  onCellClick,
  onSnakeHitBet,
}: ChartGridSplitProps) {
  return (
    <div className="absolute inset-0 flex flex-row min-h-0">
      <div className="relative h-full w-[35%] shrink-0 min-w-0 overflow-visible">
        <div className="absolute inset-0 z-0 chart-dot-bg" />
        <div className="relative z-[3] h-full w-full min-h-0">
          <PriceChart
            history={history}
            currentPrice={currentPrice}
            tickSize={token.tickSize}
            gridHalfHeight={token.gridHalfHeight}
          />
        </div>
        <div
          className="chart-trail-fade pointer-events-none absolute inset-y-0 left-0 right-0 z-[2]"
          aria-hidden
        />
      </div>

      <div className="relative h-full w-[65%] shrink-0 min-w-0 z-10 grid-fade-left border-l border-[#ff3b8d]/[0.08] bg-[#080c14]/40 backdrop-blur-[2px]">
        <div className="relative h-full w-full min-h-0">
          <div
            className="grid-gradient-overlay absolute inset-0 z-0 rounded-sm"
            aria-hidden
          />
          <div className="relative z-10 h-full min-h-0">
            <MultiplierGrid
              token={token}
              currentPrice={currentPrice}
              betSize={betSize}
              bets={bets}
              snakeHead={head}
              snakeTrail={trail}
              onCellClick={onCellClick}
              onSnakeHitBet={onSnakeHitBet}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
