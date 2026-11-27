import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "motion/react";
import { Avatar, Style } from "@dicebear/core";
import discoDefinition from "@dicebear/styles/disco.json";
import { ArrowUpRight, CalendarCheck, CalendarClock, ChevronDown, Download, Loader2, Pencil, Plus, RotateCw, Search, Trash2, X } from "lucide-react";
import { AnalysisService, API_BASE, WatchlistService, runPluginLabel, type AlertRuleRow, type PluginSummary, type WatchlistRow, type WatchlistItem } from "@/db";
import { formatSeconds } from "@/utils";
import { FlagLogo, TickerLogo } from "@/lib/sourceLogos";
import { badgeAge, badgeFill, badgeIcons, verdictTone } from "@/lib/analysisFormat";
import { DropdownItem } from "@/pages/shared/AnalysisControls";
import PluginAvatar from "@/components/shared/PluginAvatar";
import ConfirmDialog from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { toaster } from "@/compat/ui";
import { Tooltip } from "radix-ui";

/** TradingView-style watchlist table: list switcher + add/options in the
 *  header, one hairline row per symbol (logo, ticker, status dot, tiny chart,
 *  Last/Chg%, verdict badges). Shared by the homepage rail (`page=false`)
 *  and the full-page /watchlists route. */

/** Shared shell of every header icon button; colour comes per button so the
 *  destructive one can stay red without fighting the muted hover. */
const ICON_BTN = "flex h-7 w-7 items-center justify-center rounded-[6px] transition-colors";
const ICON_BTN_MUTED =
    `${ICON_BTN} text-[var(--ink-tertiary)] hover:bg-[var(--surface-recessed)] hover:text-[var(--ink-primary)] focus-visible:text-[var(--ink-primary)]`;
const ICON_BTN_DANGER =
    `${ICON_BTN} text-[var(--signal-negative-text)] hover:bg-[var(--surface-recessed)] hover:text-[var(--signal-negative-text)]`;

/** Both menus in this panel: same rounded shell and rounded rows. */
const MENU_CLS = "rounded-[12px] [&_[data-slot=dropdown-menu-item]]:rounded-[8px]";

const disco = new Style(discoDefinition);

/** DiceBear "disco" mark for a list — seeded by list id, so every watchlist
 *  keeps its own randomly generated avatar. Fully round. */
function ListAvatar({ seed, size = 22 }: { seed: string; size?: number }) {
    const svg = useMemo(
        () => new Avatar(disco, { seed }).toString().replace("<svg ", '<svg width="100%" height="100%" '),
        [seed],
    );
    return (
        <span
            aria-hidden="true"
            className="block shrink-0 overflow-hidden rounded-full bg-[var(--surface-recessed)]"
            style={{ width: size, height: size, lineHeight: 0 }}
            dangerouslySetInnerHTML={{ __html: svg }}
        />
    );
}

/** The watchlist before SQLite kept only symbols under this localStorage key. */
const LEGACY_WATCH_KEY = "relativity.watchlist";
/** Last-switched list — survives reloads, like the heatmap's market key. */
const ACTIVE_KEY = "relativity.watchlist.active";

function legacyWatchSymbols(): string[] {
    try {
        const raw = localStorage.getItem(LEGACY_WATCH_KEY);
        const v = raw ? JSON.parse(raw) : [];
        return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
    } catch { return []; }
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

/** Verdict word → status band — delegates to the app's canonical
 *  verdictTone (harness five-band + score words + buy/sell vocabulary),
 *  so a "Good"/"Poor" run bands the same here as everywhere else. */
function verdictBand(verdict?: string | null): "up" | "mid" | "down" | null {
    const tone = verdictTone(verdict);
    return tone === "good" ? "up" : tone === "caution" ? "mid" : tone === "bad" ? "down" : null;
}

/** Sort weight for an agent column: strong beats watch beats weak. */
const VERDICT_RANK: Record<"up" | "mid" | "down", number> = { up: 3, mid: 2, down: 1 };

type Agent = {
    agent?: string;
    verdict?: string;
    when: string;
    /** Last run's wall time, compact ("2m 5s"). */
    dur?: string;
    /** Where this agent's last run lives. */
    runId?: string;
    /** Run config carried forward so the cell can re-run / schedule it. */
    pluginIds?: string[];
    skills?: string[];
    /** ISO wall time of the last run — feeds the badge's age. */
    createdAt?: string;
};

type RowData = {
    symbol: string;
    name: string;
    source?: string;
    agents: Agent[];
    href: string;
};

type Quote = { pts: string; color: string; last: number | null; pct: number | null };

/** One intraday fetch per symbol (server caches 60s) — feeds the tiny chart
 *  and the Last/Chg% columns from the same numbers, so they never drift. */
function useQuotes(pairs: { symbol: string; source?: string }[]): Record<string, Quote> {
    const key = JSON.stringify(pairs.map((p) => [p.symbol, p.source || ""]));
    const [map, setMap] = useState<Record<string, Quote>>({});

    useEffect(() => {
        let alive = true;
        const list: [string, string][] = JSON.parse(key);
        // Empty list: nothing to fetch; stale per-symbol entries are never
        // read again because rows only look up their own symbol key.
        if (!list.length) return;
        Promise.all(
            list.map(([symbol, source]) =>
                fetch(`${API_BASE}/market/chart/${encodeURIComponent(symbol)}?range=1d&interval=5m&source=${encodeURIComponent(source)}`, { cache: "no-store" })
                    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
                    .then((d: { closes?: number[]; previous_close?: number | null }) => {
                        const closes: number[] = d.closes || [];
                        if (closes.length < 2) return null;
                        const min = Math.min(...closes);
                        const max = Math.max(...closes);
                        const span = max - min || 1;
                        const pts = closes
                            .map((c, i) => `${((i / (closes.length - 1)) * 100).toFixed(1)},${(37 - ((c - min) / span) * 34).toFixed(1)}`)
                            .join(" ");
                        const last = closes[closes.length - 1];
                        const prev = typeof d.previous_close === "number" ? d.previous_close : null;
                        const pct = prev ? ((last - prev) / prev) * 100 : null;
                        const up = prev ? last >= prev : last >= closes[0];
                        return [`${symbol}:${source}`, { pts, color: up ? "#22C55E" : "#EF4444", last, pct }] as const;
                    })
                    .catch(() => null),
            ),
        ).then((entries) => {
            if (!alive) return;
            const out: Record<string, Quote> = {};
            for (const e of entries) if (e) out[e[0]] = e[1];
            setMap(out);
        });
        return () => { alive = false; };
    }, [key]);

    return map;
}

/** The whole chart: ~48×20, line only — big enough to read the shape. */
function SparkSvg({ pts, color }: { pts: string; color: string }) {
    return (
        <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="h-7 w-16" aria-hidden="true">
            <polyline
                points={pts}
                fill="none"
                stroke={color}
                strokeWidth="1.5"
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
            />
        </svg>
    );
}

function VerdictBadge({ agent }: { agent: Agent }) {
    const Icons = badgeIcons(agent.verdict);
    const age = badgeAge(agent.createdAt);
    // Docs' own custom-colour recipes (ui.shadcn.com Badge → Custom Colors):
    // pale tint + dark tint in light, deep tint + light tint in dark.
    const tone = verdictTone(agent.verdict);
    const toneCls =
        tone === "good"
            ? "bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300"
            : tone === "bad"
                ? "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300"
                : tone === "caution"
                    ? "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
                    : "bg-secondary text-secondary-foreground";
    return (
        // Hover tooltip (Radix — the compat Tooltip is click-triggered):
        // instant, leads with when the last run happened. The badge itself
        // is the link to that run; the age sits on the badge so "old
        // verdict" reads without hovering.
        <Tooltip.Root>
            <Tooltip.Trigger asChild>
                <Link
                    to={`/runs/${agent.runId}`}
                    target="_blank" rel="noreferrer"
                    className={`verdict-badge inline-flex max-w-[190px] shrink-0 items-center gap-1.5 truncate rounded-full px-2 py-0.5 text-xs font-medium leading-none ${toneCls}`}
                >
                    {Icons.map((Glyph, i) => (
                        <Glyph key={i} size={15} className="shrink-0" aria-hidden="true" />
                    ))}
                    <span className="min-w-0 truncate">{agent.verdict || "Run"}</span>
                    {age && <span className="shrink-0 text-[11px] font-normal leading-none opacity-70" aria-hidden="true">{age}</span>}
                    {/* Screen readers get the hover-only info as text. */}
                    <span className="sr-only"> — last run {agent.when}{agent.dur ? ` · ${agent.dur}` : ""}</span>
                </Link>
            </Tooltip.Trigger>
            <Tooltip.Portal>
                <Tooltip.Content
                    sideOffset={6}
                    style={{
                        background: "var(--surface-inverse)",
                        color: "var(--ink-inverse-primary)",
                        fontSize: "11.5px",
                        padding: "5px 8px",
                        borderRadius: 4,
                        maxWidth: 260,
                        zIndex: 60,
                    }}
                >
                    Last run {agent.when}{agent.dur ? ` · ${agent.dur}` : ""}
                </Tooltip.Content>
            </Tooltip.Portal>
        </Tooltip.Root>
    );
}

/** Sort key: a price column, or one agent column (`agent:<name>`). */
type SortKey = "last" | "pct" | `agent:${string}`;

const SCHEDULE_FREQS = [
    ["daily", "Daily"],
    ["weekly", "Weekly"],
    ["biweekly", "Biweekly"],
    ["monthly", "Monthly"],
] as const;

const ACTION_BTN =
    "flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] text-[var(--ink-tertiary)] transition-colors hover:bg-[var(--surface-recessed)] hover:text-[var(--ink-primary)] focus-visible:text-[var(--ink-primary)] disabled:opacity-50";

/** The badge's row-hover sidekicks: ↻ relaunches this agent on this symbol,
 *  📅 sets a cadence (9:00 AM local, starting today). Icons only appear for
 *  agents whose run config we can re-fire (plugin or skill ids). */
function AgentActions({ row, agent, rule, onScheduled }: {
    row: RowData;
    agent: Agent;
    /** This symbol+agent's existing alert rule, when it has one. */
    rule?: AlertRuleRow;
    onScheduled: (r: AlertRuleRow) => void;
}) {
    const navigate = useNavigate();
    const [busy, setBusy] = useState(false);

    const runAgain = async () => {
        if (busy) return;
        setBusy(true);
        try {
            const res = await AnalysisService.runAnalysis({
                symbol: row.symbol,
                source: String(row.source || "SEC").toUpperCase(),
                share_name: row.name,
                plugin_ids: agent.pluginIds || [],
                skills: agent.skills,
            });
            toaster.create({ title: "Run started", description: `${row.symbol} · ${agent.agent || "agent"}`, type: "success" });
            window.open(`/runs/${res.id}`, "_blank", "noreferrer");
        } catch (e) {
            const err = e as { message?: string; response?: { data?: { error?: string } } };
            toaster.create({
                title: "Couldn't start the run",
                description: err?.response?.data?.error || err?.message,
                type: "error",
            });
        } finally {
            setBusy(false);
        }
    };

    const schedule = async (freq: string) => {
        try {
            const created = await AnalysisService.createAlertRule({
                symbol: row.symbol,
                share_name: row.name,
                source: String(row.source || "SEC").toUpperCase(),
                plugin_ids: agent.pluginIds || [],
                skills: agent.skills,
                frequency: freq,
                start_date: new Date().toISOString().slice(0, 10),
                time: "09:00",
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            });
            onScheduled(created);
            const label = SCHEDULE_FREQS.find(([v]) => v === freq)?.[1] || freq;
            toaster.create({ title: `${label} schedule set`, description: `${row.symbol} · 9:00 AM`, type: "success" });
        } catch (e) {
            const err = e as { message?: string; response?: { data?: { error?: string } } };
            toaster.create({
                title: "Couldn't set the schedule",
                description: err?.response?.data?.error || err?.message,
                type: "error",
            });
        }
    };

    return (
        <span className="flex shrink-0 items-center gap-1">
            <button
                type="button"
                aria-label={`Run ${row.symbol} with ${agent.agent || "agent"} again`}
                title="Run again"
                disabled={busy}
                onClick={() => void runAgain()}
                className={ACTION_BTN}
            >
                {busy ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <RotateCw size={14} aria-hidden="true" />}
            </button>
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <button
                        type="button"
                        aria-label={rule
                            ? `Schedule ${row.symbol} with ${agent.agent || "agent"} — scheduled`
                            : `Schedule ${row.symbol} with ${agent.agent || "agent"}`}
                        title={rule ? `Scheduled — ${rule.frequency} at ${rule.time}` : "Schedule"}
                        className={ACTION_BTN}
                    >
                        {rule
                            ? <CalendarCheck size={14} aria-hidden="true" />
                            : <CalendarClock size={14} aria-hidden="true" />}
                    </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className={`min-w-[190px] ${MENU_CLS}`}>
                    {rule && (
                        <div className="px-2.5 py-1.5 font-app-body text-[11px] font-light text-[var(--ink-tertiary)]">
                            Scheduled — {rule.frequency} at {rule.time}
                        </div>
                    )}
                    {SCHEDULE_FREQS.map(([value, label]) => (
                        <DropdownMenuItem key={value} onSelect={() => void schedule(value)}>
                            {label} · 9:00 AM
                        </DropdownMenuItem>
                    ))}
                    <DropdownMenuItem onSelect={() => navigate("/new-run?mode=alert")}>
                        Manage schedules
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
        </span>
    );
}

function SortTh({ label, k, sort, onSort, align = "right" }: {
    label: ReactNode;
    k: SortKey;
    sort: { k: SortKey; dir: 1 | -1 } | null;
    onSort: (k: SortKey) => void;
    align?: "left" | "right" | "center";
}) {
    const on = sort?.k === k;
    return (
        <th
            scope="col"
            aria-sort={on ? (sort!.dir === 1 ? "ascending" : "descending") : "none"}
            className={`py-2 pl-3 ${align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left"}`}
        >
            <button
                type="button"
                onClick={() => onSort(k)}
                className="inline-flex items-center gap-1.5 font-app-body text-[11px] font-light text-[var(--ink-tertiary)] transition-colors hover:text-[var(--ink-primary)]"
            >
                {label}
                {on && <ChevronDown size={11} className={sort!.dir === -1 ? "rotate-180" : ""} aria-hidden="true" />}
            </button>
        </th>
    );
}

const fmtLast = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 3 });
const fmtPct = (n: number) => `${n > 0 ? "+" : ""}${n.toFixed(2)}%`;
const changeColor = (n: number | null) =>
    n == null || n === 0 ? "var(--ink-primary)" : n > 0 ? "var(--signal-up)" : "var(--signal-down)";

/** Stock-search result row (shared with the navbar's picker shape). */
type StockRow = { ticker?: string; SYMBOL?: string; name?: string; NAME?: string; source?: string };

export default function WatchlistPanel({ runs, plugins, page = false }: { runs: any[]; plugins: PluginSummary[]; page?: boolean }) {
    const [lists, setLists] = useState<WatchlistRow[]>([]);
    const [activeId, setActiveId] = useState<string | null>(() => {
        try { return localStorage.getItem(ACTIVE_KEY); } catch { return null; }
    });
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(false);
    // StrictMode runs this effect twice; a ref keeps the second run from
    // racing the first and creating two empty default lists.
    const bootstrapped = useRef(false);
    const [editor, setEditor] = useState<{ kind: "create" } | { kind: "rename"; id: string } | null>(null);
    const [nameDraft, setNameDraft] = useState("");
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [adding, setAdding] = useState(false);
    const [query, setQuery] = useState("");
    const [results, setResults] = useState<StockRow[]>([]);
    const [searching, setSearching] = useState(false);
    /** Highlighted row of the search results — moved with ArrowUp/ArrowDown. */
    const [cursor, setCursor] = useState(-1);
    const [sort, setSort] = useState<{ k: SortKey; dir: 1 | -1 } | null>(null);
    /** Alert rules — so a scheduled cell shows its check instead of re-asking. */
    const [rules, setRules] = useState<AlertRuleRow[]>([]);
    const searchRef = useRef<HTMLDivElement>(null);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const abortRef = useRef<AbortController | null>(null);

    const active = lists.find((l) => l.id === activeId) || lists[0];

    useEffect(() => {
        AnalysisService.listAlertRules()
            .then((r) => { if (Array.isArray(r)) setRules(r); })
            .catch(() => {});
    }, []);

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
                // Keep the remembered list when it still exists; else first.
                setActiveId((prev) => (prev && rows.some((r) => r.id === prev) ? prev : rows[0].id));
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

    // Last choice survives reloads — same pattern as the heatmap's market key.
    useEffect(() => {
        if (!activeId) return;
        try { localStorage.setItem(ACTIVE_KEY, activeId); } catch { /* private mode */ }
    }, [activeId]);

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
        if (!q) { setResults([]); setCursor(-1); setSearching(false); return; }
        debounceRef.current = setTimeout(async () => {
            setSearching(true);
            const controller = new AbortController();
            abortRef.current = controller;
            try {
                const res = await fetch(`${API_BASE}/stocks/search?${new URLSearchParams({ query: q })}`, { signal: controller.signal });
                const data = await res.json();
                if (!controller.signal.aborted) { setResults(Array.isArray(data) ? data : []); setCursor(0); }
            } catch {
                if (!controller.signal.aborted) { setResults([]); setCursor(-1); }
            } finally {
                if (!controller.signal.aborted) setSearching(false);
            }
        }, 300);
        return () => clearTimeout(debounceRef.current);
    }, [query]);

    // Keep the keyboard-highlighted row visible inside the scroll panel.
    useEffect(() => {
        if (cursor < 0) return;
        const el = document.getElementById(`stock-opt-${cursor}`);
        el?.scrollIntoView?.({ block: "nearest" }); // ?. — jsdom doesn't implement it
    }, [cursor]);

    const replace = (row: WatchlistRow) =>
        setLists((prev) => prev.map((l) => (l.id === row.id ? row : l)));

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

    // Drag to reorder — native HTML5 DnD, no dependency. rowsFor() is
    // items.map(), so the render index IS the items index.
    const dragFrom = useRef<number | null>(null);
    const dropAt = (to: number) => {
        const from = dragFrom.current;
        dragFrom.current = null;
        if (from === null || from === to || !active) return;
        const items = [...active.items];
        const [moved] = items.splice(from, 1);
        items.splice(to, 0, moved);
        void saveItems(items);
    };
    const dragProps = (i: number) => ({
        draggable: true,
        onDragStart: (e: DragEvent<HTMLElement>) => {
            dragFrom.current = i;
            e.dataTransfer.effectAllowed = "move";
        },
        onDragOver: (e: DragEvent<HTMLElement>) => {
            if (dragFrom.current !== null) e.preventDefault();
        },
        onDrop: (e: DragEvent<HTMLElement>) => { e.preventDefault(); dropAt(i); },
        onDragEnd: () => { dragFrom.current = null; },
    });

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

    const rowsFor = (list: WatchlistRow): RowData[] => list.items.map((item) => {
        const rs = runs.filter((r) => r.symbol === item.symbol)
            .sort((x, y) => +new Date(y.created_at) - +new Date(x.created_at));
        const agents: Agent[] = [];
        const seen = new Set<string>();
        for (const r of rs) {
            const a = runPluginLabel(r.plugin_ids, plugins, null) || r.agent_name || r.agent || "Plugin";
            if (seen.has(a)) continue;
            seen.add(a);
            agents.push({
                agent: a,
                verdict: r.verdict || r.status,
                when: timeAgo(r.created_at),
                dur: typeof r.duration === "number" && r.duration > 0 ? formatSeconds(Math.round(r.duration)) : undefined,
                runId: r.id || r.analysis_id,
                pluginIds: Array.isArray(r.plugin_ids) ? r.plugin_ids.map(String) : undefined,
                skills: Array.isArray(r.skill_ids) ? r.skill_ids.map(String) : undefined,
                createdAt: r.created_at,
            });
        }
        return {
            symbol: item.symbol,
            name: rs[0]?.share_name || item.name || item.symbol,
            source: item.source || rs[0]?.source,
            agents,
            // Ticker/logo always land on the stock page; the run lives behind
            // the verdict badge.
            href: `/stock/${encodeURIComponent(item.symbol)}?source=${encodeURIComponent(item.source || "")}`,
        };
    });

    const rows = active ? rowsFor(active) : [];
    // One column per agent that actually ran on THIS list's symbols — never
    // the whole plugin library.
    const agentColumns = Array.from(new Set(rows.flatMap((r) => r.agents.map((a) => a.agent || "Plugin"))))
        .sort((a, b) => a.localeCompare(b));
    const quotes = useQuotes(rows.map((r) => ({ symbol: r.symbol, source: r.source })));
    const quoteOf = (row: RowData) => quotes[`${row.symbol}:${row.source || ""}`];

    const onSort = (k: SortKey) =>
        setSort((s) => (s?.k === k ? { k, dir: s.dir === 1 ? -1 : 1 } : { k, dir: -1 }));
    // Price columns sort by number; an agent column sorts by that agent's
    // verdict band (unclassified verdicts sit mid, no-run rows sink).
    const rankOf = (r: RowData, k: SortKey): number | null => {
        if (k.startsWith("agent:")) {
            const name = k.slice("agent:".length);
            const hit = r.agents.find((a) => (a.agent || "Plugin") === name);
            if (!hit?.verdict) return 0;
            const band = verdictBand(hit.verdict);
            return band ? VERDICT_RANK[band] : 2;
        }
        return quoteOf(r)?.[k as "last" | "pct"] ?? null;
    };
    const sorted = sort
        ? [...rows].sort((a, b) => {
            const va = rankOf(a, sort.k);
            const vb = rankOf(b, sort.k);
            if (va == null && vb == null) return 0;
            if (va == null) return 1; // unpriced / unranked rows sink
            if (vb == null) return -1;
            return (va - vb) * sort.dir;
        })
        : rows;

    /** The active list as CSV — symbol/name/source, the live quote columns,
     *  then one column per agent verdict. */
    const exportCsv = () => {
        if (!active) return;
        const cell = (v: unknown) => {
            const s = String(v ?? "");
            return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        };
        const head = ["Symbol", "Name", "Source", "Last", "Chg%", ...agentColumns];
        const body = sorted.map((r) => {
            const q = quoteOf(r);
            return [
                r.symbol,
                r.name || "",
                r.source || "",
                q?.last ?? "",
                q?.pct ?? "",
                ...agentColumns.map((a) => r.agents.find((x) => (x.agent || "Plugin") === a)?.verdict || ""),
            ]
                .map(cell)
                .join(",");
        });
        const csv = [[head.map(cell).join(","), ...body].join("\r\n")];
        const url = URL.createObjectURL(new Blob(csv, { type: "text/csv;charset=utf-8" }));
        const a = document.createElement("a");
        a.href = url;
        const slug =
            (active.name || "watchlist")
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, "-")
                .replace(/^-|-$/g, "") || "watchlist";
        a.download = `${slug}.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2_000);
    };

    // The nudge is for a fresh, empty list only — and not while the user is
    // already naming a list or searching for a stock to add.
    const showFirstHint = !loading && !loadError && !editor && !adding && !!active && rows.length === 0;

    return (
        <section aria-label="Watchlist" className="pb-12">
            {/* Page masthead — same shape as the Runs page's. */}
            {page && (
                <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 pb-5 pt-6">
                    <div className="min-w-0">
                        <h1 className="text-[30px] leading-tight font-light tracking-[-0.01em] text-[var(--gh-fg)]">
                            Watchlist
                        </h1>
                        <p className="mt-0.5 text-[15px] font-light text-[var(--gh-muted)]">
                            Every symbol you track — prices, charts and agent verdicts
                        </p>
                    </div>
                    <motion.div whileHover={{ y: -1 }} whileTap={{ scale: 0.97 }} className="shrink-0">
                        <Button variant="outline" size="sm" onClick={startCreate} className="px-4">
                            <Plus /> New Watchlist
                        </Button>
                    </motion.div>
                </header>
            )}

            {/* Header — list switcher left, then the icon row (+ / open /
                export / rename / delete), with the empty-list nudge
                tucked in front of the + when the list is still empty. */}
            <div className="flex flex-wrap items-center justify-between gap-3">
                {editor ? (
                    <div className="flex min-w-0 flex-1 items-center gap-1.5">
                        <input
                            autoFocus value={nameDraft} onChange={(e) => setNameDraft(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter") void saveName();
                                if (e.key === "Escape") { setEditor(null); setNameDraft(""); }
                            }}
                            placeholder="Watchlist name" aria-label="Watchlist name"
                            className="h-8 w-48 max-w-full rounded-[6px] border border-[var(--hairline)] bg-[var(--surface-recessed)] px-2.5 font-[family-name:var(--font-body)] text-[13px] text-[var(--ink-primary)] outline-none focus:border-[var(--ink-tertiary)]"
                        />
                        <button
                            type="button" onClick={() => void saveName()} disabled={!nameDraft.trim()}
                            className="h-8 shrink-0 rounded-[6px] bg-[var(--surface-raised)] px-3 font-app-body text-[13px] text-[var(--ink-primary)] transition-colors hover:bg-[var(--surface-raised-hover)] disabled:cursor-not-allowed disabled:opacity-40"
                        >
                            {editor.kind === "create" ? "Create" : "Save"}
                        </button>
                        <button
                            type="button" aria-label="Cancel" onClick={() => { setEditor(null); setNameDraft(""); }}
                            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] text-[var(--ink-tertiary)] hover:text-[var(--ink-primary)]"
                        >
                            <X size={14} />
                        </button>
                    </div>
                ) : loading ? (
                    <div role="status" aria-label="Loading watchlists" className="flex h-8 items-center gap-2 text-[var(--ink-tertiary)]">
                        <Loader2 size={16} className="animate-spin" />
                        <span className="font-app-body text-[13px] font-light">Loading watchlists…</span>
                    </div>
                ) : (
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <button
                                type="button" aria-label="Switch watchlist" title="Switch watchlist"
                                className="group flex min-w-0 items-center gap-2 rounded-[8px] px-1.5 py-1 text-left transition-colors hover:bg-[var(--surface-recessed)]"
                            >
                                <ListAvatar seed={active?.id || "watchlist"} size={24} />
                                <span className="truncate font-app-body text-[20px] font-light leading-none text-[var(--ink-primary)]">
                                    {active?.name || "Watchlist"}
                                </span>
                                <ChevronDown size={15} className="shrink-0 text-[var(--ink-tertiary)] transition-colors group-hover:text-[var(--ink-primary)]" aria-hidden="true" />
                            </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start" className={`min-w-[240px] ${MENU_CLS}`}>
                            {lists.map((l) => (
                                <DropdownMenuItem
                                    key={l.id}
                                    onSelect={() => { setActiveId(l.id); setAdding(false); setEditor(null); }}
                                    data-selected={l.id === active?.id}
                                    className="gap-2.5"
                                >
                                    <ListAvatar seed={l.id} size={20} />
                                    <span className="min-w-0 flex-1 truncate font-light">{l.name}</span>
                                    <span className="shrink-0 font-light text-[11px] text-[var(--ink-tertiary)]">{l.items.length}</span>
                                </DropdownMenuItem>
                            ))}
                            <DropdownMenuItem onSelect={startCreate} className="gap-2.5">
                                <span className="flex h-5 w-5 shrink-0 items-center justify-center" aria-hidden="true">
                                    <Plus size={14} />
                                </span>
                                <span className="min-w-0 flex-1 truncate font-light">New watchlist</span>
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                )}

                <div className="flex shrink-0 flex-wrap items-center justify-end gap-x-1 gap-y-2">
                    {/* Empty-list nudge — the arrow's head sits right
                        against the + it is pointing at. */}
                    {showFirstHint && (
                        <span className="rel-hint mr-1.5 flex select-none items-center gap-1 whitespace-nowrap">
                            <span className="font-app-body text-[13px] font-light text-[var(--ink-tertiary)]">
                                add stocks to watchlist
                            </span>
                            <span
                                aria-hidden="true"
                                className="rel-hint-arrow block size-8 shrink-0 -rotate-[10deg] text-[var(--ink-primary)]"
                            />
                        </span>
                    )}
                    <button
                        type="button" onClick={() => setAdding((v) => !v)}
                        aria-label="Add stock" title="Add stock" aria-expanded={adding}
                        className={ICON_BTN_MUTED}
                    >
                        <Plus size={16} />
                    </button>
                    {!page && (
                        <a
                            href="/watchlists" target="_blank" rel="noreferrer"
                            aria-label="Open full watchlist in a new tab" title="Open full watchlist"
                            className={ICON_BTN_MUTED}
                        >
                            <ArrowUpRight size={16} />
                        </a>
                    )}
                    <button
                        type="button" onClick={exportCsv} disabled={!active}
                        aria-label="Export watchlist as CSV" title="Export watchlist as CSV"
                        className={ICON_BTN_MUTED}
                    >
                        <Download size={16} />
                    </button>
                    <button
                        type="button" onClick={startRename} disabled={!active}
                        aria-label="Rename watchlist" title="Rename watchlist"
                        className={ICON_BTN_MUTED}
                    >
                        <Pencil size={16} />
                    </button>
                    <button
                        type="button" onClick={() => setConfirmDelete(true)} disabled={!active}
                        aria-label="Delete watchlist" title="Delete watchlist"
                        className={ICON_BTN_DANGER}
                    >
                        <Trash2 size={16} />
                    </button>
                </div>
            </div>

            {loadError && !loading && (
                <p role="alert" className="mt-2 font-app-body text-[13px] text-[var(--signal-negative-text)]">
                    Couldn't load your watchlists. Refresh to retry.
                </p>
            )}

            {/* Symbol search — TradingView's + opens the picker in place. */}
            {adding && (
                <div ref={searchRef} className="relative mt-2">
                    <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--ink-tertiary)]" />
                    <input
                        autoFocus value={query}
                        onChange={(e) => { setQuery(e.target.value); }}
                        placeholder="Search stocks…" aria-label="Search stocks to add"
                        role="combobox" aria-expanded={query.trim() !== ""}
                        aria-controls="watchlist-stock-listbox"
                        aria-activedescendant={cursor >= 0 && results[cursor] ? `stock-opt-${cursor}` : undefined}
                        aria-autocomplete="list"
                        onKeyDown={(e) => {
                            if (!results.length) return;
                            if (e.key === "ArrowDown") {
                                e.preventDefault(); setCursor((c) => Math.min(c + 1, results.length - 1));
                            } else if (e.key === "ArrowUp") {
                                e.preventDefault(); setCursor((c) => Math.max(c - 1, 0));
                            } else if (e.key === "Enter") {
                                const pick = results[Math.max(cursor, 0)];
                                if (pick) { e.preventDefault(); addStock(pick); }
                            } else if (e.key === "Escape") {
                                setAdding(false); setQuery(""); setResults([]); setCursor(-1);
                            }
                        }}
                        className="h-9 w-full rounded-[6px] border border-[var(--hairline)] bg-[var(--surface-recessed)] pl-8 pr-2.5 font-[family-name:var(--font-body)] text-[13px] text-[var(--ink-primary)] outline-none focus:border-[var(--ink-tertiary)]"
                    />
                    {query.trim() !== "" && (
                        <div id="watchlist-stock-listbox" role="listbox" aria-label="Stock results" className="listbox-panel absolute left-0 top-[calc(100%+6px)] z-50 max-h-[280px] w-full overflow-y-auto rounded-[6px] border border-[var(--hairline)] bg-[var(--surface-canvas)] py-1 shadow-[0_8px_24px_rgba(0,0,0,0.12)]">
                            {searching && (
                                <div className="px-3 py-2.5 font-[family-name:var(--font-body)] text-xs text-[var(--ink-tertiary)]">Searching…</div>
                            )}
                            {!searching && results.length === 0 && (
                                <div className="px-3 py-2.5 font-[family-name:var(--font-body)] text-xs text-[var(--ink-tertiary)]">
                                    Nothing matches “{query}”.
                                </div>
                            )}
                            {!searching && results.map((stock, i) => {
                                const sym = stock.ticker || stock.SYMBOL || "";
                                const india = String(stock.source || "").toLowerCase() === "nse";
                                return (
                                    <DropdownItem
                                        key={`${stock.source}-${sym}`}
                                        id={`stock-opt-${i}`}
                                        active={i === cursor}
                                        label={stock.name || stock.NAME || sym}
                                        sub={
                                            <span className="flex items-center gap-1">
                                                <FlagLogo source={stock.source} size={14} />
                                                {india ? "NSE" : "SEC"}:{sym}
                                            </span>
                                        }
                                        logo={<TickerLogo symbol={sym} size={24} />}
                                        onClick={() => addStock(stock)}
                                    />
                                );
                            })}
                        </div>
                    )}
                </div>
            )}

            {active && rows.length > 0 ? (
                <div className="mt-2 w-full overflow-x-auto">
                    <Tooltip.Provider delayDuration={0}>
                    <table className="w-full min-w-[720px] border-collapse text-left">
                        <thead>
                            <tr className="border-b border-[var(--hairline)]">
                                <th scope="col" className="py-2 pr-2 font-app-body text-[11px] font-light text-[var(--ink-tertiary)]">Symbol</th>
                                <th scope="col" className="py-2 pr-2 font-app-body text-[11px] font-light text-[var(--ink-tertiary)]">Chart</th>
                                <SortTh label="Last" k="last" sort={sort} onSort={onSort} />
                                <SortTh label="Chg%" k="pct" sort={sort} onSort={onSort} />
                                {agentColumns.map((name) => (
                                    <SortTh
                                        key={name}
                                        k={`agent:${name}`}
                                        align="center"
                                        sort={sort}
                                        onSort={onSort}
                                        label={
                                            <span className="flex items-center gap-1.5 whitespace-nowrap text-[14px] font-normal text-[var(--ink-primary)]">
                                                <PluginAvatar plugin={name} size={26} />
                                                {name}
                                            </span>
                                        }
                                    />
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {sorted.map((row, i) => {
                                const q = quoteOf(row);
                                const latest = row.agents.find((a) => a.verdict);
                                const dot = badgeFill(latest?.verdict);
                                return (
                                    <tr key={`${row.symbol}-${row.source || ""}`} {...dragProps(i)} className="group border-b border-[var(--hairline)] transition-colors hover:bg-[var(--surface-recessed)]">
                                        <th scope="row" className="py-2.5 pr-2 align-middle font-light">
                                            <div className="flex items-center gap-2">
                                                <Link
                                                    to={row.href} target="_blank" rel="noreferrer" data-solid=""
                                                    title={row.name}
                                                    className="flex min-w-0 items-center gap-2 hover:opacity-80"
                                                >
                                                    <FlagLogo source={row.source} size={20} />
                                                    <TickerLogo symbol={row.symbol} size={30} />
                                                    <span className="truncate font-app-body text-[17px] font-medium text-[var(--ink-primary)]">
                                                        {row.symbol}
                                                    </span>
                                                    <span
                                                        aria-hidden="true"
                                                        title={latest?.verdict ? `Latest verdict: ${latest.verdict}` : "No runs yet"}
                                                        className="h-2 w-2 shrink-0 rounded-full"
                                                        style={{ background: dot }}
                                                    />
                                                </Link>
                                                <button
                                                    type="button"
                                                    aria-label={`Remove ${row.symbol} from watchlist`}
                                                    title="Remove from watchlist"
                                                    onClick={() => void saveItems(active.items.filter((it) => it.symbol !== row.symbol))}
                                                    className="shrink-0 text-[var(--ink-tertiary)] opacity-0 transition-opacity hover:text-[var(--ink-primary)] focus-visible:opacity-100 group-hover:opacity-100"
                                                >
                                                    <X size={16} />
                                                </button>
                                            </div>
                                        </th>
                                        <td className="py-2.5 pr-2 align-middle">
                                            {q ? <SparkSvg pts={q.pts} color={q.color} /> : <span className="block h-7 w-16" aria-hidden="true" />}
                                        </td>
                                        <td className="py-2.5 pl-3 text-right align-middle font-app-tabular text-[15px] text-[var(--ink-primary)]">
                                            {q?.last != null ? fmtLast(q.last) : "—"}
                                        </td>
                                        <td className="py-2.5 pl-3 text-right align-middle font-app-tabular text-[15px]" style={{ color: changeColor(q?.pct ?? null) }}>
                                            {q?.pct != null ? fmtPct(q.pct) : "—"}
                                        </td>
                                        {agentColumns.map((name) => {
                                            const hit = row.agents.find((a) => (a.agent || "Plugin") === name);
                                            const rule = hit && rules.find((r) =>
                                                r.enabled !== 0
                                                && r.symbol === row.symbol
                                                && (r.plugin_ids || []).some((p) => hit.pluginIds?.includes(p)));
                                            const canFire = !!hit && (!!hit.pluginIds?.length || !!hit.skills?.length);
                                            return (
                                                <td key={name} className="py-2.5 pl-3 align-middle">
                                                    <div className="flex items-center justify-center gap-1.5">
                                                        {hit
                                                            ? <VerdictBadge agent={hit} />
                                                            : <span className="font-app-body text-[11px] font-light text-[var(--ink-tertiary)]">—</span>}
                                                        {hit && canFire && (
                                                            <span className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                                                                <AgentActions
                                                                    row={row}
                                                                    agent={hit}
                                                                    rule={rule}
                                                                    onScheduled={(r) => setRules((prev) => [...prev.filter((x) => x.id !== r.id), r])}
                                                                />
                                                            </span>
                                                        )}
                                                    </div>
                                                </td>
                                            );
                                        })}
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                    </Tooltip.Provider>
                </div>
            ) : null}

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

