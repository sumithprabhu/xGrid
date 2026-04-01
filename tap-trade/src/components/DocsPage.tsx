import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import {
  BookOpen, Gamepad2, Cpu, Zap, FileCode2,
  ChevronRight, Menu, X, ArrowLeft, ExternalLink,
  type LucideIcon,
} from "lucide-react";
import {
  GettingStarted,
  HowToPlay,
  Architecture,
  HowItWorks,
  Contracts,
} from "./docs/content";

// ── Nav structure ─────────────────────────────────────────────────────────────

type DocId = "getting-started" | "how-to-play" | "architecture" | "how-it-works" | "contracts";

interface NavItem {
  id: DocId;
  label: string;
  icon: LucideIcon;
  component: () => React.ReactElement;
}

interface NavSection {
  section: string;
  items: NavItem[];
}

const NAV: NavSection[] = [
  {
    section: "Introduction",
    items: [
      { id: "getting-started", label: "Getting Started", icon: BookOpen, component: GettingStarted },
    ],
  },
  {
    section: "Game",
    items: [
      { id: "how-to-play", label: "How to Play", icon: Gamepad2, component: HowToPlay },
    ],
  },
  {
    section: "Technical",
    items: [
      { id: "architecture",  label: "Architecture", icon: Cpu,       component: Architecture },
      { id: "how-it-works",  label: "How It Works", icon: Zap,       component: HowItWorks },
      { id: "contracts",     label: "Contracts",    icon: FileCode2,  component: Contracts },
    ],
  },
];

// ── Sidebar ───────────────────────────────────────────────────────────────────

function Sidebar({
  active,
  onSelect,
  mobile,
  onClose,
}: {
  active: DocId;
  onSelect: (id: DocId) => void;
  mobile?: boolean;
  onClose?: () => void;
}) {
  return (
    <aside
      className={[
        "flex flex-col h-full",
        mobile ? "p-4" : "p-6 pt-8",
      ].join(" ")}
    >
      {/* logo */}
      <div className="flex items-center gap-3 mb-8">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#ff3b8d] to-[#c026d3] flex items-center justify-center">
          <span className="text-white font-black text-xs">xS</span>
        </div>
        <div>
          <div className="text-white font-bold text-sm leading-tight">xStocks Grid</div>
          <div className="text-slate-500 text-[11px]">Documentation</div>
        </div>
        {mobile && (
          <button
            onClick={onClose}
            className="ml-auto text-slate-400 hover:text-white p-1"
          >
            <X size={18} />
          </button>
        )}
      </div>

      {/* nav */}
      <nav className="flex-1 space-y-5 overflow-y-auto">
        {NAV.map(({ section, items }) => (
          <div key={section}>
            <div className="text-[10px] font-semibold tracking-widest text-slate-500 uppercase mb-2 px-2">
              {section}
            </div>
            <ul className="space-y-0.5">
              {items.map(({ id, label, icon: Icon }) => {
                const isActive = active === id;
                return (
                  <li key={id}>
                    <button
                      onClick={() => {
                        onSelect(id);
                        onClose?.();
                      }}
                      className={[
                        "w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13.5px] font-medium transition-all duration-150 text-left",
                        isActive
                          ? "bg-[#ff3b8d]/15 text-[#ff3b8d] border border-[#ff3b8d]/25"
                          : "text-slate-400 hover:text-white hover:bg-white/5",
                      ].join(" ")}
                    >
                      <Icon size={14} className="shrink-0" />
                      {label}
                      {isActive && (
                        <ChevronRight size={12} className="ml-auto" />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* footer links */}
      <div className="mt-6 pt-5 border-t border-white/5 space-y-1">
        <a
          href="https://github.com"
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-2 text-slate-500 hover:text-slate-300 text-[12px] px-2 py-1 rounded transition-colors"
        >
          <ExternalLink size={11} />
          GitHub
        </a>
        <a
          href="/gridding"
          className="flex items-center gap-2 text-slate-500 hover:text-[#ff3b8d] text-[12px] px-2 py-1 rounded transition-colors"
        >
          <ExternalLink size={11} />
          Launch App
        </a>
      </div>
    </aside>
  );
}

// ── Main docs page ─────────────────────────────────────────────────────────────

export function DocsPage() {
  const [active, setActive] = useState<DocId>("getting-started");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [, navigate] = useLocation();
  const contentRef = useRef<HTMLDivElement>(null);

  // scroll to top on page change
  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, [active]);

  // keyboard: Escape closes mobile sidebar
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const allItems = NAV.flatMap((s) => s.items);
  const currentIndex = allItems.findIndex((i) => i.id === active);
  const prev = allItems[currentIndex - 1];
  const next = allItems[currentIndex + 1];
  const Component = allItems[currentIndex].component;

  return (
    <div className="min-h-screen bg-[#060912] text-white flex flex-col">
      {/* ── Top bar ── */}
      <header className="sticky top-0 z-40 h-14 border-b border-white/6 bg-[#060912]/95 backdrop-blur-sm flex items-center px-4 gap-4">
        <button
          onClick={() => navigate("/")}
          className="text-slate-400 hover:text-white transition-colors p-1 rounded"
          title="Back to app"
        >
          <ArrowLeft size={16} />
        </button>

        <div className="h-4 w-px bg-white/10" />

        {/* breadcrumb */}
        <div className="flex items-center gap-1.5 text-[13px]">
          <span className="text-slate-500">Docs</span>
          <ChevronRight size={12} className="text-slate-600" />
          <span className="text-white font-medium">
            {allItems[currentIndex].label}
          </span>
        </div>

        {/* mobile menu toggle */}
        <button
          className="ml-auto lg:hidden text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-white/5 transition-colors"
          onClick={() => setMobileOpen(true)}
        >
          <Menu size={18} />
        </button>

        {/* desktop launch app */}
        <a
          href="/gridding"
          className="hidden lg:flex items-center gap-1.5 ml-auto text-[12px] text-[#ff3b8d] hover:text-[#ff6baa] font-medium transition-colors"
        >
          Launch App
          <ExternalLink size={11} />
        </a>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* ── Desktop sidebar ── */}
        <div className="hidden lg:block w-64 shrink-0 border-r border-white/6 bg-[#070b14] sticky top-14 h-[calc(100vh-3.5rem)] overflow-y-auto">
          <Sidebar active={active} onSelect={setActive} />
        </div>

        {/* ── Mobile sidebar overlay ── */}
        {mobileOpen && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <div
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
              onClick={() => setMobileOpen(false)}
            />
            <div className="absolute left-0 top-0 bottom-0 w-72 bg-[#070b14] border-r border-white/6 overflow-y-auto">
              <Sidebar
                active={active}
                onSelect={setActive}
                mobile
                onClose={() => setMobileOpen(false)}
              />
            </div>
          </div>
        )}

        {/* ── Content ── */}
        <div
          ref={contentRef}
          className="flex-1 overflow-y-auto"
          style={{ height: "calc(100vh - 3.5rem)" }}
        >
          <div className="max-w-3xl mx-auto px-6 py-10 pb-20">
            {/* content */}
            <Component />

            {/* prev / next nav */}
            <div className="mt-16 pt-6 border-t border-white/6 flex items-center justify-between gap-4">
              {prev ? (
                <button
                  onClick={() => setActive(prev.id)}
                  className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors group"
                >
                  <ChevronRight
                    size={16}
                    className="rotate-180 text-[#ff3b8d] group-hover:translate-x-[-2px] transition-transform"
                  />
                  <div className="text-left">
                    <div className="text-[11px] text-slate-500">Previous</div>
                    <div className="text-[14px] font-medium">{prev.label}</div>
                  </div>
                </button>
              ) : (
                <div />
              )}
              {next ? (
                <button
                  onClick={() => setActive(next.id)}
                  className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors group ml-auto"
                >
                  <div className="text-right">
                    <div className="text-[11px] text-slate-500">Next</div>
                    <div className="text-[14px] font-medium">{next.label}</div>
                  </div>
                  <ChevronRight
                    size={16}
                    className="text-[#ff3b8d] group-hover:translate-x-[2px] transition-transform"
                  />
                </button>
              ) : (
                <div />
              )}
            </div>
          </div>
        </div>

        {/* ── Right TOC (desktop) — currently blank, could add headings ── */}
        <div className="hidden xl:block w-52 shrink-0" />
      </div>
    </div>
  );
}
