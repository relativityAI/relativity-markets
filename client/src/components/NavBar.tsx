import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { Moon, Sun, Check, TriangleAlert, ArrowRight, Settings as SettingsIcon } from "lucide-react";
import { useAuth } from "@/auth/useAuth";
import { useColorMode } from "@/components/ui/color-mode";
import AlertBell from "@/components/AlertBell";
import EntitySearch, { type EntityPick } from "@/components/search/EntitySearch";
import { AnalysisService, API_BASE } from "@/db";
import { TickerLogo } from "@/lib/sourceLogos";
import { MCP_LOGOS } from "@/lib/mcp";
import { cn } from "@/lib/utils";

// Navbar data-source chips — rendered from GET /health/sources, which the
// server derives from harness config (one probe per configured MCP server,
// cached a minute; key-gated sources are skipped there).
type SourceStatus = { ok?: boolean; href?: string; label?: string };

// Logos are chrome, keyed by server name (shared with the Settings cards);
// unknown servers get an initial.
// Stable chip order regardless of fetch/merge order.
const CHIP_ORDER = ["searxng", "tradingview", "yfinance"];
const chipRank = (id: string) => {
  const i = CHIP_ORDER.indexOf(id);
  return i === -1 ? 99 : i;
};

type StockRow = {
  ticker?: string;
  SYMBOL?: string;
  name?: string;
  NAME?: string;
  source?: string;
};

export default function NavBar() {
  const { user } = useAuth();
  const { colorMode, toggleColorMode } = useColorMode();
  const navigate = useNavigate();
  const [sources, setSources] = useState<Record<string, SourceStatus>>({});

  const dataSources = useMemo<{ id: string; name: string; img?: string }[]>(
    () =>
      Object.entries(sources)
        .sort(([a], [b]) => chipRank(a) - chipRank(b))
        .map(([id, s]) => ({ id, name: s.label ?? id, img: MCP_LOGOS[id] })),
    [sources],
  );

  useEffect(() => {
    let alive = true;
    fetch(`${API_BASE}/health/sources`)
      .then((r) => r.json())
      .then((d) => {
        if (alive && d?.sources) setSources(d.sources);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // Global search — the shared TradingView-style EntitySearch owns the query,
  // tabs, pills, recents and fetching. The navbar only opens/closes it and
  // navigates on pick. Ctrl/Cmd+K lives inside the component (hotkey).
  const [searchOpen, setSearchOpen] = useState(false);
  const navigateEntity = (pick: EntityPick) => {
    if (pick.kind === "stock") {
      navigate(`/stock/${encodeURIComponent(pick.symbol)}?source=${pick.source}`);
    } else if (pick.kind === "group") {
      navigate(`/group/${encodeURIComponent(pick.key)}`);
    } else if (pick.kind === "plugin") {
      navigate(`/plugins/${encodeURIComponent(pick.id)}`);
    } else {
      navigate(`/runs/${encodeURIComponent(pick.id)}`);
    }
  };

  // Level-2 "latest runs" cluster: the three most recent run symbols and an
  // arrow — no details.
  const [latestRuns, setLatestRuns] = useState<{ id: string; symbol: string }[]>([]);
  useEffect(() => {
    AnalysisService.listAnalyses()
      .then((rows) => {
        const list: { id?: string; analysis_id?: string; symbol?: string; created_at?: string }[] = Array.isArray(rows)
          ? rows
          : [];
        setLatestRuns(
          [...list]
            .sort((a, b) => +new Date(b.created_at || 0) - +new Date(a.created_at || 0))
            .filter((r) => r.symbol)
            .slice(0, 3)
            .map((r) => ({ id: String(r.id || r.analysis_id || ""), symbol: String(r.symbol) })),
        );
      })
      .catch(() => {});
  }, []);

  return (
    <nav className="bg-[var(--surface-canvas)]">
      <div className="max-w-[1200px] mx-auto">
        {/* Level 1 — mast (wraps: search drops to its own row below md).
            lg+: a 1fr / auto / 1fr grid, so the search sits dead centre of the
            navbar instead of centred in whatever space the two uneven side
            groups (wide mast, narrow controls) leave over. Below lg the sides
            are too unequal to share space without crowding, so it stays flex. */}
        <div className="px-6 flex flex-wrap items-center justify-between pt-6 pb-2 lg:grid lg:grid-cols-[1fr_auto_1fr] lg:items-center">
        <div className="flex items-center gap-5">
          <Link
            to="/"
            className="text-[var(--ink-primary)] select-none cursor-pointer"
            style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: 26 }}
          >
            Relativity.
          </Link>
          <div className="flex items-center gap-3">
            <span className="hidden md:inline text-sm text-[var(--ink-tertiary)] font-light">Data sources</span>
            {/* Generous hit box (pad + negative margin keeps layout put): the fan-out moves chips
                right, so hover must survive the chase. delay-150 on exit = grace before collapse.
                Hidden below sm: four logos plus their hover padding don't fit beside the brand on
                a phone (they'd push the account controls onto their own line), and their labels
                are hover-only anyway — no hover on touch. */}
            {/* role=group, not list/listitem: the chips are now real controls
                (a link when there is one, a button when there isn't), and
                listitem role would strip that semantics. */}
            <div
              className="group hidden items-center -mx-3 px-3 -my-2 py-2 pr-12 -mr-4 sm:flex"
              role="group"
              aria-label="Data sources"
            >
              {dataSources.map((s, i) => {
                const st = sources[s.id];
                const down = st?.ok === false;
                const href = st?.href;
                const label = `${s.name} — ${st == null ? "checking" : down ? "not connected" : "connected"}`;
                const chipCls = cn(
                  // Global `:focus-visible` (index.css) supplies the ring —
                  // after:-inset-2 = 44px hit box (WCAG 2.5.8 / 44px touch).
                  "group/src relative block h-7 w-7 shrink-0 rounded-full bg-[color-mix(in_srgb,var(--ink-primary)_12%,var(--surface-canvas))] p-[5px] shadow-[0_0_0_2px_var(--surface-canvas)] transition-transform duration-300 ease-in-out delay-150 group-hover:delay-0 will-change-transform group-hover:[transform:translateX(calc(var(--i)*12px))] after:absolute after:-inset-2 after:rounded-full after:content-['']",
                  i > 0 && "-ml-2",
                  href ? "cursor-pointer" : "cursor-default",
                );
                const inner = (
                  <>
                    {s.img ? (
                      <img
                        src={s.img}
                        alt=""
                        aria-hidden="true"
                        className={cn(
                          "h-full w-full object-contain",
                          down && "grayscale opacity-40",
                          // The TradingView SVG is solid black — invert on dark so it stays visible.
                          s.id === "tradingview" && colorMode === "dark" && "invert",
                        )}
                      />
                    ) : (
                      // No logo for this server name — an honest initial beats a broken img.
                      <span
                        aria-hidden="true"
                        className="flex h-full w-full items-center justify-center font-[family-name:var(--font-body)] text-[10px] font-medium text-[var(--ink-secondary)]"
                      >
                        {s.name.slice(0, 1).toUpperCase()}
                      </span>
                    )}
                    {/* Reveal on hover, keyboard focus and press (touch never
                        fires :hover on iOS, so the tap has to work too). */}
                    <span className="pointer-events-none invisible absolute left-1/2 top-full z-40 mt-1.5 flex -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded-[4px] border border-[var(--hairline)] bg-[var(--surface-canvas)] px-2 py-1 font-[family-name:var(--font-body)] text-xs text-[var(--ink-primary)] opacity-0 shadow-[0_8px_24px_rgba(0,0,0,0.12)] transition-all duration-150 group-hover/src:delay-300 group-hover/src:visible group-hover/src:opacity-100 group-focus-within/src:visible group-focus-within/src:opacity-100 group-focus-within/src:delay-0 group-active/src:visible group-active/src:opacity-100">
                      {s.name}
                      {st?.ok === true && <Check size={12} style={{ color: "#7A9E7E" }} />}
                      {down && <TriangleAlert size={12} style={{ color: "#C49A6C" }} />}
                    </span>
                  </>
                );
                const shared = {
                  "aria-label": label,
                  style: { "--i": i } as CSSProperties,
                  className: chipCls,
                };
                return href ? (
                  <a key={s.id} href={href} target="_blank" rel="noreferrer" {...shared}>
                    {inner}
                  </a>
                ) : (
                  <button key={s.id} type="button" {...shared}>
                    {inner}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Global search — TradingView-style entity search (stocks, groups,
            plugins, runs); centered between the mast and the account controls
            on md+, own row on phones. */}
        <div className="relative order-3 flex basis-full items-center justify-center pb-3 md:order-none md:basis-auto md:flex-1 md:pb-0">
          <div className="w-52 md:w-64">
            <EntitySearch
              open={searchOpen}
              onOpenChange={setSearchOpen}
              onPick={navigateEntity}
              hotkey
            />
          </div>
        </div>

        {/* Controls: `ml-auto` keeps them pinned right if they ever land on a
            line of their own (narrow phone, big system font) — with
            justify-between a lone item falls back to the left edge. */}
        <div className="order-2 ml-auto flex items-center gap-5 md:order-none lg:justify-self-end">
          {user && <AlertBell />}
          <button
            aria-label="Toggle color mode"
            onClick={toggleColorMode}
            className="text-[var(--ink-tertiary)] hover:opacity-60 transition-opacity cursor-pointer"
          >
            {colorMode === "dark" ? <Moon size={18} /> : <Sun size={18} />}
          </button>

          {/* Settings — the account menu went away with the avatar; one icon, one destination. */}
          <button
            type="button"
            aria-label="Settings"
            title="Settings"
            onClick={() => navigate("/settings")}
            className="cursor-pointer text-[var(--ink-tertiary)] transition-opacity hover:opacity-60"
          >
            <SettingsIcon size={18} />
          </button>

        </div>
      </div>

      {/* Line between levels */}
      <div className="px-6"><div className="h-px bg-[var(--ink-primary)]" /></div>

      {/* Level 2 — nav links (horizontally scrollable, scrollbar hidden) */}
      <div className="overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="px-6 flex items-center gap-6 h-9 font-[family-name:var(--font-body)] font-light min-w-max">
          <NavLink
            to="/"
            end
            className={({ isActive }) =>
              cn(
                "flex items-center gap-2 text-sm transition-colors cursor-pointer shrink-0",
                isActive
                  ? "text-[var(--ink-primary)]"
                  : "text-[var(--ink-secondary)] hover:text-[var(--ink-primary)]",
              )
            }
          >
            <span className="w-1.5 h-1.5 rounded-full bg-[#C49A6C]" />
            Home
          </NavLink>
          <div className="h-4 w-px bg-[var(--hairline)]" />
          <div className="flex items-center gap-6">
            {[
              // One name per concept, used by nav, h1, tab title and footer.
              { to: "/my-workspace", label: "Workspace", end: true, dot: "#7A8B9E" },
              { to: "/new-run", label: "New Run", end: false, dot: "#7A9E7E" },
              { to: "/runs", label: "Runs", end: false, dot: "#C49A6C" },
              { to: "/sectors", label: "Sectors", end: false, dot: "#9E7AC4" },
              { to: "/watchlists", label: "Watchlist", end: false, dot: "#3B82F6" },
            ].map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-2 text-sm transition-colors cursor-pointer shrink-0",
                    isActive
                      ? "text-[var(--ink-primary)]"
                      : "text-[var(--ink-secondary)] hover:text-[var(--ink-primary)]",
                  )
                }
              >
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: item.dot }} />
                {item.label}
              </NavLink>
            ))}
          </div>

          {/* Latest runs — three stock logos plus a separate arrow circle,
              one link to the past-runs page. Hidden below md: it needs
              ~180px and level 2 already scrolls on phones. */}
          {latestRuns.length > 0 && (
            <Link to="/runs" className="ml-auto hidden shrink-0 cursor-pointer items-center gap-2 pl-6 md:flex">
              <span className="text-[11px] font-normal text-[var(--ink-tertiary)]">Latest runs</span>
              <span className="flex items-center gap-0.5">
                {latestRuns.map((r, i) => (
                  <span
                    key={r.id || i}
                    className="inline-flex rounded-full"
                    style={{ boxShadow: "0 0 0 2px var(--surface-canvas)" }}
                  >
                    <TickerLogo symbol={r.symbol} size={22} />
                  </span>
                ))}
              </span>
              <span className="ml-1.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-[var(--surface-raised)]">
                <ArrowRight size={14} aria-hidden="true" />
              </span>
            </Link>
          )}
        </div>
      </div>

      {/* Ultra thin light grey line below level 2 */}
      <div className="px-6"><div className="h-px bg-[var(--hairline)]" /></div>

      {/* No hamburger menu: level 2 is the full nav and never hides — a
          second copy of the same links below md was pure duplication. */}
      </div>
    </nav>
  );
}
