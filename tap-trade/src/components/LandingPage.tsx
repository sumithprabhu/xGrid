import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight, TrendingUp, Zap, Lock } from "lucide-react";
import { useLocation } from "wouter";
import { TOKENS } from "../lib/constants";
import { LandingGriddingPreview } from "./LandingGriddingPreview";
import { NavAuthControls } from "./NavAuthControls";

interface Props {
  onEnter: () => void;
}

// ── Ticker strip (horizontal marquee; thin variant for full-viewport hero) ───

function tickerChangePct(i: number) {
  const x = ((i * 7919 + 13) % 380) / 100 - 1.9;
  return Math.round(x * 100) / 100;
}

function TickerStrip({ thin = false }: { thin?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const items = useMemo(() => [...TOKENS, ...TOKENS, ...TOKENS], []);

  return (
    <div
      className={[
        "overflow-hidden shrink-0 border-[#ff3b8d]/10 relative",
        thin
          ? "border-t py-1.5 bg-[#060912]/90 backdrop-blur-sm"
          : "border-y py-2.5",
      ].join(" ")}
      aria-hidden
    >
      {/* edge fade */}
      <div
        className="pointer-events-none absolute inset-y-0 left-0 w-10 z-10"
        style={{
          background: "linear-gradient(90deg, #0a0e1a 0%, transparent)",
        }}
      />
      <div
        className="pointer-events-none absolute inset-y-0 right-0 w-10 z-10"
        style={{
          background: "linear-gradient(270deg, #0a0e1a 0%, transparent)",
        }}
      />

      <motion.div
        ref={ref}
        className={[
          "flex whitespace-nowrap w-max",
          thin ? "gap-8" : "gap-10",
        ].join(" ")}
        animate={{ x: ["0%", "-33.333%"] }}
        transition={{ duration: thin ? 28 : 22, repeat: Infinity, ease: "linear" }}
      >
        {items.map((t, i) => {
          const ch = tickerChangePct(i);
          const up = ch >= 0;
          return (
            <div
              key={`${t.symbol}-${i}`}
              className={[
                "flex items-center gap-2 shrink-0",
                thin ? "px-1" : "",
              ].join(" ")}
            >
              <span
                className={[
                  "font-mono text-[#ff3b8d] font-semibold tabular-nums",
                  thin ? "text-[11px]" : "text-[12px]",
                ].join(" ")}
              >
                {t.symbol}
              </span>
              <span
                className={[
                  "font-mono text-white/65 tabular-nums",
                  thin ? "text-[11px]" : "text-[12px]",
                ].join(" ")}
              >
                ${t.basePrice.toFixed(2)}
              </span>
              <span
                className={[
                  "font-mono tabular-nums",
                  thin ? "text-[10px]" : "text-[11px]",
                  up ? "text-emerald-400/85" : "text-rose-400/85",
                ].join(" ")}
              >
                {up ? "+" : ""}
                {ch.toFixed(2)}%
              </span>
              {!thin && (
                <span className="text-zinc-700 font-mono text-[11px]">·</span>
              )}
            </div>
          );
        })}
      </motion.div>
    </div>
  );
}

// ── Step card ─────────────────────────────────────────────────────────────────

function StepCard({
  n,
  icon,
  title,
  body,
  delay,
}: {
  n: string;
  icon: React.ReactNode;
  title: string;
  body: string;
  delay: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.5, delay }}
      className="relative rounded-2xl border border-[#ff3b8d]/12 p-6 overflow-hidden"
      style={{ background: "rgba(13,18,32,0.8)" }}
    >
      {/* top-left number */}
      <span
        className="absolute top-4 right-5 font-mono text-[46px] font-bold leading-none select-none"
        style={{ color: "rgba(255,59,141,0.07)" }}
      >
        {n}
      </span>

      <div className="flex items-center gap-3 mb-3">
        <div
          className="rounded-lg p-2"
          style={{ background: "rgba(255,59,141,0.1)", color: "#ff3b8d" }}
        >
          {icon}
        </div>
        <h3 className="font-semibold text-[17px] text-white">{title}</h3>
      </div>
      <p className="text-[14px] leading-relaxed text-zinc-400">{body}</p>
    </motion.div>
  );
}

// ── Token pill ────────────────────────────────────────────────────────────────

function TokenPill({ t, delay }: { t: (typeof TOKENS)[0]; delay: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      whileInView={{ opacity: 1, scale: 1 }}
      viewport={{ once: true }}
      transition={{ duration: 0.35, delay }}
      className="flex items-center gap-3 rounded-xl border border-[#ff3b8d]/12 px-4 py-3"
      style={{ background: "rgba(13,18,32,0.7)" }}
    >
      <div
        className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-mono font-bold"
        style={{
          background: "rgba(255,59,141,0.12)",
          color: "#ff3b8d",
          border: "1px solid rgba(255,59,141,0.2)",
        }}
      >
        {t.ticker.slice(0, 2)}
      </div>
      <div>
        <p className="text-[14px] font-semibold text-white">{t.symbol}</p>
        <p className="text-[12px] text-zinc-500">{t.name}</p>
      </div>
      <div className="ml-auto text-right">
        <p className="font-mono text-[13px] text-white/80 tabular-nums">
          ${t.basePrice.toFixed(2)}
        </p>
        <p className="font-mono text-[11px] text-emerald-400/80">LIVE</p>
      </div>
    </motion.div>
  );
}

// ── Main landing ──────────────────────────────────────────────────────────────

export function LandingPage({ onEnter }: Props) {
  const [mounted, setMounted] = useState(false);
  const [, navigate] = useLocation();

  const handleEnter = () => {
    onEnter();
    navigate("/gridding");
  };

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <AnimatePresence>
      {mounted && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, scale: 0.98 }}
          transition={{ duration: 0.4 }}
          className="min-h-screen w-full bg-[#0a0e1a] text-white overflow-x-hidden chart-dot-bg"
        >
          {/* First screen: nav + hero (copy + stats + grid) + ticker — page scrolls below */}
          <div className="min-h-dvh flex flex-col">
          {/* ── Nav ──────────────────────────────────────────────────────── */}
          <nav
            className="shrink-0 z-50 grid grid-cols-[1fr_auto] md:grid-cols-[1fr_auto_1fr] items-center gap-3 pl-5 pr-6 sm:pl-7 py-4 border-b border-[#ff3b8d]/10 backdrop-blur-sm"
            style={{ background: "rgba(10,14,26,0.85)" }}
          >
            <span className="font-logo text-[1.65rem] text-[#ff3b8d] drop-shadow-[0_0_18px_rgba(255,59,141,0.45)] ml-1 sm:ml-2 justify-self-start min-w-0">
              xGrid
            </span>

            {/* Center: pink links + vertical | separators (md+) */}
            <div
              className="hidden md:flex md:col-start-2 items-center justify-center gap-2 lg:gap-3 text-[13px] lg:text-[14px] font-semibold min-w-0 max-w-full font-mono"
              style={{ color: "#ff3b8d" }}
            >
              <button
                type="button"
                className="hover:opacity-80 transition-opacity cursor-pointer whitespace-nowrap shrink-0 font-sans font-semibold"
              >
                How it works?
              </button>
              <span
                className="text-[1.35rem] lg:text-[1.5rem] font-light leading-none px-0.5 select-none opacity-60 shrink-0"
                style={{ color: "#ff3b8d" }}
                aria-hidden
              >
                |
              </span>
              <button
                type="button"
                className="hover:opacity-80 transition-opacity cursor-pointer whitespace-nowrap shrink-0 font-sans font-semibold"
              >
                Markets
              </button>
              <span
                className="text-[1.35rem] lg:text-[1.5rem] font-light leading-none px-0.5 select-none opacity-60 shrink-0"
                style={{ color: "#ff3b8d" }}
                aria-hidden
              >
                |
              </span>
              <button
                type="button"
                className="hover:opacity-80 transition-opacity cursor-pointer whitespace-nowrap shrink-0 font-sans font-semibold"
              >
                Documentation
              </button>
            </div>

            <div className="col-start-2 md:col-start-3 flex items-center justify-self-end gap-2 sm:gap-3 min-w-0">
              <button
                onClick={handleEnter}
                className="flex items-center gap-2 rounded-full px-4 sm:px-5 py-2 text-[13px] sm:text-[14px] font-semibold transition-all hover:scale-105 active:scale-95 shrink-0"
                style={{
                  background: "rgba(255,59,141,0.12)",
                  border: "1.5px solid rgba(255,59,141,0.4)",
                  color: "#ff3b8d",
                  boxShadow: "0 0 20px rgba(255,59,141,0.1)",
                }}
              >
                Start Gridding
                <ArrowRight size={15} />
              </button>
              <NavAuthControls className="shrink-0" />
            </div>
          </nav>

          <div className="flex-1 min-h-0 flex flex-col">
          {/* ── Hero — content ~80% width; stats (5 stocks, multipliers…) + grid preview ── */}
          <section className="px-4 sm:px-6 py-6 sm:py-8 w-full flex-1 flex items-center justify-center min-h-0">
            <div className="w-[min(94%,80vw)] max-w-[1440px] mx-auto min-w-0">
            <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.22fr)] gap-8 lg:gap-10 items-center w-full">
              {/* left */}
              <div>
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.6 }}
                >
                  <div
                    className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-[12px] font-mono mb-5"
                    style={{
                      background: "rgba(255,59,141,0.08)",
                      border: "1px solid rgba(255,59,141,0.2)",
                      color: "#ff3b8d",
                    }}
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-[#ff3b8d] animate-pulse" />
                    Built on xGrid · Backed tokenized equities
                  </div>

                  <h1 className="text-[2.2rem] sm:text-[2.65rem] lg:text-[2.85rem] font-bold leading-[1.1] tracking-tight mb-4">
                    Predict the{" "}
                    <span
                      className="text-[#ff3b8d]"
                      style={{
                        textShadow: "0 0 32px rgba(255,59,141,0.5)",
                      }}
                    >
                      next move.
                    </span>
                    <br />
                    Win real{" "}
                    <span className="text-white/80">tokenized stocks.</span>
                  </h1>

                  <p className="text-[17px] text-zinc-400 leading-relaxed mb-8 max-w-md">
                    Touch-based prediction grid for xGrid equities. Place a
                    bet, watch the price snake move, win GridTokens — then
                    convert to real stocks via xChange.
                  </p>

                  <div className="flex flex-wrap gap-3">
                    <button
                      onClick={handleEnter}
                      className="flex items-center gap-2 rounded-full px-7 py-3 font-semibold text-[15px] transition-all hover:scale-105 active:scale-95"
                      style={{
                        background: "#ff3b8d",
                        color: "#fff",
                        boxShadow:
                          "0 0 32px rgba(255,59,141,0.35), 0 4px 20px rgba(0,0,0,0.4)",
                      }}
                    >
                      Start Gridding
                      <ArrowRight size={17} />
                    </button>

                    <button
                      type="button"
                      className="flex items-center gap-2 rounded-full px-7 py-3 font-semibold text-[15px] text-zinc-300 transition-all hover:text-white cursor-pointer"
                      style={{
                        border: "1.5px solid rgba(255,255,255,0.1)",
                        background: "rgba(255,255,255,0.03)",
                      }}
                    >
                      How to play?
                    </button>
                  </div>

                  {/* quick stats */}
                  <div className="flex gap-6 mt-8 pt-6 border-t border-white/5">
                    {[
                      { label: "Stocks", value: "5" },
                      { label: "Max multiplier", value: "31×" },
                      { label: "Bucket time", value: "30s" },
                    ].map(({ label, value }) => (
                      <div key={label}>
                        <p className="font-mono text-[24px] font-bold text-white">
                          {value}
                        </p>
                        <p className="text-[12px] text-zinc-500 mt-0.5">
                          {label}
                        </p>
                      </div>
                    ))}
                  </div>
                </motion.div>
              </div>

              {/* right — same live chart + arrow + grid as /gridding */}
              <motion.div
                initial={{ opacity: 0, x: 24 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.7, delay: 0.15 }}
                className="relative min-w-0"
              >
                <div
                  className="absolute inset-0 rounded-2xl blur-2xl -z-10 opacity-30 pointer-events-none"
                  style={{
                    background:
                      "radial-gradient(ellipse at 60% 40%, rgba(255,59,141,0.35), transparent 70%)",
                  }}
                />

                <LandingGriddingPreview />
              </motion.div>
            </div>
            </div>
          </section>
          </div>

          <div className="shrink-0 border-t border-[#ff3b8d]/10 bg-[#0a0e1a]/95">
            <TickerStrip thin />
          </div>
          </div>

          {/* ── How it works ─────────────────────────────────────────────── */}
          <section
            id="how-it-works"
            className="px-6 py-14 max-w-5xl mx-auto border-t border-[#ff3b8d]/8"
          >
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="text-center mb-10"
            >
              <p
                className="text-[12px] font-mono mb-2"
                style={{ color: "#ff3b8d" }}
              >
                HOW IT WORKS
              </p>
              <h2 className="text-[2.1rem] font-bold tracking-tight">
                Three steps. Real stocks.
              </h2>
            </motion.div>

            <div className="grid sm:grid-cols-3 gap-4">
              <StepCard
                n="01"
                icon={<Zap size={18} />}
                title="Deposit & Play"
                body="Deposit USDC to get GridTokens 1:1. Pick a stock, pick a direction (UP/DOWN), pick how far and how long. Each bet wins if price ever touches your target — TOUCH semantics."
                delay={0}
              />
              <StepCard
                n="02"
                icon={<TrendingUp size={18} />}
                title="Win GridTokens"
                body="Price snake moves live. Multipliers up to 31×. Win → claim GridTokens. Redeem anytime for USDC at 1:1 — or use your winnings to stake and play more."
                delay={0.1}
              />
              <StepCard
                n="03"
                icon={<Lock size={18} />}
                title="Stake for More"
                body="Convert USDC winnings to real xStock via xChange. Stake that stock in the vault — get 70% of its value as GridTokens. Keep playing with your portfolio as fuel."
                delay={0.2}
              />
            </div>
          </section>

          {/* ── Markets ──────────────────────────────────────────────────── */}
          <section
            id="markets"
            className="px-6 py-12 max-w-5xl mx-auto border-t border-[#ff3b8d]/8"
            style={{ background: "rgba(8,12,20,0.5)" }}
          >
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="text-center mb-8"
            >
              <p
                className="text-[12px] font-mono mb-2"
                style={{ color: "#ff3b8d" }}
              >
                MARKETS
              </p>
              <h2 className="text-[1.75rem] font-bold tracking-tight">
                Trade tokenized equities
              </h2>
            </motion.div>

            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {TOKENS.map((t, i) => (
                <TokenPill key={t.symbol} t={t} delay={i * 0.07} />
              ))}

              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true }}
                transition={{ delay: TOKENS.length * 0.07 }}
                className="flex items-center justify-center rounded-xl border border-dashed border-[#ff3b8d]/15 px-4 py-3"
                style={{ background: "rgba(255,59,141,0.02)" }}
              >
                <span className="text-[13px] text-zinc-600 font-mono">
                  + more stocks coming
                </span>
              </motion.div>
            </div>
          </section>

          {/* ── CTA ──────────────────────────────────────────────────────── */}
          <section className="px-6 py-20 max-w-5xl mx-auto text-center">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
            >
              <div
                className="inline-block rounded-3xl px-10 py-12 relative overflow-hidden"
                style={{
                  background: "rgba(13,18,32,0.9)",
                  border: "1px solid rgba(255,59,141,0.18)",
                  boxShadow:
                    "0 0 80px rgba(255,59,141,0.08), inset 0 0 40px rgba(255,59,141,0.03)",
                }}
              >
                {/* corner glow */}
                <div
                  className="absolute top-0 right-0 w-40 h-40 blur-3xl opacity-20 pointer-events-none"
                  style={{
                    background:
                      "radial-gradient(circle, rgba(255,59,141,0.8), transparent 70%)",
                  }}
                />

                <p className="font-mono text-[12px] text-[#ff3b8d] mb-3">
                  LIVE ON INK SEPOLIA
                </p>
                <h2 className="text-[2.2rem] font-bold tracking-tight mb-3">
                  Ready to make your move?
                </h2>
                <p className="text-zinc-400 text-[15px] mb-8 max-w-sm mx-auto">
                  No sign-up. Connect wallet, deposit USDC, start predicting.
                </p>

                <button
                  onClick={handleEnter}
                  className="flex items-center gap-2 mx-auto rounded-full px-8 py-3.5 font-semibold text-[17px] transition-all hover:scale-105 active:scale-95"
                  style={{
                    background: "#ff3b8d",
                    color: "#fff",
                    boxShadow: "0 0 40px rgba(255,59,141,0.4)",
                  }}
                >
                  Open the Grid
                  <ArrowRight size={18} />
                </button>
              </div>
            </motion.div>
          </section>

          {/* ── Footer ───────────────────────────────────────────────────── */}
          <footer className="border-t border-[#ff3b8d]/8 px-6 py-6 flex items-center justify-between max-w-5xl mx-auto">
            <span className="font-logo text-xl text-[#ff3b8d]/70">
              xGrid
            </span>
            <div className="flex items-center gap-5 text-[12px] font-mono text-zinc-600">
              <span>Grid · Vault · xChange</span>
              <span
                className="px-2 py-0.5 rounded"
                style={{ background: "rgba(255,59,141,0.07)", color: "#ff3b8d" }}
              >
                Testnet
              </span>
            </div>
          </footer>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
