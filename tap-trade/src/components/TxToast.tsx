import { useEffect, useState } from "react";

const EXPLORER = "https://explorer-sepolia.inkonchain.com/tx/";
const DISPLAY_MS = 6000;

interface TxItem {
  hash: string;
  ts: number;
}

export function TxToast({ hash }: { hash: string | null }) {
  const [items, setItems] = useState<TxItem[]>([]);

  useEffect(() => {
    if (!hash) return;
    setItems((prev) => [{ hash, ts: Date.now() }, ...prev].slice(0, 5));
  }, [hash]);

  // Auto-dismiss after DISPLAY_MS
  useEffect(() => {
    if (items.length === 0) return;
    const iv = setInterval(() => {
      setItems((prev) => prev.filter((i) => Date.now() - i.ts < DISPLAY_MS));
    }, 500);
    return () => clearInterval(iv);
  }, [items.length]);

  if (items.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[200] flex flex-col gap-2 pointer-events-auto">
      {items.map((item) => {
        const short = item.hash.slice(0, 6) + "..." + item.hash.slice(-4);
        const age = Date.now() - item.ts;
        const fading = age > DISPLAY_MS - 800;

        return (
          <a
            key={item.hash + item.ts}
            href={EXPLORER + item.hash}
            target="_blank"
            rel="noopener noreferrer"
            className="group flex items-center gap-2.5 rounded-xl border px-3.5 py-2.5 backdrop-blur-md transition-all duration-300 cursor-pointer"
            style={{
              background: "rgba(20, 8, 16, 0.88)",
              borderColor: "rgba(255, 59, 141, 0.3)",
              boxShadow: "0 0 20px rgba(255, 59, 141, 0.08)",
              opacity: fading ? 0.4 : 1,
              transform: fading ? "scale(0.96)" : "scale(1)",
            }}
          >
            <div
              className="h-2 w-2 rounded-full animate-pulse"
              style={{ background: "#ff3b8d" }}
            />
            <div className="flex flex-col">
              <span
                className="text-[10px] font-semibold uppercase tracking-widest"
                style={{ color: "rgba(255, 59, 141, 0.7)" }}
              >
                Tx Sent
              </span>
              <span
                className="font-mono text-[13px] tabular-nums group-hover:underline"
                style={{ color: "rgba(255, 255, 255, 0.85)" }}
              >
                {short}
              </span>
            </div>
            <svg
              className="ml-1 h-3 w-3 opacity-40 group-hover:opacity-80 transition-opacity"
              fill="none"
              viewBox="0 0 12 12"
              stroke="currentColor"
              strokeWidth={1.5}
              style={{ color: "#ff3b8d" }}
            >
              <path d="M3 9L9 3M9 3H4.5M9 3v4.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </a>
        );
      })}
    </div>
  );
}
