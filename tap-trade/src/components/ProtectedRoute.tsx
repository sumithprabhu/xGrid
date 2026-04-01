import type { ReactNode } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { Redirect, useLocation } from "wouter";
import { appChain } from "../lib/wagmiConfig";
import { useAccount } from "wagmi";

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { ready, authenticated } = usePrivy();
  const { chainId } = useAccount();
  const [path] = useLocation();

  if (!ready) {
    return (
      <div className="min-h-screen bg-[#0a0e1a] text-white flex items-center justify-center font-mono text-sm text-zinc-400">
        Loading…
      </div>
    );
  }

  if (!authenticated) {
    return (
      <Redirect to={`/login?redirect=${encodeURIComponent(path)}`} replace />
    );
  }

  if (chainId !== undefined && chainId !== appChain.id) {
    return (
      <Redirect
        to={`/login?redirect=${encodeURIComponent(path)}&needsChain=1`}
        replace
      />
    );
  }

  return <>{children}</>;
}
