import { useState } from "react";
import { Link } from "wouter";
import { ArrowRight, ArrowRightLeft, ChevronRight } from "lucide-react";
import { NavAuthControls } from "./NavAuthControls";

const NEON = "#ff3b8d";

function formatUsd(n: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

function AssetRow({
  symbol,
  name,
  balance,
  usdValue,
}: {
  symbol: string;
  name: string;
  balance: string;
  usdValue: number;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4 py-4 border-b border-[#ff3b8d]/10 last:border-b-0">
      <div className="flex items-center gap-3 min-w-0 shrink-0 sm:max-w-[40%]">
        <div
          className="size-11 rounded-xl flex items-center justify-center text-xs font-mono font-bold shrink-0"
          style={{
            background: "rgba(255,59,141,0.12)",
            border: "1px solid rgba(255,59,141,0.25)",
            color: NEON,
          }}
        >
          {symbol.slice(0, 2)}
        </div>
        <div className="min-w-0">
          <p className="font-semibold text-white truncate">{name}</p>
          <p className="text-[13px] text-zinc-500 font-mono">{symbol}</p>
        </div>
      </div>

      <div className="flex-1 flex justify-center sm:justify-center min-w-0 px-1">
        <div className="text-center">
          <p className="font-mono text-[15px] text-white tabular-nums">{balance}</p>
          <p className="text-[12px] text-zinc-500 tabular-nums">{formatUsd(usdValue)}</p>
        </div>
      </div>

      <div className="shrink-0 sm:ml-auto flex justify-center sm:justify-end w-full sm:w-auto">
        <AssetRowTradeActions />
      </div>
    </div>
  );
}

/** Compact 3-segment control per asset row */
function AssetRowTradeActions() {
  return (
    <div
      className="relative flex rounded-xl overflow-hidden shrink-0 w-full min-[480px]:w-auto min-[480px]:min-w-[200px] max-w-[280px]"
      style={{
        background:
          "linear-gradient(165deg, rgba(42,48,68,0.95) 0%, rgba(18,22,34,1) 45%, rgba(12,14,22,1) 100%)",
        boxShadow:
          "0 8px 24px rgba(0,0,0,0.45), 0 2px 0 rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.1), inset 0 -2px 6px rgba(0,0,0,0.3)",
      }}
    >
      <div
        className="absolute inset-x-1.5 top-0.5 h-px rounded-full pointer-events-none opacity-35"
        style={{
          background:
            "linear-gradient(90deg, transparent, rgba(255,255,255,0.22), transparent)",
        }}
      />
      <button
        type="button"
        className="relative flex-1 py-2 px-1.5 min-[480px]:px-2 text-[11px] min-[480px]:text-[12px] font-semibold text-emerald-400 transition-colors hover:text-emerald-300 hover:bg-white/[0.04] active:bg-black/20"
        style={{
          boxShadow: "inset -1px 0 0 rgba(0,0,0,0.35)",
        }}
      >
        Buy
      </button>
      <button
        type="button"
        className="relative flex-1 py-2 px-1 min-[480px]:px-2 text-[11px] min-[480px]:text-[12px] font-semibold text-rose-400 transition-colors hover:text-rose-300 hover:bg-white/[0.04] active:bg-black/20"
        style={{
          boxShadow:
            "inset -1px 0 0 rgba(0,0,0,0.35), inset 1px 0 0 rgba(255,255,255,0.03)",
        }}
      >
        Sell
      </button>
      <button
        type="button"
        className="relative flex-1 py-2 px-1.5 min-[480px]:px-2 text-[11px] min-[480px]:text-[12px] font-semibold transition-colors active:bg-black/20"
        style={{
          color: NEON,
          textShadow: "0 0 16px rgba(255,59,141,0.3)",
          boxShadow: "inset 1px 0 0 rgba(0,0,0,0.12)",
        }}
      >
        Grid it
      </button>
    </div>
  );
}

type ChainId = "ink" | "ethereum";

function SwapCard() {
  const [chain, setChain] = useState<ChainId>("ink");
  const [fromAmount, setFromAmount] = useState("");
  const [toAmount, setToAmount] = useState("");

  return (
    <div
      className="rounded-2xl border border-[#ff3b8d]/15 overflow-hidden"
      style={{
        background:
          "linear-gradient(160deg, rgba(20,24,38,0.95) 0%, rgba(10,14,26,0.98) 100%)",
        boxShadow:
          "0 16px 48px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.06)",
      }}
    >
      <div className="px-4 pt-4 pb-3 flex items-center justify-between border-b border-[#ff3b8d]/10">
        <span className="text-[13px] font-semibold text-white">Swap</span>
        <div
          className="flex rounded-xl p-0.5 gap-0.5"
          style={{ background: "rgba(0,0,0,0.35)" }}
        >
          {(["ink", "ethereum"] as const).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setChain(c)}
              className={[
                "px-3 py-1.5 rounded-lg text-[11px] font-mono font-semibold uppercase tracking-wide transition-all",
                chain === c
                  ? "text-white shadow-md"
                  : "text-zinc-500 hover:text-zinc-300",
              ].join(" ")}
              style={
                chain === c
                  ? {
                      background: "rgba(255,59,141,0.2)",
                      boxShadow:
                        "inset 0 1px 0 rgba(255,255,255,0.12), 0 2px 8px rgba(255,59,141,0.15)",
                      color: NEON,
                    }
                  : undefined
              }
            >
              {c === "ink" ? "Ink" : "ETH"}
            </button>
          ))}
        </div>
      </div>

      <div className="p-4 space-y-3">
        <div
          className="rounded-xl px-3 py-3 border border-white/5"
          style={{ background: "rgba(0,0,0,0.25)" }}
        >
          <div className="flex justify-between text-[11px] text-zinc-500 font-mono mb-1.5">
            <span>From</span>
            <span>Balance 3,420.50</span>
          </div>
          <div className="flex items-center gap-2">
            <input
              value={fromAmount}
              onChange={(e) => setFromAmount(e.target.value)}
              placeholder="0.0"
              className="flex-1 min-w-0 bg-transparent text-xl font-mono text-white outline-none placeholder:text-zinc-600"
            />
            <span className="text-[13px] font-semibold text-[#ff3b8d] shrink-0">
              gUSD
            </span>
          </div>
        </div>

        <div className="flex justify-center -my-1 relative z-10">
          <div
            className="size-9 rounded-xl flex items-center justify-center border border-[#ff3b8d]/25"
            style={{
              background: "rgba(255,59,141,0.1)",
              boxShadow: "0 4px 12px rgba(0,0,0,0.35)",
            }}
          >
            <ArrowRightLeft className="size-4 text-[#ff3b8d]" />
          </div>
        </div>

        <div
          className="rounded-xl px-3 py-3 border border-white/5"
          style={{ background: "rgba(0,0,0,0.25)" }}
        >
          <div className="flex justify-between text-[11px] text-zinc-500 font-mono mb-1.5">
            <span>To</span>
            <span>Est. receive</span>
          </div>
          <div className="flex items-center gap-2">
            <input
              value={toAmount}
              onChange={(e) => setToAmount(e.target.value)}
              placeholder="0.0"
              className="flex-1 min-w-0 bg-transparent text-xl font-mono text-white outline-none placeholder:text-zinc-600"
            />
            <span className="text-[13px] font-semibold text-zinc-300 shrink-0">
              AAPLx
            </span>
          </div>
        </div>

        <button
          type="button"
          className="w-full py-3.5 rounded-xl font-bold text-[15px] text-white transition-transform active:scale-[0.98]"
          style={{
            background: `linear-gradient(180deg, ${NEON} 0%, #c42d6f 100%)`,
            boxShadow:
              "0 6px 20px rgba(255,59,141,0.35), inset 0 1px 0 rgba(255,255,255,0.25), inset 0 -2px 0 rgba(0,0,0,0.2)",
          }}
        >
          Swap
        </button>
      </div>
    </div>
  );
}

export function PortfolioPage() {
  const portfolioUsd = 24891.32;
  const gusdBalance = 3420.5;

  return (
    <div className="min-h-screen w-full bg-[#0a0e1a] text-white chart-dot-bg">
      <header
        className="sticky top-0 z-20 flex items-center justify-between pl-5 pr-6 sm:pl-7 py-4 border-b border-[#ff3b8d]/10 backdrop-blur-md"
        style={{ background: "rgba(10,14,26,0.88)" }}
      >
        <Link href="/">
          <span className="font-logo text-[1.65rem] text-[#ff3b8d] drop-shadow-[0_0_18px_rgba(255,59,141,0.45)] ml-1 sm:ml-2 cursor-pointer hover:opacity-90 inline-block">
            xGrid
          </span>
        </Link>
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          <Link href="/gridding">
            <span
              className="flex items-center gap-2 rounded-full px-4 sm:px-5 py-2 text-[13px] sm:text-[14px] font-semibold transition-all hover:scale-105 active:scale-95 cursor-pointer"
              style={{
                background: "rgba(255,59,141,0.12)",
                border: "1.5px solid rgba(255,59,141,0.4)",
                color: "#ff3b8d",
                boxShadow: "0 0 20px rgba(255,59,141,0.1)",
              }}
            >
              Start Gridding
              <ArrowRight size={15} />
            </span>
          </Link>
          <NavAuthControls />
        </div>
      </header>

      <main className="w-[75vw] max-w-[min(75vw,100%)] mx-auto px-3 sm:px-5 py-8 sm:py-10 box-border">
        <div className="grid grid-cols-1 lg:grid-cols-[7fr_3fr] gap-5 lg:gap-6 items-stretch">
          {/* ——— Column A: Portfolio + Assets (one panel) ——— */}
          <section
            className="rounded-2xl border overflow-hidden flex flex-col min-h-0"
            style={{
              borderColor: "rgba(100,116,180,0.28)",
              background:
                "linear-gradient(165deg, rgba(22,28,48,0.92) 0%, rgba(10,14,24,0.98) 55%, rgba(8,10,18,1) 100%)",
              boxShadow:
                "0 0 0 1px rgba(0,0,0,0.4), 0 24px 60px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.06)",
            }}
          >
            <div className="px-5 sm:px-6 pt-5 sm:pt-6 pb-5 border-b border-white/[0.06]">
              <p className="text-[11px] font-mono uppercase tracking-widest text-zinc-500 mb-2">
                Portfolio
              </p>
              <p className="text-[2rem] sm:text-[2.35rem] font-bold tabular-nums tracking-tight text-white">
                {formatUsd(portfolioUsd)}
              </p>
              <p className="text-[12px] text-zinc-500 mt-2">
                Total value in USD
              </p>
            </div>

            <div className="px-5 sm:px-6 pt-5 pb-5 sm:pb-6 flex-1 flex flex-col">
              <h2 className="text-base font-bold text-white mb-0.5">Assets</h2>
              <p className="text-[12px] text-zinc-500 mb-4">
                Tokenized equities and stablecoins
              </p>

              <div
                className="rounded-xl border px-3 sm:px-4 pt-3 sm:pt-4 pb-1 flex-1"
                style={{
                  borderColor: "rgba(100,116,180,0.2)",
                  background: "rgba(0,0,0,0.22)",
                }}
              >
                <AssetRow
                  symbol="AAPLx"
                  name="xApple"
                  balance="12.40"
                  usdValue={3162.0}
                />
                <AssetRow
                  symbol="USDC"
                  name="USD Coin"
                  balance="18,420.12"
                  usdValue={18420.12}
                />
              </div>
            </div>
          </section>

          {/* ——— Column B: gUSD + Swap (one panel) ——— */}
          <section
            className="rounded-2xl border overflow-hidden flex flex-col min-h-0 lg:sticky lg:top-24 lg:self-start"
            style={{
              borderColor: "rgba(255,59,141,0.35)",
              background:
                "linear-gradient(165deg, rgba(32,18,36,0.95) 0%, rgba(14,10,22,0.98) 50%, rgba(10,8,16,1) 100%)",
              boxShadow:
                "0 0 0 1px rgba(255,59,141,0.08), 0 24px 60px rgba(0,0,0,0.5), 0 0 80px -20px rgba(255,59,141,0.15), inset 0 1px 0 rgba(255,255,255,0.05)",
            }}
          >
            <div className="px-5 sm:px-6 pt-5 sm:pt-6 pb-5 border-b border-[#ff3b8d]/15">
              <p className="text-[11px] font-mono uppercase tracking-widest text-zinc-500 mb-2">
                gUSD balance
              </p>
              <p
                className="text-[2rem] sm:text-[2.35rem] font-bold tabular-nums tracking-tight"
                style={{ color: NEON, textShadow: "0 0 40px rgba(255,59,141,0.25)" }}
              >
                {gusdBalance.toLocaleString("en-US", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </p>
              <p className="text-[12px] text-zinc-500 mt-2">
                Grid stable · use below to swap
              </p>
            </div>

            <div className="px-4 sm:px-5 pt-4 pb-5 sm:pb-6 flex-1 flex flex-col">
              <div className="flex items-center gap-2 mb-3 text-zinc-500">
                <ChevronRight className="size-4" />
                <span className="text-[11px] font-mono uppercase tracking-widest">
                  Exchange
                </span>
              </div>
              <div className="flex-1 min-h-0">
                <SwapCard />
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
