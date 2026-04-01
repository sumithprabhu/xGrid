import { usePrivy } from "@privy-io/react-auth";
import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { useAccount } from "wagmi";
import { ChevronDown } from "lucide-react";

function cropAddress(addr: string) {
  if (addr.length < 14) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

const btnBase =
  "shrink-0 flex items-center gap-1.5 rounded-full px-3.5 py-2 text-[13px] font-semibold transition-colors border";

type Props = {
  /** Hide the guest Login control (e.g. on /login to avoid a duplicate). */
  hideGuestLogin?: boolean;
  className?: string;
  /**
   * When set (e.g. in grid TopBar), guest login / address button use this box
   * so width/height match the balance pill beside it.
   */
  gridPillClassName?: string;
};

export function NavAuthControls({
  hideGuestLogin = false,
  className = "",
  gridPillClassName,
}: Props) {
  const { ready, authenticated, login, logout } = usePrivy();
  const { address } = useAccount();
  const [menuOpen, setMenuOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const appId = import.meta.env.VITE_PRIVY_APP_ID?.trim() ?? "";

  useEffect(() => {
    if (!menuOpen) return;
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [menuOpen]);

  const pillShell = gridPillClassName?.trim();
  const loginBtnClass = pillShell
    ? `${pillShell} text-[13px] font-semibold text-[#ff3b8d] transition-colors hover:bg-[#ff3b8d]/10`
    : `${btnBase} border-[#ff3b8d]/40 text-[#ff3b8d] hover:bg-[#ff3b8d]/10`;
  const addressBtnClass = pillShell
    ? `${pillShell} text-[13px] font-semibold text-zinc-200 font-mono tabular-nums transition-colors hover:bg-[#ff3b8d]/5`
    : `${btnBase} border-[#ff3b8d]/25 bg-[#0d1220] text-zinc-200 hover:border-[#ff3b8d]/45 hover:bg-[#ff3b8d]/5 font-mono tabular-nums max-w-[9.5rem] sm:max-w-[11rem]`;

  if (!ready) {
    return (
      <div
        className={
          pillShell
            ? `${pillShell} animate-pulse opacity-60 ${className}`
            : `h-9 w-[4.5rem] rounded-full bg-white/[0.06] animate-pulse ${className}`
        }
        aria-hidden
      />
    );
  }

  if (!authenticated) {
    if (hideGuestLogin) return null;
    if (!appId) {
      return (
        <Link href="/login" className={`${loginBtnClass} ${className}`.trim()}>
          Login
        </Link>
      );
    }
    return (
      <button
        type="button"
        onClick={() => login()}
        className={`${loginBtnClass} ${className}`}
      >
        Login
      </button>
    );
  }

  const label = address ? cropAddress(address) : "Wallet";

  return (
    <div className={`relative ${className}`} ref={wrapRef}>
      <button
        type="button"
        onClick={() => setMenuOpen((o) => !o)}
        aria-expanded={menuOpen}
        aria-haspopup="menu"
        className={addressBtnClass}
      >
        <span className="truncate min-w-0">{label}</span>
        <ChevronDown
          size={14}
          className={`shrink-0 text-[#ff3b8d]/70 transition-transform ${menuOpen ? "rotate-180" : ""}`}
        />
      </button>

      {menuOpen && (
        <>
          <div
            className="fixed inset-0 z-[60]"
            onClick={() => setMenuOpen(false)}
            aria-hidden
          />
          <div
            className="absolute right-0 top-full mt-2 z-[70] min-w-[200px] rounded-xl border border-[#ff3b8d]/25 bg-[#12182a] py-1 shadow-2xl shadow-black/50 overflow-hidden"
            role="menu"
          >
            <Link
              href="/portfolio"
              role="menuitem"
              onClick={() => setMenuOpen(false)}
              className="block w-full text-left px-4 py-3 text-sm text-zinc-200 hover:bg-[#ff3b8d]/10 transition-colors"
            >
              Portfolio
            </Link>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                logout();
              }}
              className="w-full text-left px-4 py-3 text-sm text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200 transition-colors border-t border-white/[0.06]"
            >
              Log out
            </button>
          </div>
        </>
      )}
    </div>
  );
}
