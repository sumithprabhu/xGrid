import { useState } from "react";
import { Link } from "wouter";
import { useAccount } from "wagmi";
import { parseUnits, type Address } from "viem";
import { useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import {
  ArrowRight,
  ArrowRightLeft,
  ChevronRight,
  Copy,
  Check,
  Loader2,
  Zap,
} from "lucide-react";
import { NavAuthControls } from "./NavAuthControls";
import { usePortfolio, type AssetBalance } from "../hooks/usePortfolio";
import { CONTRACTS, ERC20_ABI, VAULT_ABI, GRID_ABI } from "../lib/contracts";

const NEON = "#ff3b8d";

function fmt(n: number, decimals = 2) {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(n);
}
function fmtUsd(n: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

// ── Copy address ──────────────────────────────────────────────────────────────

function CopyAddress({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(address).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };
  return (
    <button onClick={copy} className="flex items-center gap-2 text-left group" title="Copy address">
      <span className="font-mono text-[11px] text-zinc-400 break-all group-hover:text-zinc-200 transition-colors">
        {address.slice(0, 10)}…{address.slice(-8)}
      </span>
      {copied
        ? <Check size={12} className="text-emerald-400 shrink-0" />
        : <Copy size={12} className="text-zinc-600 group-hover:text-zinc-400 shrink-0 transition-colors" />
      }
    </button>
  );
}

// ── Grid it modal ─────────────────────────────────────────────────────────────

type TxStep = "idle" | "approving" | "staking" | "depositing" | "done" | "error";

function GridItModal({ asset, onClose, onSuccess }: {
  asset: AssetBalance;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [step, setStep] = useState<TxStep>("idle");
  const [errMsg, setErrMsg] = useState("");
  const [hash, setHash] = useState<`0x${string}` | undefined>();
  const { writeContractAsync } = useWriteContract();

  const { isSuccess } = useWaitForTransactionReceipt({
    hash,
    query: { enabled: !!hash && step === "staking" },
  });
  if (isSuccess && step === "staking") { setStep("done"); onSuccess(); }

  const isUsdc = asset.address === CONTRACTS.USDC;
  const parsedAmount = parseFloat(amount) || 0;
  const gdUsdPreview = isUsdc ? parsedAmount : parsedAmount * asset.priceUsd * 0.7;
  const busy = step === "approving" || step === "staking" || step === "depositing";

  const submit = async () => {
    if (!parsedAmount) return;
    setErrMsg("");
    try {
      if (isUsdc) {
        const amountWei = parseUnits(amount, 6);
        setStep("approving");
        await writeContractAsync({ address: CONTRACTS.USDC, abi: ERC20_ABI, functionName: "approve", args: [CONTRACTS.xStocksGrid, amountWei] });
        setStep("depositing");
        await writeContractAsync({ address: CONTRACTS.xStocksGrid, abi: GRID_ABI, functionName: "depositUsdc", args: [CONTRACTS.wQQQx, amountWei] });
        setStep("done"); onSuccess();
      } else {
        const amountWei = parseUnits(amount, asset.decimals);
        setStep("approving");
        await writeContractAsync({ address: asset.address as Address, abi: ERC20_ABI, functionName: "approve", args: [CONTRACTS.xStockVault, amountWei] });
        setStep("staking");
        const tx = await writeContractAsync({ address: CONTRACTS.xStockVault, abi: VAULT_ABI, functionName: "stake", args: [asset.address as Address, amountWei] });
        setHash(tx);
      }
    } catch (e: unknown) {
      setStep("error");
      const msg = e instanceof Error ? e.message : String(e);
      setErrMsg(msg.includes("User rejected") ? "Transaction rejected" : msg.slice(0, 120));
    }
  };

  const stepLabel: Record<TxStep, string> = {
    idle: `Stake → get ~${fmt(gdUsdPreview, 2)} gdUSD`,
    approving: "Approving…",
    staking: "Staking…",
    depositing: "Depositing…",
    done: "Done!",
    error: "Failed — try again",
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(4px)" }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="w-full max-w-sm rounded-2xl border overflow-hidden"
        style={{
          background: "linear-gradient(165deg, rgba(20,24,38,0.98) 0%, rgba(10,14,26,1) 100%)",
          borderColor: "rgba(255,59,141,0.3)",
          boxShadow: "0 24px 60px rgba(0,0,0,0.6), 0 0 80px -20px rgba(255,59,141,0.2)",
        }}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#ff3b8d]/15">
          <div className="flex items-center gap-2">
            <Zap size={15} style={{ color: NEON }} />
            <span className="font-semibold text-white text-[15px]">Grid it — {asset.symbol}</span>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-white text-lg leading-none">×</button>
        </div>

        <div className="p-5 space-y-4">
          <div className="text-[12px] text-zinc-500 font-mono flex justify-between">
            <span>Available</span>
            <span className="text-zinc-300">{fmt(asset.formatted, 4)} {asset.symbol}</span>
          </div>

          <div className="rounded-xl px-4 py-3 border border-white/[0.08] flex items-center gap-3" style={{ background: "rgba(0,0,0,0.3)" }}>
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
              placeholder="0.00"
              disabled={busy || step === "done"}
              className="flex-1 bg-transparent text-xl font-mono text-white outline-none placeholder:text-zinc-600"
            />
            <button
              onClick={() => setAmount(String(asset.formatted))}
              className="text-[11px] font-mono px-2 py-0.5 rounded"
              style={{ background: "rgba(255,59,141,0.15)", color: NEON }}
            >MAX</button>
            <span className="text-[13px] font-semibold text-zinc-400 shrink-0">{asset.symbol}</span>
          </div>

          {parsedAmount > 0 && (
            <div className="rounded-xl px-4 py-3 border border-[#ff3b8d]/15 flex justify-between items-center" style={{ background: "rgba(255,59,141,0.05)" }}>
              <span className="text-[12px] text-zinc-400">{isUsdc ? "You get (1:1)" : "You get (70% LTV)"}</span>
              <span className="font-mono font-bold text-[15px]" style={{ color: NEON }}>
                {fmt(gdUsdPreview, 2)} gdUSD
              </span>
            </div>
          )}

          {step === "error" && <p className="text-[12px] text-rose-400 font-mono break-words">{errMsg}</p>}

          {step === "done" ? (
            <button
              onClick={onClose}
              className="w-full py-3.5 rounded-xl font-bold text-[15px] text-white"
              style={{ background: "rgba(16,185,129,0.25)", border: "1px solid rgba(52,211,153,0.4)" }}
            >✓ Done — gdUSD minted</button>
          ) : (
            <button
              onClick={submit}
              disabled={!parsedAmount || busy}
              className="w-full py-3.5 rounded-xl font-bold text-[15px] text-white flex items-center justify-center gap-2 disabled:opacity-50 transition-opacity"
              style={{ background: `linear-gradient(180deg, ${NEON} 0%, #c42d6f 100%)`, boxShadow: "0 6px 20px rgba(255,59,141,0.35)" }}
            >
              {busy && <Loader2 size={16} className="animate-spin" />}
              {stepLabel[step]}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Asset row ─────────────────────────────────────────────────────────────────

function AssetRow({ asset, onGridIt }: { asset: AssetBalance; onGridIt: (a: AssetBalance) => void }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4 py-4 border-b border-[#ff3b8d]/10 last:border-b-0">
      <div className="flex items-center gap-3 min-w-0 shrink-0 sm:max-w-[40%]">
        <div
          className="size-11 rounded-xl flex items-center justify-center text-xs font-mono font-bold shrink-0"
          style={{ background: "rgba(255,59,141,0.12)", border: "1px solid rgba(255,59,141,0.25)", color: NEON }}
        >
          {asset.symbol.slice(0, 2).toUpperCase()}
        </div>
        <div className="min-w-0">
          <p className="font-semibold text-white truncate">{asset.name}</p>
          <p className="text-[13px] text-zinc-500 font-mono">{asset.symbol}</p>
        </div>
      </div>

      <div className="flex-1 flex justify-center min-w-0 px-1">
        {asset.formatted > 0 ? (
          <div className="text-center">
            <p className="font-mono text-[15px] text-white tabular-nums">
              {fmt(asset.formatted, asset.decimals === 6 ? 2 : 4)}
            </p>
            <p className="text-[12px] text-zinc-500 tabular-nums">{fmtUsd(asset.usdValue)}</p>
          </div>
        ) : (
          <p className="text-[13px] text-zinc-600 font-mono">—</p>
        )}
      </div>

      <div className="shrink-0 sm:ml-auto flex justify-center sm:justify-end w-full sm:w-auto">
        <div
          className="relative flex rounded-xl overflow-hidden shrink-0 w-full min-[480px]:w-auto min-[480px]:min-w-[200px] max-w-[280px]"
          style={{
            background: "linear-gradient(165deg, rgba(42,48,68,0.95) 0%, rgba(18,22,34,1) 45%, rgba(12,14,22,1) 100%)",
            boxShadow: "0 8px 24px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.1)",
          }}
        >
          <div className="absolute inset-x-1.5 top-0.5 h-px rounded-full pointer-events-none opacity-35" style={{ background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.22), transparent)" }} />
          <a href="https://app.uniswap.org" target="_blank" rel="noreferrer"
            className="relative flex-1 py-2 px-2 text-[12px] font-semibold text-emerald-400 hover:text-emerald-300 hover:bg-white/[0.04] text-center"
            style={{ boxShadow: "inset -1px 0 0 rgba(0,0,0,0.35)" }}>Buy</a>
          <a href="https://app.uniswap.org" target="_blank" rel="noreferrer"
            className="relative flex-1 py-2 px-2 text-[12px] font-semibold text-rose-400 hover:text-rose-300 hover:bg-white/[0.04] text-center"
            style={{ boxShadow: "inset -1px 0 0 rgba(0,0,0,0.35), inset 1px 0 0 rgba(255,255,255,0.03)" }}>Sell</a>
          <button
            type="button"
            disabled={asset.formatted === 0}
            onClick={() => onGridIt(asset)}
            className="relative flex-1 py-2 px-2 text-[12px] font-semibold hover:bg-white/[0.04] disabled:opacity-30 disabled:cursor-not-allowed"
            style={{ color: NEON, textShadow: "0 0 16px rgba(255,59,141,0.3)", boxShadow: "inset 1px 0 0 rgba(0,0,0,0.12)" }}
          >Grid it</button>
        </div>
      </div>
    </div>
  );
}

// ── Redeem gdUSD → USDC ───────────────────────────────────────────────────────

function RedeemCard({ gdUsdBalance, onSuccess }: { gdUsdBalance: number; onSuccess: () => void }) {
  const [fromAmount, setFromAmount] = useState("");
  const [step, setStep] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [errMsg, setErrMsg] = useState("");
  const { writeContractAsync } = useWriteContract();
  const parsedAmount = parseFloat(fromAmount) || 0;

  const redeem = async () => {
    if (!parsedAmount) return;
    setErrMsg(""); setStep("busy");
    try {
      const amountWei = parseUnits(fromAmount, 18);
      await writeContractAsync({
        address: CONTRACTS.xStocksGrid,
        abi: GRID_ABI,
        functionName: "redeemForUsdc",
        args: [CONTRACTS.wQQQx, amountWei],
      });
      setStep("done"); setFromAmount(""); onSuccess();
    } catch (e: unknown) {
      setStep("error");
      const msg = e instanceof Error ? e.message : String(e);
      setErrMsg(msg.includes("User rejected") ? "Rejected" : msg.slice(0, 100));
    }
  };

  return (
    <div
      className="rounded-2xl border border-[#ff3b8d]/15 overflow-hidden"
      style={{
        background: "linear-gradient(160deg, rgba(20,24,38,0.95) 0%, rgba(10,14,26,0.98) 100%)",
        boxShadow: "0 16px 48px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.06)",
      }}
    >
      <div className="px-4 pt-4 pb-3 border-b border-[#ff3b8d]/10">
        <span className="text-[13px] font-semibold text-white">Redeem gdUSD → USDC</span>
      </div>
      <div className="p-4 space-y-3">
        <div className="rounded-xl px-3 py-3 border border-white/5" style={{ background: "rgba(0,0,0,0.25)" }}>
          <div className="flex justify-between text-[11px] text-zinc-500 font-mono mb-1.5">
            <span>From</span>
            <button className="hover:text-zinc-300 transition-colors" onClick={() => setFromAmount(fmt(gdUsdBalance, 2).replace(/,/g, ""))}>
              Balance {fmt(gdUsdBalance, 2)}
            </button>
          </div>
          <div className="flex items-center gap-2">
            <input
              value={fromAmount}
              onChange={(e) => setFromAmount(e.target.value.replace(/[^0-9.]/g, ""))}
              placeholder="0.0"
              disabled={step === "busy"}
              className="flex-1 min-w-0 bg-transparent text-xl font-mono text-white outline-none placeholder:text-zinc-600"
            />
            <span className="text-[13px] font-semibold shrink-0" style={{ color: NEON }}>gdUSD</span>
          </div>
        </div>

        <div className="flex justify-center">
          <div className="size-9 rounded-xl flex items-center justify-center border border-[#ff3b8d]/25" style={{ background: "rgba(255,59,141,0.1)" }}>
            <ArrowRightLeft className="size-4 text-[#ff3b8d]" />
          </div>
        </div>

        <div className="rounded-xl px-3 py-3 border border-white/5" style={{ background: "rgba(0,0,0,0.25)" }}>
          <div className="flex justify-between text-[11px] text-zinc-500 font-mono mb-1.5">
            <span>You receive</span><span>1:1</span>
          </div>
          <div className="flex items-center gap-2">
            <input value={parsedAmount > 0 ? fmt(parsedAmount, 2) : ""} readOnly placeholder="0.0"
              className="flex-1 min-w-0 bg-transparent text-xl font-mono text-zinc-300 outline-none placeholder:text-zinc-600" />
            <span className="text-[13px] font-semibold text-zinc-300 shrink-0">USDC</span>
          </div>
        </div>

        {step === "error" && <p className="text-[12px] text-rose-400 font-mono">{errMsg}</p>}

        <button
          type="button"
          onClick={redeem}
          disabled={!parsedAmount || step === "busy"}
          className="w-full py-3.5 rounded-xl font-bold text-[15px] text-white transition-transform active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-2"
          style={{ background: `linear-gradient(180deg, ${NEON} 0%, #c42d6f 100%)`, boxShadow: "0 6px 20px rgba(255,59,141,0.35), inset 0 1px 0 rgba(255,255,255,0.25)" }}
        >
          {step === "busy" && <Loader2 size={16} className="animate-spin" />}
          {step === "done" ? "✓ Redeemed" : "Redeem"}
        </button>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function PortfolioPage() {
  const { address } = useAccount();
  const { assets, gdUsd, totalGdUsd, totalUsd, isLoading, refetch } = usePortfolio(address);
  const [gridItAsset, setGridItAsset] = useState<AssetBalance | null>(null);

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
              style={{ background: "rgba(255,59,141,0.12)", border: "1.5px solid rgba(255,59,141,0.4)", color: "#ff3b8d", boxShadow: "0 0 20px rgba(255,59,141,0.1)" }}
            >
              Start Gridding <ArrowRight size={15} />
            </span>
          </Link>
          <NavAuthControls />
        </div>
      </header>

      <main className="w-[min(75vw,1100px)] max-w-[calc(100%-2rem)] mx-auto px-3 sm:px-5 py-8 sm:py-10">
        <div className="grid grid-cols-1 lg:grid-cols-[7fr_3fr] gap-5 lg:gap-6 items-stretch">

          {/* Left: Portfolio + Assets */}
          <section
            className="rounded-2xl border overflow-hidden flex flex-col min-h-0"
            style={{
              borderColor: "rgba(100,116,180,0.28)",
              background: "linear-gradient(165deg, rgba(22,28,48,0.92) 0%, rgba(10,14,24,0.98) 55%, rgba(8,10,18,1) 100%)",
              boxShadow: "0 0 0 1px rgba(0,0,0,0.4), 0 24px 60px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.06)",
            }}
          >
            <div className="px-5 sm:px-6 pt-5 sm:pt-6 pb-5 border-b border-white/[0.06]">
              <p className="text-[11px] font-mono uppercase tracking-widest text-zinc-500 mb-2">Portfolio</p>
              {isLoading
                ? <div className="flex items-center gap-2 text-zinc-500"><Loader2 size={16} className="animate-spin" /><span className="text-[14px] font-mono">Loading…</span></div>
                : <p className="text-[2rem] sm:text-[2.35rem] font-bold tabular-nums tracking-tight text-white">{fmtUsd(totalUsd)}</p>
              }
              <p className="text-[12px] text-zinc-500 mt-2">Total value in USD</p>

              {address && (
                <div className="mt-4 rounded-xl border border-[#ff3b8d]/12 px-4 py-3" style={{ background: "rgba(255,59,141,0.04)" }}>
                  <p className="text-[10px] font-mono uppercase tracking-widest text-zinc-600 mb-1.5">
                    Your wallet · Ink Sepolia
                  </p>
                  <CopyAddress address={address} />
                  <p className="text-[10px] text-zinc-600 mt-1.5">
                    Send USDC, wQQQx or wSPYx to this address
                  </p>
                </div>
              )}
            </div>

            <div className="px-5 sm:px-6 pt-5 pb-5 sm:pb-6 flex-1 flex flex-col">
              <h2 className="text-base font-bold text-white mb-0.5">Assets</h2>
              <p className="text-[12px] text-zinc-500 mb-4">
                Tap "Grid it" to stake a token and mint gdUSD
              </p>

              <div
                className="rounded-xl border px-3 sm:px-4 pt-3 sm:pt-4 pb-1 flex-1"
                style={{ borderColor: "rgba(100,116,180,0.2)", background: "rgba(0,0,0,0.22)" }}
              >
                {isLoading ? (
                  <div className="flex items-center justify-center py-8 gap-2 text-zinc-500">
                    <Loader2 size={16} className="animate-spin" />
                    <span className="text-[13px] font-mono">Fetching balances…</span>
                  </div>
                ) : (
                  assets.map((asset) => (
                    <AssetRow key={asset.address} asset={asset} onGridIt={setGridItAsset} />
                  ))
                )}
              </div>

              {!isLoading && gdUsd.some((g) => g.formatted > 0) && (
                <div className="mt-4 rounded-xl border border-[#ff3b8d]/12 px-4 py-3" style={{ background: "rgba(255,59,141,0.03)" }}>
                  <p className="text-[10px] font-mono uppercase tracking-widest text-zinc-600 mb-2">
                    Active stakes → gdUSD
                  </p>
                  {gdUsd.map((g) => g.formatted > 0 && (
                    <div key={g.address} className="flex justify-between items-center py-1">
                      <span className="text-[12px] font-mono text-zinc-400">{g.symbol}</span>
                      <span className="text-[12px] font-mono tabular-nums" style={{ color: NEON }}>
                        {fmt(g.formatted, 2)} gdUSD
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          {/* Right: gdUSD + Redeem */}
          <section
            className="rounded-2xl border overflow-hidden flex flex-col min-h-0 lg:sticky lg:top-24 lg:self-start"
            style={{
              borderColor: "rgba(255,59,141,0.35)",
              background: "linear-gradient(165deg, rgba(32,18,36,0.95) 0%, rgba(14,10,22,0.98) 50%, rgba(10,8,16,1) 100%)",
              boxShadow: "0 0 0 1px rgba(255,59,141,0.08), 0 24px 60px rgba(0,0,0,0.5), 0 0 80px -20px rgba(255,59,141,0.15), inset 0 1px 0 rgba(255,255,255,0.05)",
            }}
          >
            <div className="px-5 sm:px-6 pt-5 sm:pt-6 pb-5 border-b border-[#ff3b8d]/15">
              <p className="text-[11px] font-mono uppercase tracking-widest text-zinc-500 mb-2">gdUSD balance</p>
              {isLoading
                ? <Loader2 size={16} className="animate-spin text-zinc-500" />
                : <p className="text-[2rem] sm:text-[2.35rem] font-bold tabular-nums tracking-tight" style={{ color: NEON, textShadow: "0 0 40px rgba(255,59,141,0.25)" }}>
                    {fmt(totalGdUsd, 2)}
                  </p>
              }
              <p className="text-[12px] text-zinc-500 mt-2">Grid stable · 1 gdUSD = $1 USDC</p>
            </div>

            <div className="px-4 sm:px-5 pt-4 pb-5 sm:pb-6 flex-1 flex flex-col">
              <div className="flex items-center gap-2 mb-3 text-zinc-500">
                <ChevronRight className="size-4" />
                <span className="text-[11px] font-mono uppercase tracking-widest">Redeem</span>
              </div>
              <RedeemCard gdUsdBalance={totalGdUsd} onSuccess={refetch} />
            </div>
          </section>
        </div>
      </main>

      {gridItAsset && (
        <GridItModal
          asset={gridItAsset}
          onClose={() => setGridItAsset(null)}
          onSuccess={() => { refetch(); setTimeout(() => setGridItAsset(null), 1500); }}
        />
      )}
    </div>
  );
}
