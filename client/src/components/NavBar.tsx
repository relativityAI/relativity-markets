import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { Menu, Flex, Text, Box } from "@/compat/ui";
import { Search, LogOut, Moon, Sun, Bolt, Check, TriangleAlert, SquareArrowRightEnter } from "lucide-react";
import { useAuth } from "@/auth/useAuth";
import { LOCAL_AUTH } from "@/auth/AuthContext";
import { useColorMode } from "@/components/ui/color-mode";
import UserAvatar from "@/components/shared/UserAvatar";
import { AgentService, AnalysisService, API_BASE, SettingsService, SkillService, type SkillSummary } from "@/db";
import { TickerLogo } from "@/lib/sourceLogos";
import { cn } from "@/lib/utils";
import searxngLogo from "@/assets/searxng.svg";
import yahooLogo from "@/assets/yahoo_finance.png";
import tavilyLogo from "@/assets/tavily-color.svg";
import tradingviewLogo from "@/assets/tradingview.svg";

// Navbar data-source chips. SearXNG/Yahoo/TradingView status comes from GET
// /health/sources — a real probe per source, cached server-side for a minute.
// Tavily is optional; connected = the user's Tavily API key is set.
type SourceStatus = { ok?: boolean; href?: string };

type StockRow = {
  ticker?: string;
  SYMBOL?: string;
  name?: string;
  NAME?: string;
  source?: string;
};

/** Bright 1-day intraday sparkline for a market index (^NSEI, ^NDX), served
 *  by the public /market/chart endpoint. Day change is measured against the
 *  feed's previous close (what the exchanges publish), not the session's
 *  first tick. Renders nothing when the feed is down — decoration must
 *  never block the nav. */
function IndexSpark({ name, symbol }: { name: string; symbol: string }) {
  const [data, setData] = useState<{ closes: number[]; changePct: number | null } | null>(null);
  const [ok, setOk] = useState(true);

  useEffect(() => {
    let alive = true;
    fetch(`${API_BASE}/market/chart/${encodeURIComponent(symbol)}?range=1d&interval=5m`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => {
        if (!alive) return;
        const closes: number[] = d.closes || [];
        const prevClose: number | null = d.previous_close ?? null;
        const last = closes[closes.length - 1] ?? null;
        if (closes.length < 2 || !prevClose || !last) { setOk(false); return; }
        setData({ closes, changePct: ((last - prevClose) / prevClose) * 100 });
      })
      .catch(() => { if (alive) setOk(false); });
    return () => { alive = false; };
  }, [symbol]);

  if (!ok || !data) return null;
  const { closes, changePct } = data;
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const span = max - min || 1;
  const W = 200;
  const H = 48;
  const pts = closes
    .map((c, i) => `${((i / (closes.length - 1)) * W).toFixed(1)},${(H - 4 - ((c - min) / span) * (H - 8)).toFixed(1)}`)
    .join(" ");
  const up = (changePct ?? 0) >= 0;
  const color = up ? "#22C55E" : "#EF4444";
  // Text twin: the bright hex is for the graphic (≥3:1 as a line), but at
  // 12px the original was 2.18:1 as text.
  const textColor = up ? "var(--signal-positive-text)" : "var(--signal-negative-text)";

  return (
    <div className="w-40">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-app-body text-[12px] font-normal text-[var(--ink-secondary)]">{name}</span>
        <span className="font-app-tabular text-[12px] font-medium" style={{ color: textColor }}>
          {changePct == null ? "" : `${changePct > 0 ? "+" : ""}${changePct.toFixed(2)}%`}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-1.5 h-10 w-full" aria-hidden="true">
        <polygon points={`0,${H} ${pts} ${W},${H}`} fill={color} opacity="0.12" />
        <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
    </div>
  );
}

export default function NavBar() {
  const { user, signOut } = useAuth();
  const { colorMode, toggleColorMode } = useColorMode();
  const navigate = useNavigate();
  const email = user?.email ?? "";
  const [sources, setSources] = useState<Record<string, SourceStatus>>({});

  const dataSources = useMemo<{ id: string; name: string; img: string }[]>(
    () => [
      { id: "searxng", name: "SearXNG", img: searxngLogo },
      { id: "tradingview", name: "TradingView", img: tradingviewLogo },
      { id: "tavily", name: "Tavily", img: tavilyLogo },
      { id: "yahoo", name: "Yahoo Finance (yfinance MCP)", img: yahooLogo },
    ],
    [],
  );

  useEffect(() => {
    let alive = true;
    // Tavily chip: connected iff the user's API key is set (not a live probe).
    // Default to not-connected; only the settings response can flip it on.
    setSources((prev) => ({ ...prev, tavily: { ok: false, href: "https://app.tavily.com" } }));
    fetch(`${API_BASE}/health/sources`)
      .then((r) => r.json())
      .then((d) => {
        // Merge, don't replace: the probe payload has no tavily entry and
        // clobbering the map here reset the chip to its ambiguous "checking" look.
        if (alive && d?.sources) setSources((prev) => ({ ...prev, ...d.sources }));
      })
      .catch(() => {});
    if (user) {
      SettingsService.getSettings()
        .then((d) => {
          if (alive)
            setSources((prev) => ({
              ...prev,
              tavily: { ok: !!d?.llm_keys?.tavily, href: "https://app.tavily.com" },
            }));
        })
        .catch(() => {});
    }
    return () => {
      alive = false;
    };
  }, [user]);

  // Global search — stocks, agents, skills and runs in one listbox; ⌘K/Ctrl-K
  // focuses it from anywhere. 300ms debounce: stocks stream from
  // /stocks/search and agents from /agents/search, while skills and runs are
  // small stable lists — fetched once per session, filtered locally.
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<StockRow[]>([]);
  const [agentHits, setAgentHits] = useState<{ id: string; name: string }[]>([]);
  const [skillHits, setSkillHits] = useState<{ id: string; name: string }[]>([]);
  const [runHits, setRunHits] = useState<{ id: string; label: string; symbol?: string; status?: string }[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const searchWrapRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const catalogRef = useRef<{ skills?: SkillSummary[]; runs?: any[] }>({});

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    abortRef.current?.abort();
    const q = query.trim();
    setActiveIdx(-1);
    debounceRef.current = setTimeout(async () => {
      if (!q) {
        setResults([]);
        setAgentHits([]);
        setSkillHits([]);
        setRunHits([]);
        setSearching(false);
        return;
      }
      setSearching(true);
      const controller = new AbortController();
      abortRef.current = controller;
      const live = () => !controller.signal.aborted;
      const lower = q.toLowerCase();
      const match = (s: string) => s.toLowerCase().includes(lower);

      const stocks = fetch(`${API_BASE}/stocks/search?${new URLSearchParams({ query: q })}`, {
        signal: controller.signal,
      })
        .then((r) => r.json())
        .then((d) => { if (live()) setResults(Array.isArray(d) ? d : []); })
        .catch((err) => {
          if (live() && (!(err instanceof DOMException) || err.name !== "AbortError")) setResults([]);
        });

      const agents = AgentService.searchAgents(q)
        .then((d) => { if (live()) setAgentHits((Array.isArray(d) ? d : []).slice(0, 5)); })
        .catch(() => {});

      const skills = (catalogRef.current.skills
          ? Promise.resolve(catalogRef.current.skills)
          : SkillService.listSkills().then((s) => { catalogRef.current.skills = s; return s; }))
        .then((s) => { if (live()) setSkillHits(s.filter((x) => match(`${x.name} ${x.description || ""}`)).slice(0, 5)); })
        .catch(() => {});

      const runs = (catalogRef.current.runs
          ? Promise.resolve(catalogRef.current.runs)
          : AnalysisService.listAnalyses().then((r) => {
              catalogRef.current.runs = Array.isArray(r) ? r : [];
              return catalogRef.current.runs;
            }))
        .then((rows) => {
          if (!live()) return;
          setRunHits(
            rows
              .filter((a: any) => match(`${a.share_name || ""} ${a.symbol || ""} ${a.model || ""}`))
              .slice(0, 5)
              .map((a: any) => ({
                id: String(a.analysis_id || a._id || a.id || ""),
                label: a.share_name || a.symbol || "Run",
                symbol: a.symbol || undefined,
                status: a.status ? String(a.status) : undefined,
              })),
          );
        })
        .catch(() => {});

      await Promise.allSettled([stocks, agents, skills, runs]);
      if (live()) setSearching(false);
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [query]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchWrapRef.current && !searchWrapRef.current.contains(e.target as Node)) setSearchOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // ⌘K / Ctrl-K focuses the search box from anywhere in the app.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen(true);
        searchInputRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const pickStock = (stock: StockRow) => {
    const sym = stock.ticker || stock.SYMBOL || "";
    const src = String(stock.source || "").toUpperCase();
    setSearchOpen(false);
    setQuery("");
    navigate(`/stock/${encodeURIComponent(sym)}?source=${src}`);
  };

  // Hits are flattened in render order — that index is the keyboard cursor.
  type Hit = { label: string; sub?: string; logo?: ReactNode; select: () => void };
  const rawGroups: { label: string; hits: Hit[] }[] = [
    {
      label: "Stocks",
      hits: results.map((stock) => {
        const sym = stock.ticker || stock.SYMBOL || "";
        const india = String(stock.source || "").toLowerCase() === "nse";
        return {
          label: stock.name || stock.NAME || sym,
          sub: `${india ? "🇮🇳" : "🇺🇸"} ${india ? "NSE" : "SEC"}:${sym}`,
          logo: <TickerLogo symbol={sym} size={18} />,
          select: () => pickStock(stock),
        };
      }),
    },
    {
      label: "Agents",
      hits: agentHits.map((a) => ({
        label: a.name,
        sub: "Agent",
        select: () => navigate(`/my-workspace?agent=${encodeURIComponent(a.id)}`),
      })),
    },
    {
      label: "Skills",
      hits: skillHits.map((s) => ({
        label: s.name,
        sub: "Skill",
        select: () => navigate(`/my-workspace?skill=${encodeURIComponent(s.id)}`),
      })),
    },
    {
      label: "Runs",
      hits: runHits.map((r) => ({
        label: r.label,
        sub: r.status ? `Run · ${r.status}` : "Run",
        logo: r.symbol ? <TickerLogo symbol={r.symbol} size={18} /> : undefined,
        select: () => navigate(`/analysis-result/${encodeURIComponent(r.id)}`),
      })),
    },
  ].filter((g) => g.hits.length > 0);
  let hitCursor = 0;
  const hitGroups = rawGroups.map((g) => ({ ...g, hits: g.hits.map((hit) => ({ ...hit, idx: hitCursor++ })) }));
  const flatHits = hitGroups.flatMap((g) => g.hits);

  const chooseHit = (idx: number) => {
    const hit = flatHits[idx];
    if (!hit) return;
    setSearchOpen(false);
    setActiveIdx(-1);
    setQuery("");
    hit.select();
  };

  // Keyboard (aria-activedescendant): focus stays in the input so typing keeps
  // filtering; arrows move the active option, Enter picks, Escape closes.
  const onSearchKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === "Escape") {
      if (searchOpen) {
        setSearchOpen(false);
        setActiveIdx(-1);
      }
      return;
    }
    if (!searchOpen) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (flatHits.length === 0) return;
      e.preventDefault();
      setActiveIdx(
        e.key === "ArrowDown"
          ? (activeIdx + 1) % flatHits.length
          : activeIdx <= 0
            ? flatHits.length - 1
            : activeIdx - 1,
      );
    } else if (e.key === "Enter") {
      if (activeIdx >= 0) {
        e.preventDefault();
        chooseHit(activeIdx);
      }
    }
  };

  return (
    <nav className="bg-[var(--surface-canvas)]">
      <div className="max-w-[1200px] mx-auto">
        {/* Level 1 — mast (wraps: search drops to its own row below md) */}
        <div className="px-6 flex flex-wrap items-center justify-between pt-6 pb-2">
        <div className="flex items-center gap-5">
          <Link
            to="/"
            className="text-[var(--ink-primary)] select-none cursor-pointer"
            style={{ fontFamily: "var(--font-display)", fontWeight: 500, fontSize: 26 }}
          >
            Relativity.
          </Link>
          <div className="flex items-center gap-3">
            <span className="hidden md:inline text-sm text-[var(--ink-tertiary)] font-light">Data sources</span>
            {/* Generous hit box (pad + negative margin keeps layout put): the fan-out moves chips
                right, so hover must survive the chase. delay-150 on exit = grace before collapse. */}
            {/* role=group, not list/listitem: the chips are now real controls
                (a link when there is one, a button when there isn't), and
                listitem role would strip that semantics. */}
            <div
              className="group flex items-center -mx-3 px-3 -my-2 py-2 pr-12 -mr-4"
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

        {/* Index tickers — moved here from the home hero */}
        <div className="hidden xl:flex items-center gap-6">
          <IndexSpark name="NIFTY 50" symbol="^NSEI" />
          <IndexSpark name="NASDAQ 100" symbol="^NDX" />
        </div>

        {/* Global search — stocks/agents/skills/runs; centered between the
            mast and the account controls on md+, own row on phones. */}
        <div
          ref={searchWrapRef}
          onKeyDown={onSearchKeyDown}
          className="relative order-3 flex basis-full items-center justify-center pb-3 md:order-none md:basis-auto md:flex-1 md:pb-0"
        >
          <div className="relative">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--ink-tertiary)]" />
            <input
              ref={searchInputRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setSearchOpen(true);
              }}
              onFocus={() => setSearchOpen(true)}
              placeholder="Search stocks, runs, agents…"
              aria-label="Search stocks, agents, skills and runs"
              role="combobox"
              aria-expanded={searchOpen}
              aria-controls="nav-search-listbox"
              aria-autocomplete="list"
              aria-activedescendant={
                activeIdx >= 0 && searchOpen && query.trim() !== "" ? `nav-search-opt-${activeIdx}` : undefined
              }
              className="h-8 w-52 rounded-full border border-[var(--hairline)] bg-[var(--surface-recessed)] pr-3 pl-8 font-[family-name:var(--font-body)] text-sm font-normal text-[var(--ink-primary)] outline-none focus:border-[var(--ink-tertiary)] md:pr-12"
            />
            {query === "" && (
              <kbd
                aria-hidden="true"
                className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 rounded-[3px] border border-[var(--hairline)] px-1 py-px font-[family-name:var(--font-body)] text-[10px] font-normal text-[var(--ink-tertiary)] md:block"
              >
                ⌘K
              </kbd>
            )}
          </div>
          {searchOpen && query.trim() !== "" && (
            <div
              id="nav-search-listbox"
              role="listbox"
              aria-label="Search results"
              className="listbox-panel absolute top-[calc(100%+6px)] left-1/2 -translate-x-1/2 z-50 max-h-[320px] w-[340px] overflow-y-auto rounded-[6px] border border-[var(--hairline)] bg-[var(--surface-canvas)] py-1 shadow-[0_8px_24px_rgba(0,0,0,0.12)]"
            >
              {searching && (
                <div className="px-3 py-2.5 font-[family-name:var(--font-body)] text-xs text-[var(--ink-tertiary)]">Searching…</div>
              )}
              {!searching && flatHits.length === 0 && (
                <div className="px-3 py-2.5 font-[family-name:var(--font-body)] text-xs text-[var(--ink-tertiary)]">
                  Nothing matches “{query}”.
                </div>
              )}
              {!searching &&
                hitGroups.map((group) => (
                  <div key={group.label} role="group" aria-label={group.label}>
                    <div
                      aria-hidden="true"
                      className="px-3 pt-2 pb-0.5 font-[family-name:var(--font-body)] text-[10.5px] font-medium tracking-[0.08em] text-[var(--ink-tertiary)] uppercase"
                    >
                      {group.label}
                    </div>
                    {group.hits.map((hit) => (
                      <button
                        key={hit.idx}
                        id={`nav-search-opt-${hit.idx}`}
                        type="button"
                        role="option"
                        tabIndex={-1}
                        aria-selected={activeIdx === hit.idx}
                        onClick={() => chooseHit(hit.idx)}
                        onMouseEnter={() => setActiveIdx(hit.idx)}
                        className={`flex w-full cursor-pointer items-center gap-2 rounded-[12px] px-2.5 py-2 text-left ${
                          activeIdx === hit.idx ? "bg-[var(--surface-recessed)]" : ""
                        }`}
                      >
                        {hit.logo && <span className="inline-flex shrink-0">{hit.logo}</span>}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] text-[var(--ink-primary)]">{hit.label}</span>
                          {hit.sub && (
                            <span className="block truncate text-[11px] text-[var(--ink-tertiary)]">{hit.sub}</span>
                          )}
                        </span>
                      </button>
                    ))}
                  </div>
                ))}
            </div>
          )}
        </div>

        <div className="order-2 flex items-center gap-5 md:order-none">
          <button
            aria-label="Toggle color mode"
            onClick={toggleColorMode}
            className="text-[var(--ink-tertiary)] hover:opacity-60 transition-opacity cursor-pointer"
          >
            {colorMode === "dark" ? <Moon size={18} /> : <Sun size={18} />}
          </button>

          {/* Account avatar — dropdown holds Log in when signed out */}
          <Menu.Root positioning={{ placement: "bottom-end" }}>
            <Menu.Trigger asChild>
              <Box cursor="pointer" title={email || "Account"}>
                <UserAvatar seed={email} size={30} />
              </Box>
            </Menu.Trigger>
            <Menu.Positioner>
              <Menu.Content minWidth="220px">
                {user ? (
                  <>
                    {!LOCAL_AUTH && (
                      <Flex direction="column" gap={0} px={3} py={2.5} w="full" minW={0}>
                        <Text textStyle="xs" color="fg.muted">Signed in as</Text>
                        <Text fontSize="sm" color="fg" w="full" overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap">
                          {email}
                        </Text>
                      </Flex>
                    )}
                    {!LOCAL_AUTH && <Menu.Separator />}
                    <Menu.Item value="settings" onClick={() => navigate("/settings")}>
                      <Bolt size={15} />
                      <Text fontSize="sm">Settings</Text>
                    </Menu.Item>
                    {!LOCAL_AUTH && (
                      <Menu.Item value="signout" onClick={() => signOut()}>
                        <LogOut size={15} />
                        <Text fontSize="sm">Sign out</Text>
                      </Menu.Item>
                    )}
                  </>
                ) : (
                  <>
                    <Menu.Item value="login" onClick={() => navigate("/login")}>
                      <SquareArrowRightEnter size={15} />
                      <Text fontSize="sm">Log in</Text>
                    </Menu.Item>
                    <Menu.Item value="settings" onClick={() => navigate("/settings")}>
                      <Bolt size={15} />
                      <Text fontSize="sm">Settings</Text>
                    </Menu.Item>
                  </>
                )}
              </Menu.Content>
            </Menu.Positioner>
          </Menu.Root>

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
              { to: "/new-analysis", label: "New Run", end: false, dot: "#7A9E7E" },
              { to: "/analysis-list", label: "Runs", end: false, dot: "#C49A6C" },
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
