import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type ComponentType } from "react";
import { Link } from "react-router-dom";
import { Clock, Play, ArrowRight, List, Plus, X, Search, Loader2, Pencil, Trash2, LayoutGrid, Table2 } from "lucide-react";
import { AnalysisService, AgentService, API_BASE, WatchlistService, type ScheduleRow, type WatchlistRow, type WatchlistItem } from "@/db";
import { TickerLogo } from "@/lib/sourceLogos";
import AgentAvatar from "@/components/shared/AgentAvatar";
import { DropdownItem } from "@/pages/shared/AnalysisControls";
import ConfirmDialog from "@/components/ConfirmDialog";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { toaster } from "@/compat/ui";

/** Page-title combo: light, large Anek Latin (same as the workspace pages). */
const SECTION_TITLE = "font-app-body text-[30px] leading-none font-light tracking-tight text-console-ink";
const CARD = "glass-hover";

/** Hover cue floated over the blurred card body — same pattern as AgentCell. */
function OpenCue() {
    return (
        <span className="glass-hover-cue font-app-body text-xs font-normal text-[#4A6E8E]">
            Open
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M3 9L9 3" />
                <path d="M4.5 3H9v4.5" />
            </svg>
        </span>
    );
}

function timeAgo(dateStr: string): string {
    if (!dateStr) return "";
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 30) return `${days}d ago`;
    return new Date(dateStr).toLocaleDateString();
}

function flag(source?: string | null): string {
    return String(source || "").toUpperCase() === "NSE" ? "🇮🇳" : "🇺🇸";
}

/** Verdict word → signal color (green strong, amber mid, red negative),
 *  matching verdictForScore's banding in lib/analysisFormat. */
function verdictColor(verdict?: string | null): string | undefined {
    if (!verdict) return undefined;
    const v = verdict.toLowerCase();
    if (["outstanding", "strong", "shortlist", "buy"].includes(v)) return "var(--signal-positive)";
    if (["fair", "watch", "hold", "underwhelming", "neutral"].includes(v)) return "var(--signal-caution)";
    if (["subpar", "pass", "error", "sell"].includes(v)) return "var(--signal-negative)";
    return undefined;
}

type Spark = { pts: string; color: string; pct: number | null };

/** One intraday sparkline fetch per symbol — shared by the card's chart and
 *  its % change so the two never drift apart (or double-fetch). */
function useSpark(symbol: string, source?: string | null): Spark | null {
    const [spark, setSpark] = useState<Spark | null>(null);

    useEffect(() => {
        let alive = true;
        fetch(`${API_BASE}/market/chart/${encodeURIComponent(symbol)}?range=1d&interval=5m&source=${encodeURIComponent(source || "")}`, { cache: "no-store" })
            .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
            .then((d) => {
                if (!alive) return;
                const closes: number[] = d.closes || [];
                if (closes.length < 2) { setSpark(null); return; }
                const min = Math.min(...closes);
                const max = Math.max(...closes);
                const span = max - min || 1;
                const W = 100;
                const H = 40;
                const pts = closes
                    .map((c, i) => `${((i / (closes.length - 1)) * W).toFixed(1)},${(H - 3 - ((c - min) / span) * (H - 6)).toFixed(1)}`)
                    .join(" ");
                const last = closes[closes.length - 1];
                const prev: number | null = d.previous_close ?? null;
                const pct = prev ? ((last - prev) / prev) * 100 : null;
                const up = prev ? last >= prev : last >= closes[0];
                setSpark({ pts, color: up ? "#22C55E" : "#EF4444", pct });
            })
            .catch(() => { if (alive) setSpark(null); });
        return () => { alive = false; };
    }, [symbol, source]);

    return spark;
}

/** The line itself: logo-height, and preserveAspectRatio=none + non-scaling-
 *  stroke make it fill whatever width is left instead of letterboxing to the
 *  100×40 viewBox and rendering tiny. */
function SparkSvg({ spark }: { spark: Spark }) {
    return (
        <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="h-14 w-full min-w-0 flex-1" aria-hidden="true">
            <polygon points={`0,40 ${spark.pts} 100,40`} fill={spark.color} opacity="0.12" />
            <polyline
                points={spark.pts}
                fill="none"
                stroke={spark.color}
                strokeWidth="2"
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
            />
        </svg>
    );
}

function SparkChange({ spark }: { spark: Spark }) {
    if (spark.pct == null) return null;
    return (
        <span className="shrink-0 font-app-tabular text-[11px] font-medium" style={{ color: spark.color }}>
            {spark.pct > 0 ? "+" : ""}{spark.pct.toFixed(2)}%
        </span>
    );
}

/** Chart + day change on one line — the table view's chart cell. */
function MiniSpark({ symbol, source }: { symbol: string; source?: string | null }) {
    const spark = useSpark(symbol, source);
    if (!spark) return null;
    return (
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
            <SparkSvg spark={spark} />
            <SparkChange spark={spark} />
        </div>
    );
}

/** Big borderless pill shown under an empty section. */
function BigGhost({ to, icon: Icon, children }: { to: string; icon: ComponentType<{ size?: number }>; children: ReactNode }) {
    return (
        <Link
            to={to}
            className="mt-3 flex h-14 w-full items-center justify-center gap-2.5 rounded-[12px] border-0 bg-[var(--surface-raised)] font-app-body text-[15px] font-normal text-[var(--ink-secondary)] transition-colors hover:bg-[var(--surface-raised-hover)] hover:text-[var(--ink-primary)]"
        >
            <Icon size={18} />
            {children}
        </Link>
    );
}

function HomeSection({ title, children, empty, emptyTo, emptyIcon, emptyLabel }: {
    title: string; children: ReactNode; empty: boolean; emptyTo: string; emptyIcon: ComponentType<{ size?: number }>; emptyLabel: string;
}) {
    return (
        <section>
            <h2 className={SECTION_TITLE}>{title}</h2>
            <div className="mt-4 flex flex-col gap-2.5">{children}</div>
            {empty && <BigGhost to={emptyTo} icon={emptyIcon}>{emptyLabel}</BigGhost>}
        </section>
    );
}

interface RunCardAgent {
    agent?: string;
    verdict?: string;
    when: string;
}

interface RunCardData {
    symbol: string;
    share_name: string;
    source?: string;
    agents: RunCardAgent[];
    /** Latest run for the symbol — the card links to its result. */
    id?: string;
}

/** Stock-search result row (shared by the picker below). */
type StockRow = { ticker?: string; SYMBOL?: string; name?: string; NAME?: string; source?: string };

/** Watchlist card: same visual language as the Latest-runs cards — stock
 *  logo on top, name + flag, then the agents that ran on it (compact rows:
 *  small avatar, name, colored verdict, light last-run time). Opens the
 *  symbol's latest run result in a new tab. A grid cell, so it is always the
 *  same width as the add-stock tile next to it. */
const WATCH_CARD = "glass-hover";

/** The watchlist before SQLite kept only symbols under this localStorage key. */
const LEGACY_WATCH_KEY = "relativity.watchlist";

function legacyWatchSymbols(): string[] {
    try {
        const raw = localStorage.getItem(LEGACY_WATCH_KEY);
        const v = raw ? JSON.parse(raw) : [];
        return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
    } catch { return []; }
}

function RunCard({ run, onRemove }: { run: RunCardData; onRemove?: () => void }) {
    const spark = useSpark(run.symbol, run.source);
    return (
        <Link
            to={run.id ? `/analysis-result/${run.id}` : `/stock/${encodeURIComponent(run.symbol)}?source=${encodeURIComponent(run.source || "")}`}
            target="_blank"
            rel="noreferrer"
            data-solid=""
            className={WATCH_CARD}
        >
            {onRemove && (
                <button
                    type="button"
                    aria-label={`Remove ${run.symbol} from watchlist`}
                    title="Remove from watchlist"
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); onRemove(); }}
                    className="absolute right-1.5 top-1.5 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-[var(--surface-canvas)] text-[var(--ink-tertiary)] transition-colors hover:text-[var(--ink-primary)]"
                >
                    <X size={13} />
                </button>
            )}
            <div className="glass-hover-body flex w-full flex-col gap-2">
                {/* The chart takes every pixel to the right of the logo (pr-9
                    keeps it clear of the remove button); the % change sits on
                    the name line below so it can never squeeze the chart. */}
                <div className="flex items-center gap-2 pr-9">
                    <TickerLogo symbol={run.symbol} size={56} />
                    {spark && <SparkSvg spark={spark} />}
                </div>
                <div className="flex items-center gap-1.5 pr-5">
                    <span className="min-w-0 flex-1 truncate font-app-body text-[14px] font-light leading-tight text-[var(--ink-primary)]">
                        {run.share_name || run.symbol}
                    </span>
                    {spark && <SparkChange spark={spark} />}
                    {run.source && <span className="shrink-0 text-[13px] leading-none">{flag(run.source)}</span>}
                </div>
                <div className="flex flex-col gap-1 pt-1">
                    {run.agents.length === 0 && (
                        <span className="font-app-body text-[12px] font-normal text-[var(--ink-tertiary)]">No runs yet</span>
                    )}
                    {run.agents.map((a, i) => (
                        <div key={i} className="flex items-center gap-2">
                            <AgentAvatar agent={a.agent || "Agent"} size={24} />
                            <span className="min-w-0 flex-1 truncate font-app-body text-[12px] font-normal text-[var(--ink-secondary)]">
                                {a.agent}
                            </span>
                            {a.verdict && (
                                <span
                                    className="shrink-0 font-app-body text-[12px] font-normal"
                                    style={{ color: verdictColor(a.verdict) || "var(--ink-primary)" }}
                                >
                                    {a.verdict}
                                </span>
                            )}
                            <span className="w-14 shrink-0 text-right font-app-body text-[11px] font-normal text-[var(--ink-tertiary)]">
                                {a.when}
                            </span>
                        </div>
                    ))}
                </div>
            </div>
            <OpenCue />
        </Link>
    );
}

/** Named watchlists, switched with the same pill-tab strip the analysis
 *  result page uses. Lists live in SQLite (/watchlists); card data is joined
 *  from the runs already loaded on this page. */
function WatchlistSection({ runs }: { runs: any[] }) {
    const [lists, setLists] = useState<WatchlistRow[]>([]);
    const [activeId, setActiveId] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(false);
    // StrictMode runs this effect twice; a ref keeps the second run from
    // racing the first and creating two empty default lists.
    const bootstrapped = useRef(false);
    const [editor, setEditor] = useState<{ kind: "create" } | { kind: "rename"; id: string } | null>(null);
    const [nameDraft, setNameDraft] = useState("");
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [adding, setAdding] = useState(false);
    const [viewMode, setViewMode] = useState<"cards" | "table">("cards");
    const [query, setQuery] = useState("");
    const [results, setResults] = useState<StockRow[]>([]);
    const [searching, setSearching] = useState(false);
    const searchRef = useRef<HTMLDivElement>(null);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const abortRef = useRef<AbortController | null>(null);

    const active = lists.find((l) => l.id === activeId) || lists[0];

    useEffect(() => {
        if (bootstrapped.current) return;
        bootstrapped.current = true;
        (async () => {
            setLoading(true);
            setLoadError(false);
            try {
                let rows = await WatchlistService.list();

                // One-time import of the pre-SQLite watchlist (symbols only).
                const legacy = legacyWatchSymbols();
                if (legacy.length) {
                    const items = legacy.map((symbol) => ({ symbol }));
                    if (rows.length) {
                        if (!rows.some((r) => r.items.length)) {
                            const updated = await WatchlistService.update(rows[0].id, { items });
                            rows = rows.map((r) => (r.id === updated.id ? updated : r));
                        }
                    } else {
                        rows = [await WatchlistService.create("My Watchlist", items)];
                    }
                    try { localStorage.removeItem(LEGACY_WATCH_KEY); } catch { /* private mode */ }
                }

                // Earlier bootstrap could create two empty defaults in one
                // mount. Hide the extra ones before the user can click them,
                // then delete them in the background.
                const emptyDefaults = rows.filter((r) => r.name === "My Watchlist" && r.items.length === 0);
                const duplicates = emptyDefaults.slice(1);
                if (!rows.length) rows = [await WatchlistService.create("My Watchlist")];
                rows = rows.filter((r) => !duplicates.some((d) => d.id === r.id));
                setLists(rows);
                setActiveId(rows[0].id);
                for (const dup of duplicates) void WatchlistService.delete(dup.id).catch(() => {});
            } catch {
                // Never read a failed request as "no watchlists" — that looks
                // exactly like the data disappeared.
                setLoadError(true);
            } finally {
                setLoading(false);
            }
        })();
    }, []);

    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (searchRef.current && !searchRef.current.contains(e.target as Node)) setAdding(false);
        };
        document.addEventListener("mousedown", handler);
        return () => document.removeEventListener("mousedown", handler);
    }, []);

    // Same debounced /stocks/search as the navbar picker.
    useEffect(() => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        abortRef.current?.abort();
        const q = query.trim();
        if (!q) { setResults([]); setSearching(false); return; }
        debounceRef.current = setTimeout(async () => {
            setSearching(true);
            const controller = new AbortController();
            abortRef.current = controller;
            try {
                const res = await fetch(`${API_BASE}/stocks/search?${new URLSearchParams({ query: q })}`, { signal: controller.signal });
                const data = await res.json();
                if (!controller.signal.aborted) setResults(Array.isArray(data) ? data : []);
            } catch {
                if (!controller.signal.aborted) setResults([]);
            } finally {
                if (!controller.signal.aborted) setSearching(false);
            }
        }, 300);
        return () => clearTimeout(debounceRef.current);
    }, [query]);

    const replace = (row: WatchlistRow) =>
        setLists((prev) => prev.map((l) => (l.id === row.id ? row : l)));

    // One inline editor serves both create and rename, and sits in the same
    // row as the Add watchlist button.
    const startCreate = () => { setNameDraft(""); setEditor({ kind: "create" }); };
    const startRename = () => {
        if (!active) return;
        setNameDraft(active.name);
        setEditor({ kind: "rename", id: active.id });
    };

    const saveName = async () => {
        const name = nameDraft.trim();
        if (!name) return;
        try {
            if (editor?.kind === "create") {
                const row = await WatchlistService.create(name);
                setLists((prev) => [...prev, row]);
                setActiveId(row.id);
            } else if (editor?.kind === "rename") {
                replace(await WatchlistService.update(editor.id, { name }));
            }
        } catch (e: any) {
            toaster.create({ title: "Couldn't save watchlist", description: e?.message, type: "error" });
        }
        setEditor(null); setNameDraft("");
    };

    const removeList = async () => {
        setConfirmDelete(false);
        if (!active) return;
        try {
            await WatchlistService.delete(active.id);
            const remaining = lists.filter((l) => l.id !== active.id);
            setLists(remaining);
            setActiveId(remaining[0]?.id || null);
        } catch (e: any) {
            toaster.create({ title: "Couldn't delete watchlist", description: e?.message, type: "error" });
        }
    };

    const saveItems = async (items: WatchlistItem[]) => {
        if (!active) return;
        try { replace(await WatchlistService.update(active.id, { items })); }
        catch (e: any) {
            const status = e?.response?.status;
            toaster.create({
                title: "Couldn't update watchlist",
                description: status ? `Server returned ${status}. Try again in a moment.` : "The change wasn't saved. Try again in a moment.",
                type: "error",
            });
        }
    };

    const addStock = (stock: StockRow) => {
        const symbol = stock.ticker || stock.SYMBOL || "";
        if (!symbol || !active) return;
        if (!active.items.some((i) => i.symbol === symbol)) {
            void saveItems([...active.items, {
                symbol,
                source: String(stock.source || "").toUpperCase(),
                name: stock.name || stock.NAME,
            }]);
        }
        setAdding(false); setQuery(""); setResults([]);
    };

    // Cards show at most three agents; the table needs every agent so its
    // columns cover the whole list. `agentLimit = 0` means no cap.
    const cardsFor = (list: WatchlistRow, agentLimit = 3): RunCardData[] => list.items.map((item) => {
        const rs = runs.filter((r) => r.symbol === item.symbol)
            .sort((x, y) => +new Date(y.created_at) - +new Date(x.created_at));
        const agents: RunCardAgent[] = [];
        const seen = new Set<string>();
        for (const r of rs) {
            const a = r.agent_name || r.agent || "Agent";
            if (seen.has(a)) continue;
            seen.add(a);
            agents.push({ agent: a, verdict: r.verdict || r.status, when: timeAgo(r.created_at) });
            if (agentLimit && agents.length >= agentLimit) break;
        }
        return {
            symbol: item.symbol,
            share_name: rs[0]?.share_name || item.name || item.symbol,
            source: item.source || rs[0]?.source,
            agents,
            id: rs[0]?.id || rs[0]?.analysis_id,
        };
    });

    const agentName = (a: RunCardAgent) => a.agent || "Agent";
    const runHref = (card: RunCardData) => card.id
        ? `/analysis-result/${card.id}`
        : `/stock/${encodeURIComponent(card.symbol)}?source=${encodeURIComponent(card.source || "")}`;

    const addStockBox = (
        // Plain grid cell: the tile is exactly one card wide, never a full row.
        <div ref={searchRef} className="w-full">
            {!adding ? (
                <button
                    type="button" onClick={() => setAdding(true)}
                    className="flex h-full min-h-[140px] w-full flex-col items-center justify-center gap-2 rounded-[10px] border border-dashed border-[var(--hairline)] text-[var(--ink-tertiary)] transition-colors hover:border-[var(--ink-tertiary)] hover:text-[var(--ink-primary)]"
                >
                    <Plus size={20} />
                    <span className="font-app-body text-[13px]">{active?.items.length ? "Add stock" : "Add your first stock"}</span>
                </button>
            ) : (
                <div className="relative">
                    <Search size={14} className="pointer-events-none absolute left-2.5 top-2.5 text-[var(--ink-tertiary)]" />
                    <input
                        autoFocus value={query}
                        onChange={(e) => { setQuery(e.target.value); }}
                        placeholder="Search stocks…" aria-label="Search stocks to add"
                        role="combobox" aria-expanded={query.trim() !== ""}
                        className="h-9 w-full rounded-[6px] border border-[var(--hairline)] bg-[var(--surface-recessed)] pl-8 pr-2.5 font-[family-name:var(--font-body)] text-[13px] text-[var(--ink-primary)] outline-none focus:border-[var(--ink-tertiary)]"
                    />
                    {query.trim() !== "" && (
                        <div role="listbox" aria-label="Stock results" className="listbox-panel absolute left-0 top-[calc(100%+6px)] z-50 max-h-[280px] w-72 max-w-full overflow-y-auto rounded-[6px] border border-[var(--hairline)] bg-[var(--surface-canvas)] py-1 shadow-[0_8px_24px_rgba(0,0,0,0.12)]">
                            {searching && (
                                <div className="px-3 py-2.5 font-[family-name:var(--font-body)] text-xs text-[var(--ink-tertiary)]">Searching…</div>
                            )}
                            {!searching && results.length === 0 && (
                                <div className="px-3 py-2.5 font-[family-name:var(--font-body)] text-xs text-[var(--ink-tertiary)]">
                                    Nothing matches “{query}”.
                                </div>
                            )}
                            {!searching && results.map((stock) => {
                                const sym = stock.ticker || stock.SYMBOL || "";
                                const india = String(stock.source || "").toLowerCase() === "nse";
                                return (
                                    <DropdownItem
                                        key={`${stock.source}-${sym}`}
                                        label={stock.name || stock.NAME || sym}
                                        sub={`${india ? "🇮🇳" : "🇺🇸"} ${india ? "NSE" : "SEC"}:${sym}`}
                                        logo={<TickerLogo symbol={sym} size={18} />}
                                        onClick={() => addStock(stock)}
                                    />
                                );
                            })}
                        </div>
                    )}
                </div>
            )}
        </div>
    );

    const tableRows = active ? cardsFor(active, 0) : [];
    const agentColumns = Array.from(new Set(tableRows.flatMap((row) => row.agents.map(agentName))))
        .sort((a, b) => a.localeCompare(b));

    return (
        <section className="pb-12">
            {/* Title on its own line; tabs, picker and actions share the next
                one — a narrow column can't hold them all in a single row. */}
            <div className="flex flex-col gap-2.5">
                <h2 className={SECTION_TITLE}>Watchlist</h2>

                <div className="flex flex-wrap items-center gap-3">
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                        {loading ? (
                        <div role="status" aria-label="Loading watchlists" className="flex h-8 items-center gap-2 text-[var(--ink-tertiary)]">
                            <Loader2 size={16} className="animate-spin" />
                            <span className="font-app-body text-[13px]">Loading watchlists…</span>
                        </div>
                    ) : (
                        <>
                            {/* Thin scrollbar appears only once the tabs overflow. */}
                            <div role="tablist" aria-label="Watchlists" className="flex min-w-0 items-center gap-1 overflow-x-auto pb-1 [scrollbar-width:thin] [&::-webkit-scrollbar]:h-1 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[var(--hairline)]">
                                {lists.map((l) => (
                                    <button
                                        key={l.id} type="button" role="tab" aria-selected={active?.id === l.id}
                                        onClick={() => { setActiveId(l.id); setAdding(false); }}
                                        className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[6px] px-3 py-2 text-[13px] font-normal transition-colors ${active?.id === l.id ? "bg-[var(--surface-recessed)] text-[var(--ink-primary)]" : "text-[var(--ink-tertiary)] hover:text-[var(--ink-primary)]"}`}
                                    >
                                        <List size={13} aria-hidden="true" />{l.name} ({l.items.length})
                                    </button>
                                ))}
                            </div>

                            {/* Inline name editor — sits exactly where Add watchlist was clicked. */}
                            {editor ? (
                                <div className="flex shrink-0 items-center gap-1.5">
                                    <input
                                        autoFocus value={nameDraft} onChange={(e) => setNameDraft(e.target.value)}
                                        onKeyDown={(e) => {
                                            if (e.key === "Enter") void saveName();
                                            if (e.key === "Escape") { setEditor(null); setNameDraft(""); }
                                        }}
                                        placeholder="Watchlist name" aria-label="Watchlist name"
                                        className="h-8 w-48 rounded-[6px] border border-[var(--hairline)] bg-[var(--surface-recessed)] px-2.5 font-[family-name:var(--font-body)] text-[13px] text-[var(--ink-primary)] outline-none focus:border-[var(--ink-tertiary)]"
                                    />
                                    <button
                                        type="button" onClick={() => void saveName()} disabled={!nameDraft.trim()}
                                        className="h-8 rounded-[6px] bg-[var(--surface-raised)] px-3 font-app-body text-[13px] text-[var(--ink-primary)] transition-colors hover:bg-[var(--surface-raised-hover)] disabled:cursor-not-allowed disabled:opacity-40"
                                    >
                                        {editor.kind === "create" ? "Create" : "Save"}
                                    </button>
                                    <button
                                        type="button" aria-label="Cancel" onClick={() => { setEditor(null); setNameDraft(""); }}
                                        className="flex h-8 w-8 items-center justify-center rounded-[6px] text-[var(--ink-tertiary)] hover:text-[var(--ink-primary)]"
                                    >
                                        <X size={14} />
                                    </button>
                                </div>
                            ) : (
                                <button
                                    type="button" onClick={startCreate} aria-label="Add watchlist"
                                    className="flex h-8 shrink-0 items-center gap-1.5 rounded-[6px] px-2 text-[13px] font-normal text-[var(--ink-secondary)] transition-colors hover:bg-[var(--surface-recessed)] hover:text-[var(--ink-primary)]"
                                >
                                    <Plus size={15} /> Add watchlist
                                </button>
                            )}
                        </>
                    )}
                </div>

                {!loading && active && (
                    <div className="flex shrink-0 items-center gap-1.5">
                        {/* Card grid or agent matrix — same data, two views. */}
                        <ToggleGroup
                            type="single" value={viewMode}
                            onValueChange={(v) => { if (v === "cards" || v === "table") setViewMode(v); }}
                            aria-label="Watchlist view"
                            className="h-8 shrink-0 gap-1 rounded-xl border-0 bg-console-recessed p-1"
                        >
                            <ToggleGroupItem
                                value="cards" aria-label="Card view" title="Card view"
                                className="h-6 w-7 flex-none rounded-[8px] border-0 px-0 text-console-ink-3 hover:bg-console-surface/60 hover:text-console-ink data-[state=on]:bg-console-surface data-[state=on]:text-console-ink data-[state=on]:shadow-none"
                            >
                                <LayoutGrid className="size-3.5" aria-hidden="true" />
                            </ToggleGroupItem>
                            <ToggleGroupItem
                                value="table" aria-label="Table view" title="Table view"
                                className="h-6 w-7 flex-none rounded-[8px] border-0 px-0 text-console-ink-3 hover:bg-console-surface/60 hover:text-console-ink data-[state=on]:bg-console-surface data-[state=on]:text-console-ink data-[state=on]:shadow-none"
                            >
                                <Table2 className="size-3.5" aria-hidden="true" />
                            </ToggleGroupItem>
                        </ToggleGroup>
                        <button
                            type="button" onClick={startRename} aria-label="Rename watchlist" title="Rename watchlist"
                            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] text-[var(--ink-tertiary)] transition-colors hover:bg-[var(--surface-recessed)] hover:text-[var(--ink-primary)]"
                        >
                            <Pencil size={14} />
                        </button>
                        <button
                            type="button" onClick={() => setConfirmDelete(true)} aria-label="Delete watchlist" title="Delete watchlist"
                            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] text-[var(--signal-negative)] transition-colors hover:bg-[var(--surface-recessed)]"
                        >
                            <Trash2 size={14} />
                        </button>
                    </div>
                )}
                </div>
            </div>

            {loadError && !loading && (
                <p role="alert" className="mt-2 font-app-body text-[13px] text-[var(--signal-negative)]">
                    Couldn't load your watchlists. Refresh to retry.
                </p>
            )}

            {active && (viewMode === "cards" ? (
                // Grid, not flex-wrap: every cell (cards AND the add tile) is
                // exactly one card wide, full rows reach both edges, and the
                // add tile can never become a 4th column — 3 max, at any width.
                <div className="mt-3 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3">
                    {cardsFor(active).map((card) => (
                        <RunCard
                            key={`${card.symbol}-${card.source || ""}`} run={card}
                            onRemove={() => void saveItems(active.items.filter((i) => i.symbol !== card.symbol))}
                        />
                    ))}
                    {addStockBox}
                </div>
            ) : (
                <>
                    {tableRows.length > 0 ? (
                        <div className="mt-3 w-full overflow-x-auto">
                            <table className="w-full min-w-[640px] border-collapse text-left">
                                <thead>
                                    <tr className="border-b border-[var(--hairline)]">
                                        <th scope="col" className="px-2.5 py-2 font-app-body text-[10px] font-semibold tracking-[0.1em] text-[var(--ink-tertiary)] uppercase">Stock</th>
                                        <th scope="col" className="px-2.5 py-2 font-app-body text-[10px] font-semibold tracking-[0.1em] text-[var(--ink-tertiary)] uppercase">Chart</th>
                                        {agentColumns.map((agent) => (
                                            <th key={agent} scope="col" className="whitespace-nowrap px-2.5 py-2 font-app-body text-[10px] font-semibold tracking-[0.1em] text-[var(--ink-tertiary)] uppercase">
                                                <span className="flex items-center gap-1.5">
                                                    <AgentAvatar agent={agent} size={18} />
                                                    {agent}
                                                </span>
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {tableRows.map((row) => (
                                        <tr key={`${row.symbol}-${row.source || ""}`} className="border-b border-[var(--hairline)] transition-colors hover:bg-[var(--surface-recessed)]">
                                            <th scope="row" className="px-2.5 py-2 align-middle">
                                                <div className="flex items-center gap-2">
                                                    <Link
                                                        to={runHref(row)} target="_blank" rel="noreferrer" data-solid=""
                                                        className="flex min-w-0 items-center gap-2 hover:opacity-80"
                                                    >
                                                        <TickerLogo symbol={row.symbol} size={28} />
                                                        <span className="min-w-0 truncate font-app-body text-[13px] font-medium text-[var(--ink-primary)]">{row.share_name || row.symbol}</span>
                                                        {row.source && <span className="shrink-0 text-[13px] leading-none">{flag(row.source)}</span>}
                                                    </Link>
                                                    <button
                                                        type="button"
                                                        aria-label={`Remove ${row.symbol} from watchlist`}
                                                        title="Remove from watchlist"
                                                        onClick={() => void saveItems(active.items.filter((i) => i.symbol !== row.symbol))}
                                                        className="shrink-0 text-[var(--ink-tertiary)] transition-colors hover:text-[var(--ink-primary)]"
                                                    >
                                                        <X size={12} />
                                                    </button>
                                                </div>
                                            </th>
                                            <td className="w-40 px-2.5 py-2 align-middle">
                                                <MiniSpark symbol={row.symbol} source={row.source} />
                                            </td>
                                            {agentColumns.map((agent) => {
                                                const hit = row.agents.find((a) => agentName(a) === agent);
                                                return (
                                                    <td key={agent} className="whitespace-nowrap px-2.5 py-2 align-middle">
                                                        {hit ? (
                                                            <span className="flex items-center gap-2">
                                                                <span className="font-app-body text-[13px] font-normal" style={{ color: verdictColor(hit.verdict) || "var(--ink-primary)" }}>
                                                                    {hit.verdict || "Run"}
                                                                </span>
                                                                <span className="font-app-body text-[11px] font-normal text-[var(--ink-tertiary)]">{hit.when}</span>
                                                            </span>
                                                        ) : (
                                                            <span className="font-app-body text-[13px] text-[var(--ink-tertiary)]">-</span>
                                                        )}
                                                    </td>
                                                );
                                            })}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ) : (
                        <p className="mt-4 font-app-body text-[13px] text-[var(--ink-tertiary)]">No stocks in this watchlist yet — add one below.</p>
                    )}
                    <div className="mt-3">{addStockBox}</div>
                </>
            ))}


            <ConfirmDialog
                open={confirmDelete}
                title="Delete watchlist?"
                message={active
                    ? `“${active.name}” and its ${active.items.length} stock${active.items.length === 1 ? "" : "s"} will be permanently removed.`
                    : "This watchlist will be permanently removed."}
                onCancel={() => setConfirmDelete(false)}
                onConfirm={() => void removeList()}
            />
        </section>
    );
}

export default function HomePage() {
    // Hero: cap the paragraph to the tagline's rendered width so both
    // blocks share the same right edge at every viewport. The tagline is
    // w-fit, so its border box IS its text width; a ResizeObserver tracks it.
    const titleRef = useRef<HTMLHeadingElement>(null);
    const [titleWidth, setTitleWidth] = useState<number | undefined>();
    useLayoutEffect(() => {
        const el = titleRef.current;
        if (!el) return;
        const ro = new ResizeObserver(() => setTitleWidth(el.getBoundingClientRect().width));
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    const [schedules, setSchedules] = useState<ScheduleRow[]>([]);
    const [runs, setRuns] = useState<any[]>([]);
    const [agents, setAgents] = useState<any[]>([]);

    useEffect(() => {
        Promise.allSettled([AnalysisService.listSchedules(), AnalysisService.listAnalyses(), AgentService.listAgents()])
            .then(([s, r, a]) => {
                if (s.status === "fulfilled" && Array.isArray(s.value)) setSchedules(s.value);
                if (r.status === "fulfilled" && Array.isArray(r.value)) setRuns(r.value);
                if (a.status === "fulfilled" && Array.isArray(a.value)) setAgents(a.value);
            });
    }, []);

    // Active agents: one card per schedule, shown in two columns. Last run is
    // matched by agent name (run rows carry no agent_id).
    const activeCards = schedules.map((s) => {
        const agent = agents.find((a) => (a._id || a.id) === s.agent_id) || null;
        const name = agent?.name;
        const last = name
            ? runs
                  .filter((r) => (r.agent_name || r.agent) === name)
                  .sort((x, y) => +new Date(y.created_at) - +new Date(x.created_at))[0] || null
            : null;
        return { schedule: s, agent, last };
    });

    const latest = [...runs]
        .sort((x, y) => +new Date(y.created_at) - +new Date(x.created_at))
        .slice(0, 4)
        .map((r) => ({
            id: r.id || r.analysis_id || "",
            symbol: r.symbol || "",
            share_name: r.share_name || "",
            source: r.source,
            agent: r.agent_name || r.agent || undefined,
            verdict: r.verdict || r.status,
            when: timeAgo(r.created_at),
        }));

    return (
        <div className="min-h-full bg-[var(--surface-canvas)] text-[var(--ink-primary)]">
            <div>
                {/* Two columns: tagline → active agents → latest runs on the
                    left, watchlist (min two cards wide) on the right. Below lg
                    they stack in reading order, text first. */}
                <div className="flex flex-wrap items-start gap-x-10 gap-y-10 pt-7">
                    {/* Right column — watchlist, always room for two cards. */}
                    <div className="order-2 w-full min-w-0 flex-1 lg:min-w-[464px]">
                        {/* Watchlist — named lists with pill-tab switching */}
                        <WatchlistSection runs={runs} />
                    </div>

                    {/* ponytail: fixed left rail — 360px leaves the watchlist
                        600px+ from 1024 up; 440px from 1280. */}
                    <div className="order-1 flex w-full flex-col gap-12 pb-12 lg:w-[360px] lg:shrink-0 xl:w-[440px]">
                        <div>
                            <h1 ref={titleRef} className="w-fit max-w-full font-[family-name:var(--font-display)] text-[clamp(1.5rem,3vw,2rem)] leading-none font-light tracking-[-0.02em] text-[var(--ink-primary)]">
                                Agents watch the market, you watch the agents.
                            </h1>
                            <p style={{ maxWidth: titleWidth }} className="mt-3 text-sm font-[family-name:var(--font-body)] font-[200] text-[var(--ink-secondary)] leading-relaxed">
                                Relativity agents evaluate stocks and markets against a specific investment thesis. Every agent's reasoning and verdict is supported by citations to official data sources.
                            </p>
                        </div>

                        {/* Active Agents */}
                        <HomeSection
                            title="Active Agents"
                            empty={activeCards.length === 0}
                            emptyTo="/new-analysis"
                            emptyIcon={Clock}
                            emptyLabel="Schedule an agent run"
                        >
                            {activeCards.length > 0 && (
                                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
                                    {activeCards.map(({ schedule: s, agent, last }) => {
                                        const verdict = last ? (last.verdict || last.status || "") : "";
                                        const vColor = verdictColor(verdict);
                                        return (
                                        <Link
                                            key={s.id}
                                            to="/new-analysis"
                                            target="_blank"
                                            rel="noreferrer"
                                            data-solid=""
                                            className={CARD}
                                        >
                                            {/* Header: avatar, who + what it runs on, verdict chip. */}
                                            <div className="glass-hover-body flex w-full flex-col">
                                                <div className="flex items-center gap-3">
                                                    <AgentAvatar
                                                        agent={agent?.name || s.agent_id || "Agent"}
                                                        size={64}
                                                        label={agent?.name}
                                                    />
                                                    <div className="min-w-0 flex-1 py-2.5">
                                                        <div className="truncate font-app-body text-[15px] font-light leading-tight text-[var(--ink-primary)]">
                                                            {agent?.name || s.agent_id || "Scheduled agent"}
                                                        </div>
                                                        <div className="mt-1 truncate font-app-body text-[11px] font-normal text-[var(--ink-tertiary)]">
                                                            {s.symbol
                                                                ? `Runs on ${flag(s.source)} ${s.symbol} · ${String(s.source).toUpperCase() === "NSE" ? "Indian equities" : "US equities"}`
                                                                : "General"}
                                                        </div>
                                                    </div>
                                                    {verdict && (
                                                        <span
                                                            className="mr-3 shrink-0 rounded-full px-2 py-0.5 font-app-body text-[11px] font-medium"
                                                            style={{
                                                                color: vColor || "var(--ink-secondary)",
                                                                background: `color-mix(in srgb, ${vColor || "var(--ink-secondary)"} 14%, transparent)`,
                                                            }}
                                                        >
                                                            {verdict}
                                                        </span>
                                                    )}
                                                </div>
                                                {/* Footer: schedule and last run, split by a full-bleed rule. */}
                                                <div className="flex items-center justify-between gap-3 border-t border-[var(--hairline)] px-3 py-2 font-app-body text-[11px] font-normal text-[var(--ink-tertiary)]">
                                                    <span
                                                        className="flex min-w-0 items-center gap-1.5 truncate"
                                                        title={`Daily ${s.time} (${s.timezone})`}
                                                    >
                                                        <Clock size={12} className="shrink-0" aria-hidden="true" />
                                                        Daily {s.time} ({s.timezone})
                                                    </span>
                                                    <span className="shrink-0">
                                                        {last ? `Last run ${timeAgo(last.created_at)}` : "No runs yet"}
                                                    </span>
                                                </div>
                                            </div>
                                            <OpenCue />
                                        </Link>
                                        );
                                    })}
                                </div>
                            )}
                        </HomeSection>

                    {/* Latest runs — small vertical cards, last one is View all */}
                    <HomeSection
                        title="Latest runs"
                        empty={latest.length === 0}
                        emptyTo="/new-analysis"
                        emptyIcon={Play}
                        emptyLabel="New agent run"
                    >
                        {latest.length > 0 && (
                            <div className="flex flex-wrap gap-3">
                                {latest.map((run, i) => {
                                    // ponytail: breakpoints instead of a resize observer —
                                    // 3 cards on phones, 4 on tablets, 5 on desktop.
                                    const hide = i >= 3 ? "hidden lg:block" : i >= 2 ? "hidden sm:block" : "";
                                    return (
                                        <Link
                                            key={run.id}
                                            to={run.id ? `/analysis-result/${run.id}` : "/analysis-list"}
                                            target="_blank"
                                            rel="noreferrer"
                                            data-solid=""
                                            className={`${CARD} w-14 shrink-0 ${hide}`}
                                        >
                                            <div className="glass-hover-body flex flex-col gap-1.5">
                                                <TickerLogo symbol={run.symbol} size={56} />
                                                <div className="flex items-center gap-1">
                                                    <span className="min-w-0 flex-1 truncate font-app-body text-[13px] font-light leading-tight text-[var(--ink-primary)]">
                                                        {run.share_name || run.symbol}
                                                    </span>
                                                    {run.source && <span className="shrink-0 text-[12px] leading-none">{flag(run.source)}</span>}
                                                </div>
                                                <div className="truncate font-app-body text-[11px] font-normal text-[var(--ink-tertiary)]">
                                                    {run.agent}
                                                </div>
                                                <div className="flex flex-col gap-0.5 pt-0.5">
                                                    {run.verdict && (
                                                        <span
                                                            className="font-app-body text-[11px] font-normal leading-tight"
                                                            style={{ color: verdictColor(run.verdict) || "var(--ink-primary)" }}
                                                        >
                                                            {run.verdict}
                                                        </span>
                                                    )}
                                                    <span className="font-app-body text-[10px] font-normal text-[var(--ink-tertiary)]">{run.when}</span>
                                                </div>
                                            </div>
                                            <OpenCue />
                                        </Link>
                                    );
                                })}

                                {/* View all — past runs page */}
                                <Link
                                    to="/analysis-list"
                                    target="_blank"
                                    rel="noreferrer"
                                    data-solid=""
                                    className={`${CARD} w-14 shrink-0`}
                                >
                                    <div className="glass-hover-body flex flex-col gap-1.5">
                                        <span className="flex h-14 w-14 items-center justify-center rounded-[8px] bg-[var(--surface-raised)]">
                                            <ArrowRight size={22} />
                                        </span>
                                        <div className="truncate font-app-body text-[13px] font-light leading-tight text-[var(--ink-primary)]">View all</div>
                                        <div className="truncate font-app-body text-[11px] font-normal text-[var(--ink-tertiary)]">Past runs</div>
                                    </div>
                                    <OpenCue />
                                </Link>
                            </div>
                        )}
                    </HomeSection>
                    </div>
                </div>

                {/* Footer */}
                <footer className="py-8 border-t border-[var(--hairline)]">
                    <div className="grid grid-cols-3 gap-6 text-sm">
                        <div>
                            <h4 className="text-xs uppercase tracking-[0.08em] text-[var(--ink-tertiary)] mb-3">Product</h4>
                            <div className="space-y-2 text-[var(--ink-secondary)]">
                                <Link to="/new-analysis" className="block hover:text-[var(--ink-primary)]">New Analysis</Link>
                                <Link to="/analysis-list" className="block hover:text-[var(--ink-primary)]">Runs</Link>
                                <Link to="/agents" className="block hover:text-[var(--ink-primary)]">Agents</Link>
                            </div>
                        </div>
                        <div>
                            <h4 className="text-xs uppercase tracking-[0.08em] text-[var(--ink-tertiary)] mb-3">Company</h4>
                            <div className="space-y-2 text-[var(--ink-secondary)]">
                                <Link to="/privacy" className="block hover:text-[var(--ink-primary)]">Privacy</Link>
                                <Link to="/terms" className="block hover:text-[var(--ink-primary)]">Terms</Link>
                            </div>
                        </div>
                        <div>
                            <h4 className="text-xs uppercase tracking-[0.08em] text-[var(--ink-tertiary)] mb-3">Resources</h4>
                            <div className="space-y-2 text-[var(--ink-secondary)]">
                                <Link to="/analysis-list" className="block hover:text-[var(--ink-primary)]">My Workspace</Link>
                                <Link to="/settings" className="block hover:text-[var(--ink-primary)]">Settings</Link>
                            </div>
                        </div>
                    </div>
                    <p className="text-xs text-[var(--ink-tertiary)] text-center mt-8">
                        Not investment advice or no trade calls. Relativity is a research tool.
                    </p>
                </footer>
            </div>
        </div>
    );
}
