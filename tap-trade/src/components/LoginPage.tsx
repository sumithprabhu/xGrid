import { usePrivy } from "@privy-io/react-auth";
import { useMemo } from "react";
import { Link, useLocation, useSearchParams } from "wouter";
import { useAccount, useSwitchChain } from "wagmi";
import { appChain } from "../lib/wagmiConfig";
import { NavAuthControls } from "./NavAuthControls";

const NEON = "#ff3b8d";

function safeRedirect(raw: string | undefined): string {
  if (!raw || !raw.startsWith("/")) return "/gridding";
  if (raw.startsWith("//")) return "/gridding";
  return raw;
}

export function LoginPage() {
  const [, navigate] = useLocation();
  const [searchParams] = useSearchParams();
  const redirect = useMemo(
    () => safeRedirect(searchParams.get("redirect") ?? undefined),
    [searchParams],
  );
  const needsChain = searchParams.get("needsChain") === "1";

  const { ready, authenticated, login, logout } = usePrivy();
  const { address, chainId } = useAccount();
  const { switchChain, isPending: isSwitchPending } = useSwitchChain();

  const appId = import.meta.env.VITE_PRIVY_APP_ID?.trim() ?? "";

  const wrongChain =
    authenticated && chainId !== undefined && chainId !== appChain.id;

  return (
    <div className="min-h-screen w-full bg-[#0a0e1a] text-white chart-dot-bg">
      <header
        className="flex items-center justify-between pl-5 pr-6 sm:pl-7 py-4 border-b border-[#ff3b8d]/10 backdrop-blur-sm"
        style={{ background: "rgba(10,14,26,0.85)" }}
      >
        <Link href="/">
          <span className="font-logo text-[1.65rem] text-[#ff3b8d] drop-shadow-[0_0_18px_rgba(255,59,141,0.45)] ml-1 sm:ml-2 cursor-pointer hover:opacity-90 inline-block">
            xGrid
          </span>
        </Link>
        <NavAuthControls hideGuestLogin />
      </header>

      <main className="max-w-md mx-auto px-5 py-14">
        <h1 className="text-2xl font-bold text-white mb-2">Sign in</h1>
        <p className="text-[15px] text-zinc-400 mb-8 leading-relaxed">
          Sign in with email via{" "}
          <span style={{ color: NEON }} className="font-semibold">
            Privy
          </span>
          . An embedded wallet is created for you on{" "}
          <span style={{ color: NEON }} className="font-semibold">
            Ink Sepolia
          </span>
          . Add Google or other methods in the Privy dashboard if you like.
        </p>

        {!appId ? (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-[13px] text-amber-100/90 mb-6">
            Set{" "}
            <code className="text-amber-200/90">VITE_PRIVY_APP_ID</code> in{" "}
            <code className="text-amber-200/90">.env</code> from{" "}
            <a
              href="https://dashboard.privy.io"
              className="text-amber-200 underline"
              target="_blank"
              rel="noreferrer"
            >
              dashboard.privy.io
            </a>
            .
          </div>
        ) : null}

        {!ready ? (
          <p className="text-zinc-500 text-sm font-mono">Starting Privy…</p>
        ) : !authenticated ? (
          <button
            type="button"
            onClick={() => login()}
            disabled={!appId}
            className="w-full py-3.5 rounded-xl font-bold text-[15px] transition-all active:scale-[0.98] disabled:opacity-45 bg-white hover:bg-zinc-100 border border-white/90 shadow-lg shadow-black/20"
            style={{ color: NEON }}
          >
            Sign in with email
          </button>
        ) : (
          <div className="space-y-4">
            {(wrongChain || needsChain) && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-[13px] text-amber-100/90">
                Switch your wallet to <strong>Ink Sepolia</strong> (chain{" "}
                {appChain.id}).
              </div>
            )}

            <div className="rounded-xl border border-[#ff3b8d]/20 bg-black/25 px-4 py-3 text-[13px] font-mono text-zinc-300 break-all">
              <span className="text-zinc-500 block mb-1 text-[11px] uppercase tracking-wider">
                Wallet
              </span>
              {address ?? "—"}
            </div>

            {(wrongChain || needsChain) && (
              <button
                type="button"
                onClick={() => switchChain({ chainId: appChain.id })}
                disabled={isSwitchPending}
                className="w-full py-3 rounded-xl font-semibold text-[14px] text-white border border-[#ff3b8d]/40 hover:bg-[#ff3b8d]/10 transition-colors disabled:opacity-50"
              >
                {isSwitchPending ? "Switching…" : "Use Ink Sepolia"}
              </button>
            )}

            {!wrongChain && !needsChain && (
              <button
                type="button"
                onClick={() => navigate(redirect)}
                className="w-full py-3.5 rounded-xl font-bold text-[15px] text-white transition-transform active:scale-[0.98]"
                style={{
                  background: `linear-gradient(180deg, ${NEON} 0%, #c42d6f 100%)`,
                  boxShadow:
                    "0 6px 20px rgba(255,59,141,0.35), inset 0 1px 0 rgba(255,255,255,0.25)",
                }}
              >
                Continue to app
              </button>
            )}

            <button
              type="button"
              onClick={() => logout()}
              className="w-full py-2 text-[13px] text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              Sign out
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
