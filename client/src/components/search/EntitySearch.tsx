/**
 * EntitySearch — the TradingView-style symbol search used by the navbar and
 * the New Run entity picker.
 *
 * Tabs (Symbols | Plugins | Runs), filter pills (All/Stocks/Sectors/…), and
 * rows that mirror the TV anatomy: 32px logo · ticker · type tag · full name,
 * with the change badge + exchange name + exchange mark on the right.
 * Empty query shows Recent searches (localStorage) or a Popular seed — the
 * dropdown never opens dead.
 *
 * `hotkey` wires Ctrl/Cmd+K (navbar only — the New Run form omits it).
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Search, X } from "lucide-react";
import {
    AnalysisService,
    PluginService,
    TaxonomyService,
    fetchQuoteChanges,
    type EntityHit,
    type EntityLevel,
    type PluginSummary,
} from "@/db";
import { TickerLogo, SourceMark, FlagLogo } from "@/lib/sourceLogos";
import { cn } from "@/lib/utils";
import nseIndicesLogo from "@/assets/nse_indices_logo.svg";

export type EntityPick =
    | { kind: "stock"; symbol: string; source: string; name: string; exchange?: string }
    | { kind: "group"; key: string; name: string }
    | { kind: "plugin"; id: string; name: string }
    | { kind: "run"; id: string; label: string };

const RECENTS_KEY = "rel.search.recent.v1";
const RECENTS_MAX = 8;

function loadRecents(): EntityHit[] {
    try {
        const raw = JSON.parse(localStorage.getItem(RECENTS_KEY) || "[]");
        return Array.isArray(raw) ? raw : [];
    } catch {
        return [];
    }
}

const hitId = (h: EntityHit) => (h.type === "group" ? `group:${h.key}` : `stock:${h.source}:${h.symbol}`);

function recordRecent(hit: EntityHit): EntityHit[] {
    const next = [hit, ...loadRecents().filter((r) => hitId(r) !== hitId(hit))].slice(0, RECENTS_MAX);
    localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
    return next;
}

function removeRecent(id: string): EntityHit[] {
    const next = loadRecents().filter((r) => hitId(r) !== id);
    localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
    return next;
}

/** Popular seed when there is no history — static, no backend round trip. */
const POPULAR: EntityHit[] = [
    { type: "stock", symbol: "RELIANCE", name: "Reliance Industries Limited", source: "NSE", exchange: "NSE" },
    { type: "stock", symbol: "TCS", name: "Tata Consultancy Services Limited", source: "NSE", exchange: "NSE" },
    { type: "stock", symbol: "HDFCBANK", name: "HDFC Bank Limited", source: "NSE", exchange: "NSE" },
    { type: "stock", symbol: "AAPL", name: "Apple Inc.", source: "SEC", exchange: "NASDAQ" },
    { type: "stock", symbol: "MSFT", name: "Microsoft Corporation", source: "SEC", exchange: "NASDAQ" },
    { type: "stock", symbol: "NVDA", name: "NVIDIA Corporation", source: "SEC", exchange: "NASDAQ" },
];

const LEVEL_LABEL: Record<EntityLevel, string> = {
    sector: "SECTOR",
    industry_group: "INDUSTRY GROUP",
    industry: "INDUSTRY",
    basic_industry: "BASIC INDUSTRY",
    sub_industry: "SUB-INDUSTRY",
};

/** The "logo" slot for a group row: India (NSE) groups carry the NSE Indices
 *  mark — the full wordmark for hero spots, a diamond-only crop (properly
 *  aligned at small sizes) for compact rows. US groups get the flag, the same
 *  mark the country toggle uses (no per-level icons). */
export function GroupMark({ level, market, size = 32, variant = "full" }: { level?: EntityLevel; market?: string; size?: number; variant?: "full" | "compact" }) {
    if (market?.toUpperCase() === "NSE") {
        if (variant === "compact") {
            // Left ~105 units of the 300.7-wide viewBox = the diamond alone.
            return (
                <svg
                    viewBox="0 0 104.7 130.46"
                    style={{ height: size }}
                    className="shrink-0 select-none"
                    aria-hidden="true"
                >
                    <image href={nseIndicesLogo} x="0" y="0" width="300.72" height="130.46" />
                </svg>
            );
        }
        return (
            <img
                src={nseIndicesLogo}
                alt="NSE Indices"
                title="NSE Indices"
                style={{ height: size, width: "auto" }}
                draggable={false}
                className="shrink-0 select-none"
            />
        );
    }
    // US (and any other non-NSE market): the plain country flag — no
    // per-level tinted icon.
    return <FlagLogo source={market} size={size} />;
}

/** Neutral type badge — uncolored pill, tinted muted text, static (never
 *  clickable, never vanishes on row hover: semi-transparent ink bg). */
function TypeTag({ children }: { children: ReactNode }) {
    return (
        <span
            aria-hidden="true"
            className="pointer-events-none shrink-0 select-none rounded-full bg-[color-mix(in_srgb,var(--ink-primary)_9%,transparent)] px-2 py-0.5 font-[family-name:var(--font-body)] text-[10px] font-normal tracking-[0.05em] text-[var(--ink-secondary)] uppercase"
        >
            {children}
        </span>
    );
}

/** TV's green +16% change pill. */
function ChangeBadge({ pct }: { pct: number }) {
    const up = pct >= 0;
    return (
        <span
            className={cn(
                "shrink-0 rounded-full px-1.5 py-px font-[family-name:var(--font-body)] text-[11px] font-normal tabular-nums",
                up
                    ? "bg-[color-mix(in_srgb,var(--signal-positive)_14%,transparent)] text-[var(--signal-positive-text,var(--signal-positive))]"
                    : "bg-[color-mix(in_srgb,var(--signal-negative)_14%,transparent)] text-[var(--signal-negative-text,var(--signal-negative))]",
            )}
        >
            {up ? "+" : ""}
            {pct.toFixed(1)}%
        </span>
    );
}

function Row({
    hit,
    pct,
    active,
    idx,
    querying,
    onHover,
    onPick,
    onRemove,
}: {
    hit: EntityHit;
    pct?: number;
    active: boolean;
    idx: number;
    querying: boolean;
    onHover: () => void;
    onPick: () => void;
    onRemove?: () => void;
}) {
    const isGroup = hit.type === "group";
    const title = isGroup ? hit.name : (hit.symbol || "").toUpperCase();
    return (
        <div
            id={`entity-search-opt-${idx}`}
            role="option"
            aria-selected={active}
            tabIndex={-1}
            onMouseEnter={onHover}
            onClick={onPick}
            data-testid={`entity-row-${isGroup ? "group" : "stock"}-${isGroup ? hit.key : hit.symbol}`}
            className={cn(
                "group/row flex w-full cursor-pointer items-center gap-3 rounded-[10px] px-2.5 py-2.5 text-left transition-colors",
                active && "bg-[var(--surface-recessed)]",
            )}
        >
            {isGroup ? <GroupMark level={hit.level} market={hit.source} size={hit.source === "NSE" ? 40 : 32} variant="compact" /> : <TickerLogo symbol={hit.symbol} size={32} />}
            <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                    <span
                        className={cn(
                            "truncate font-app-body text-[14.5px] font-light leading-tight",
                            querying ? "text-[var(--accent-primary)]" : "text-[var(--ink-primary)]",
                        )}
                    >
                        {title}
                    </span>
                    {isGroup ? (
                        <TypeTag>{LEVEL_LABEL[hit.level || "sector"]}</TypeTag>
                    ) : (
                        <TypeTag>STOCK</TypeTag>
                    )}
                </span>
                <span className="mt-0.5 block truncate font-[family-name:var(--font-body)] text-[12px] text-[var(--ink-tertiary)]">
                    {isGroup ? `${LEVEL_LABEL[hit.level || "sector"].toLowerCase()} · ${hit.count ?? 0} stocks` : hit.name}
                </span>
            </span>
            <span className="flex shrink-0 items-center gap-2">
                {!isGroup && pct != null && <ChangeBadge pct={pct} />}
                <span className="font-[family-name:var(--font-body)] text-[12px] text-[var(--ink-secondary)]">
                    {isGroup ? hit.source : hit.exchange || hit.source}
                </span>
                {/* One mark for every row — the source logo (NSE/SEC).
                    Flags used to show here for groups only, which read as a
                    third scheme next to the stock rows' logos. */}
                <SourceMark source={hit.source.toLowerCase() === "nse" ? "nse" : "sec"} size={14} />
                {onRemove && (
                    <button
                        type="button"
                        aria-label={`Remove ${title} from recent searches`}
                        onClick={(e) => {
                            e.stopPropagation();
                            onRemove();
                        }}
                        className="rounded-full p-0.5 text-[var(--ink-tertiary)] opacity-0 transition group-hover/row:opacity-100 hover:text-[var(--ink-primary)] focus-visible:opacity-100"
                    >
                        <X className="size-3.5" aria-hidden />
                    </button>
                )}
            </span>
        </div>
    );
}

/** Yahoo symbol for the quotes call — NSE needs the .NS suffix. */
const yahooSymbol = (h: EntityHit) => (h.source.toUpperCase() === "NSE" ? `${h.symbol}.NS` : h.symbol);

// Session cache so tab-flips don't refetch plugin/run catalogs.
const pluginCache: { list?: PluginSummary[] } = {};
const runCache: { list?: any[] } = [];

export default function EntitySearch({
    open,
    onOpenChange,
    onPick,
    placeholder = "Search company, sector, industry…",
    showTabs = true,
    hotkey = false,
    autoFocus = false,
}: {
    open: boolean;
    /** Focus opens the dropdown; outside click / Escape / ✕ close it. */
    onOpenChange: (open: boolean) => void;
    onPick: (pick: EntityPick) => void;
    placeholder?: string;
    showTabs?: boolean;
    hotkey?: boolean;
    autoFocus?: boolean;
}) {
    const [query, setQuery] = useState("");
    const [tab, setTab] = useState<"symbols" | "plugins" | "runs">("symbols");
    const [pill, setPill] = useState<"all" | "stocks" | "sectors" | "industries" | "subs">("all");
    const [hits, setHits] = useState<EntityHit[]>([]);
    const [searching, setSearching] = useState(false);
    const [recents, setRecents] = useState<EntityHit[]>([]);
    const [pcts, setPcts] = useState<Record<string, number>>({});
    const [pluginHits, setPluginHits] = useState<{ id: string; name: string }[]>([]);
    const [runHits, setRunHits] = useState<{ id: string; label: string; symbol?: string; status?: string }[]>([]);
    const [activeIdx, setActiveIdx] = useState(-1);
    const wrapRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const abortRef = useRef<AbortController | null>(null);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const listId = "entity-search"; // one live search per page — static ids are safe

    // Fresh recents each open — another tab may have written them.
    useEffect(() => {
        if (open) setRecents(loadRecents());
    }, [open]);

    // Click outside closes.
    useEffect(() => {
        if (!open) return;
        const onDown = (e: MouseEvent) => {
            if (!wrapRef.current?.contains(e.target as Node)) onOpenChange(false);
        };
        document.addEventListener("mousedown", onDown);
        return () => document.removeEventListener("mousedown", onDown);
    }, [open, onOpenChange]);

    // Ctrl/Cmd+K focuses the box — navbar only (the form omits the hotkey).
    useEffect(() => {
        if (!hotkey) return;
        const onKey = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
                e.preventDefault();
                onOpenChange(true);
                inputRef.current?.focus();
            }
        };
        document.addEventListener("keydown", onKey);
        return () => document.removeEventListener("keydown", onKey);
    }, [hotkey]);

    // Debounced entity search.
    useEffect(() => {
        if (!open || tab !== "symbols") return;
        if (debounceRef.current) clearTimeout(debounceRef.current);
        abortRef.current?.abort();
        const q = query.trim();
        setActiveIdx(-1);
        debounceRef.current = setTimeout(async () => {
            if (!q) {
                setHits([]);
                setSearching(false);
                return;
            }
            setSearching(true);
            const controller = new AbortController();
            abortRef.current = controller;
            const live = () => !controller.signal.aborted;
            try {
                const rows = await TaxonomyService.search(q, undefined, controller.signal);
                if (live()) {
                    setHits(Array.isArray(rows) ? rows : []);
                    setSearching(false);
                }
            } catch (err: any) {
                if (live() && err?.name !== "AbortError") {
                    setHits([]);
                    setSearching(false);
                }
            }
        }, 300);
        return () => {
            if (debounceRef.current) clearTimeout(debounceRef.current);
        };
    }, [query, open, tab]);

    // Second pass — change badges never block the list.
    const visibleSymbols = useMemo(() => {
        if (tab !== "symbols") return [];
        return hits.filter((h) => h.type === "stock" && h.symbol).map(yahooSymbol);
    }, [hits, tab]);
    useEffect(() => {
        if (!open || visibleSymbols.length === 0) return;
        let alive = true;
        fetchQuoteChanges(visibleSymbols.slice(0, 30))
            .then((out) => {
                if (alive && out && Object.keys(out).length) setPcts((prev) => ({ ...prev, ...out }));
            })
            .catch(() => {});
        return () => {
            alive = false;
        };
    }, [open, visibleSymbols]);

    // Plugins / Runs tabs — small stable lists, fetched once per session.
    useEffect(() => {
        if (!open || tab === "symbols") return;
        const lower = query.trim().toLowerCase();
        const match = (s: string) => s.toLowerCase().includes(lower);
        if (tab === "plugins") {
            (pluginCache.list
                ? Promise.resolve(pluginCache.list)
                : PluginService.list().then((p) => (pluginCache.list = p)))
                .then((p) =>
                    setPluginHits(
                        p
                            .filter((x) => match(`${x.display_name} ${x.description || ""}`))
                            .slice(0, 10)
                            .map((x) => ({ id: x.id, name: x.display_name })),
                    ),
                )
                .catch(() => setPluginHits([]));
        } else {
            (runCache.list
                ? Promise.resolve(runCache.list)
                : AnalysisService.listAnalyses().then((rows) => {
                      runCache.list = Array.isArray(rows) ? rows : [];
                      return runCache.list;
                  }))
                .then((rows) =>
                    setRunHits(
                        rows
                            .filter((a: any) => match(`${a.share_name || ""} ${a.symbol || ""} ${a.model || ""}`))
                            .slice(0, 10)
                            .map((a: any) => ({
                                id: String(a.analysis_id || a._id || a.id || ""),
                                label: a.share_name || a.symbol || "Run",
                                status: a.status ? String(a.status) : undefined,
                            })),
                    ),
                )
                .catch(() => setRunHits([]));
        }
    }, [open, tab, query]);

    const pick = useCallback(
        (target: EntityPick) => {
            onOpenChange(false);
            setQuery("");
            setActiveIdx(-1);
            onPick(target);
        },
        [onOpenChange, onPick],
    );

    const pickEntity = useCallback(
        (hit: EntityHit) => {
            setRecents(recordRecent(hit));
            pick(
                hit.type === "group"
                    ? { kind: "group", key: hit.key!, name: hit.name }
                    : { kind: "stock", symbol: hit.symbol!, source: hit.source, name: hit.name, exchange: hit.exchange },
            );
        },
        [pick],
    );

    // ── Visible rows ─────────────────────────────────────────────────────────
    const querying = query.trim() !== "";
    const filteredRows: EntityHit[] = useMemo(() => {
        if (!querying) return [];
        switch (pill) {
            case "stocks":
                return hits.filter((h) => h.type === "stock");
            case "sectors":
                return hits.filter((h) => h.level === "sector");
            case "industries":
                return hits.filter((h) => h.level === "industry_group" || h.level === "industry");
            case "subs":
                return hits.filter((h) => h.level === "basic_industry" || h.level === "sub_industry");
            default:
                return hits;
        }
    }, [querying, hits, pill]);
    // Default view: recents first — but Popular always stays listed too.
    const defaultSections: { label: string; rows: EntityHit[]; clearable?: boolean }[] = useMemo(() => {
        if (querying) return [];
        return [
            ...(recents.length ? [{ label: "Recent searches", rows: recents, clearable: true }] : []),
            { label: "Popular", rows: POPULAR },
        ];
    }, [querying, recents]);

    // Flat cursor order across whatever list is showing.
    const flat: { id: string; pick: () => void }[] = useMemo(() => {
        if (tab === "symbols") {
            const rows = querying ? filteredRows : defaultSections.flatMap((s) => s.rows);
            return rows.map((h) => ({ id: hitId(h), pick: () => pickEntity(h) }));
        }
        if (tab === "plugins") {
            return pluginHits.map((p) => ({
                id: `plugin:${p.id}`,
                pick: () => pick({ kind: "plugin", id: p.id, name: p.name }),
            }));
        }
        return runHits.map((r) => ({ id: `run:${r.id}`, pick: () => pick({ kind: "run", id: r.id, label: r.label }) }));
    }, [tab, querying, filteredRows, defaultSections, pluginHits, runHits, pickEntity, pick]);

    const onKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Escape") {
            onOpenChange(false);
            inputRef.current?.blur();
            return;
        }
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            if (!flat.length) return;
            e.preventDefault();
            setActiveIdx((i) =>
                e.key === "ArrowDown" ? (i + 1) % flat.length : i <= 0 ? flat.length - 1 : i - 1,
            );
        } else if (e.key === "Enter") {
            e.preventDefault();
            flat[Math.max(activeIdx, 0)]?.pick();
        }
    };

    const PILLS: { id: typeof pill; label: string }[] = [
        { id: "all", label: "All" },
        { id: "stocks", label: "Stocks" },
        { id: "sectors", label: "Sectors" },
        { id: "industries", label: "Industries" },
        { id: "subs", label: "Sub-industries" },
    ];

    return (
        <div ref={wrapRef} onKeyDown={onKeyDown} className="relative" data-testid="entity-search">
            <div className="relative">
                <Search
                    size={14}
                    className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[var(--ink-tertiary)]"
                />
                {/* No border: like the alert bell panel, a raised shade +
                    soft shadow lifts it off the page instead. */}
                <input
                    ref={inputRef}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onFocus={() => {
                        setRecents(loadRecents());
                        onOpenChange(true);
                    }}
                    placeholder={placeholder}
                    aria-label={placeholder}
                    role="combobox"
                    aria-expanded={open}
                    aria-controls={listId}
                    aria-autocomplete="list"
                    aria-activedescendant={activeIdx >= 0 && open ? `${listId}-opt-${activeIdx}` : undefined}
                    autoFocus={autoFocus}
                    className="h-8 w-full rounded-full bg-[var(--surface-raised)] pr-16 pl-8 font-[family-name:var(--font-body)] text-sm font-normal text-[var(--ink-primary)] shadow-[0_8px_24px_rgba(0,0,0,0.14)] outline-none focus:shadow-[0_8px_24px_rgba(0,0,0,0.3)]"
                />
                <span className="absolute top-1/2 right-2.5 flex -translate-y-1/2 items-center gap-1.5">
                    {querying && (
                        <button
                            type="button"
                            onClick={() => {
                                setQuery("");
                                inputRef.current?.focus();
                            }}
                            className="font-[family-name:var(--font-body)] text-[12px] text-[var(--ink-tertiary)] hover:text-[var(--ink-primary)]"
                        >
                            Clear
                        </button>
                    )}
                    {querying && <span aria-hidden className="h-3.5 w-px bg-[var(--hairline)]" />}
                    <button
                        type="button"
                        aria-label="Close search"
                        onClick={() => {
                            onOpenChange(false);
                            setQuery("");
                        }}
                        className="text-[var(--ink-tertiary)] hover:text-[var(--ink-primary)]"
                    >
                        <X size={14} aria-hidden />
                    </button>
                </span>
            </div>

            {open && (
                <div
                    id={listId}
                    role="listbox"
                    aria-label="Search results"
                    className="absolute top-[calc(100%+6px)] left-1/2 z-50 max-h-[600px] w-[560px] max-w-[94vw] -translate-x-1/2 overflow-y-auto rounded-[12px] border border-[var(--hairline)] bg-[var(--surface-canvas)] py-2 shadow-[0_16px_40px_rgba(0,0,0,0.18)]"
                >
                    {showTabs && (
                        <div className="flex items-center gap-5 border-b border-[var(--hairline)] px-4">
                            {(["symbols", "plugins", "runs"] as const).map((t) => (
                                <button
                                    key={t}
                                    type="button"
                                    onClick={() => setTab(t)}
                                    aria-selected={tab === t}
                                    className={cn(
                                        "-mb-px border-b-2 py-2.5 font-[family-name:var(--font-body)] text-[13.5px] transition-colors",
                                        tab === t
                                            ? "border-[var(--ink-primary)] text-[var(--ink-primary)]"
                                            : "border-transparent text-[var(--ink-tertiary)] hover:text-[var(--ink-secondary)]",
                                    )}
                                >
                                    {t[0].toUpperCase() + t.slice(1)}
                                </button>
                            ))}
                        </div>
                    )}

                    {showTabs && tab === "symbols" && (
                        <div className="flex flex-wrap items-center gap-1.5 px-4 pt-2.5 pb-1">
                            {PILLS.map((p) => (
                                <button
                                    key={p.id}
                                    type="button"
                                    onClick={() => setPill(p.id)}
                                    aria-pressed={pill === p.id}
                                    className={cn(
                                        "rounded-full px-3 py-1 font-[family-name:var(--font-body)] text-[12.5px] transition-colors",
                                        pill === p.id
                                            ? "bg-[var(--ink-primary)] text-[var(--surface-canvas)]"
                                            : "bg-[var(--surface-recessed)] text-[var(--ink-secondary)] hover:text-[var(--ink-primary)]",
                                    )}
                                >
                                    {p.label}
                                </button>
                            ))}
                        </div>
                    )}

                    <div className="px-1.5 pt-1 pb-1.5">
                        {tab === "symbols" && searching && (
                            <div className="px-2.5 py-2.5 font-[family-name:var(--font-body)] text-xs text-[var(--ink-tertiary)]">
                                Searching…
                            </div>
                        )}

                        {tab === "symbols" && !searching && (
                            querying ? (
                                <>
                                    {filteredRows.map((hit) => {
                                        const idx = flat.findIndex((f) => f.id === hitId(hit));
                                        return (
                                            <Row
                                                key={hitId(hit)}
                                                hit={hit}
                                                pct={hit.type === "stock" && hit.symbol ? pcts[yahooSymbol(hit)] : undefined}
                                                active={idx === activeIdx}
                                                idx={Math.max(idx, 0)}
                                                querying={querying}
                                                onHover={() => setActiveIdx(idx)}
                                                onPick={() => flat[idx]?.pick()}
                                            />
                                        );
                                    })}
                                    {filteredRows.length === 0 && (
                                        <div className="px-2.5 py-2.5 font-[family-name:var(--font-body)] text-xs text-[var(--ink-tertiary)]">
                                            Nothing matches “{query}”.
                                        </div>
                                    )}
                                </>
                            ) : (
                                defaultSections.map((section) => (
                                    <div key={section.label} role="group" aria-label={section.label}>
                                        <div className="flex items-center justify-between px-2.5 pt-1 pb-1">
                                            <span className="font-[family-name:var(--font-body)] text-[10.5px] font-normal tracking-[0.08em] text-[var(--ink-tertiary)] uppercase">
                                                {section.label}
                                            </span>
                                            {section.clearable && (
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        localStorage.removeItem(RECENTS_KEY);
                                                        setRecents([]);
                                                    }}
                                                    className="font-[family-name:var(--font-body)] text-[11px] text-[var(--ink-tertiary)] hover:text-[var(--ink-primary)]"
                                                >
                                                    Clear
                                                </button>
                                            )}
                                        </div>
                                        {section.rows.map((hit) => {
                                            const idx = flat.findIndex((f) => f.id === hitId(hit));
                                            return (
                                                <Row
                                                    key={hitId(hit)}
                                                    hit={hit}
                                                    pct={hit.type === "stock" && hit.symbol ? pcts[yahooSymbol(hit)] : undefined}
                                                    active={idx === activeIdx}
                                                    idx={Math.max(idx, 0)}
                                                    querying={querying}
                                                    onHover={() => setActiveIdx(idx)}
                                                    onPick={() => flat[idx]?.pick()}
                                                    onRemove={section.clearable ? () => setRecents(removeRecent(hitId(hit))) : undefined}
                                                />
                                            );
                                        })}
                                    </div>
                                ))
                            )
                        )}

                        {tab === "plugins" &&
                            (pluginHits.length ? (
                                pluginHits.map((p) => {
                                    const idx = flat.findIndex((f) => f.id === `plugin:${p.id}`);
                                    return (
                                        <div
                                            key={p.id}
                                            role="option"
                                            aria-selected={idx === activeIdx}
                                            tabIndex={-1}
                                            id={`entity-search-opt-${Math.max(idx, 0)}`}
                                            onMouseEnter={() => setActiveIdx(idx)}
                                            onClick={() => flat[idx]?.pick()}
                                            data-testid={`entity-row-plugin-${p.id}`}
                                            className={cn(
                                                "flex w-full cursor-pointer items-center gap-3 rounded-[10px] px-2.5 py-2",
                                                idx === activeIdx && "bg-[var(--surface-recessed)]",
                                            )}
                                        >
                                            <span className="min-w-0 flex-1 truncate font-[family-name:var(--font-body)] text-[14px] text-[var(--ink-primary)]">
                                                {p.name}
                                            </span>
                                            <TypeTag>PLUGIN</TypeTag>
                                        </div>
                                    );
                                })
                            ) : (
                                <div className="px-2.5 py-2.5 font-[family-name:var(--font-body)] text-xs text-[var(--ink-tertiary)]">
                                    No plugins match “{query}”.
                                </div>
                            ))}

                        {tab === "runs" &&
                            (runHits.length ? (
                                runHits.map((r) => {
                                    const idx = flat.findIndex((f) => f.id === `run:${r.id}`);
                                    return (
                                        <div
                                            key={r.id}
                                            role="option"
                                            aria-selected={idx === activeIdx}
                                            tabIndex={-1}
                                            id={`entity-search-opt-${Math.max(idx, 0)}`}
                                            onMouseEnter={() => setActiveIdx(idx)}
                                            onClick={() => flat[idx]?.pick()}
                                            data-testid={`entity-row-run-${r.id}`}
                                            className={cn(
                                                "flex w-full cursor-pointer items-center gap-3 rounded-[10px] px-2.5 py-2",
                                                idx === activeIdx && "bg-[var(--surface-recessed)]",
                                            )}
                                        >
                                            {r.symbol && <TickerLogo symbol={r.symbol} size={32} />}
                                            <span className="min-w-0 flex-1">
                                                <span className="block truncate font-[family-name:var(--font-body)] text-[14px] text-[var(--ink-primary)]">
                                                    {r.label}
                                                </span>
                                                {r.status && (
                                                    <span className="block font-[family-name:var(--font-body)] text-[12px] text-[var(--ink-tertiary)]">
                                                        Run · {r.status}
                                                    </span>
                                                )}
                                            </span>
                                            <TypeTag>RUN</TypeTag>
                                        </div>
                                    );
                                })
                            ) : (
                                <div className="px-2.5 py-2.5 font-[family-name:var(--font-body)] text-xs text-[var(--ink-tertiary)]">
                                    No runs match “{query}”.
                                </div>
                            ))}
                    </div>
                </div>
            )}
        </div>
    );
}
