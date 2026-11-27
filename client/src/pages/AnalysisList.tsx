import { useEffect, useRef, useState, useMemo } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { AnalysisService, PluginService, SkillService, runPluginLabel, type PluginSummary } from "@/db";
import PluginAvatar from "@/components/shared/PluginAvatar";
import RunsInsights from "@/components/RunsInsights";
import { listSystemPrompts } from "@/lib/systemPrompts";
import { ModelLogo } from "@/lib/modelLogos";
import { TickerLogo } from "@/lib/sourceLogos";
import { motion, AnimatePresence } from "motion/react";
import { stagger, staggerItem } from "@/lib/motion";
import { Button } from "@/components/ui/button";
import { toaster } from "@/components/ui/toaster";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuLabel,
    DropdownMenuItem,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import ConfirmDialog from "@/components/ConfirmDialog";
import { cn } from "@/lib/utils";
import { runVerdict } from "@/lib/analysisFormat";
import { Calendar, ChevronDown, Clock, MoreHorizontal, Plus, Search } from "lucide-react";

type SortKey = "share" | "created_at" | "score" | "status" | "agent" | "model" | "duration";

interface AnalysisItem {
    analysis_id?: string;
    _id?: string;
    id?: string;
    share_name?: string;
    symbol?: string;
    agent_name?: string;
    agent?: string;
    plugin_ids?: string[] | null;
}

function formatDuration(sec: number): string {
    if (sec == null) return "";
    if (sec >= 60) {
        const m = Math.floor(sec / 60);
        const s = Math.floor(sec % 60);
        return `${m}m ${s}s`;
    }
    return `${sec.toFixed(1)}s`;
}

/** GitHub-style absolute stamp: "Today, 8:00 PM" / "Nov 14, 9:12 AM". */
function whenLabel(dateStr: string): string {
    const d = new Date(dateStr);
    if (isNaN(+d)) return "—";
    const now = new Date();
    const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const diff = Math.round((startOf(now) - startOf(d)) / 86400000);
    const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    if (diff === 0) return `Today, ${time}`;
    if (diff === 1) return `Yesterday, ${time}`;
    return `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}, ${time}`;
}

/** Two loading states use it; not worth a shadcn wrapper. */
function Spinner({ className }: { className?: string }) {
    return (
        <span
            aria-hidden
            className={cn("inline-block size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent", className)}
        />
    );
}

type GroupMode = "individual" | "date" | "agent" | "stock" | "model";

/**
 * GitHub's run status glyph: filled check-circle for a completed run,
 * filled x-circle for a failure, an open dashed ring while running.
 */
function StatusGlyph({ status }: { status: string }) {
    if (status === "error" || status === "failed") {
        return (
            <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                className="text-[var(--gh-red)]"
                role="img"
                aria-label="Failed"
            >
                <circle cx="8" cy="8" r="7" fill="currentColor" />
                <path
                    d="M5.6 5.6l4.8 4.8M10.4 5.6l-4.8 4.8"
                    stroke="#fff"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                />
            </svg>
        );
    }
    if (status === "complete" || status === "completed" || status === "success") {
        return (
            <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                className="text-[var(--gh-green)]"
                role="img"
                aria-label="Completed"
            >
                <circle cx="8" cy="8" r="7" fill="currentColor" />
                <path
                    d="M5 8.2l2 2 4-4.4"
                    stroke="#fff"
                    strokeWidth="1.6"
                    fill="none"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                />
            </svg>
        );
    }
    // Canceled/paused aren't "Running" — name them, same ring, honest label.
    const label =
        status === "canceled" || status === "cancelled"
            ? "Canceled"
            : status === "paused"
              ? "Paused"
              : status === "pending"
                ? "Pending"
                : "Running";
    return (
        <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            className="text-[var(--gh-amber)]"
            role="img"
            aria-label={label}
        >
            <circle
                cx="8"
                cy="8"
                r="6.2"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeDasharray="7 5"
                strokeLinecap="round"
            />
        </svg>
    );
}

const GROUP_VIEWS: { key: GroupMode; label: string }[] = [
    { key: "individual", label: "All runs" },
    { key: "date", label: "Date" },
    { key: "agent", label: "Plugin" },
    { key: "stock", label: "Stock" },
    { key: "model", label: "Model" },
];

/** Sort options behind the header's Sort button (the GitHub filter-button row
    replaced the sortable column headers). */
const SORTS: { key: string; label: string; k: SortKey; dir: "asc" | "desc" }[] = [
    { key: "newest", label: "Newest first", k: "created_at", dir: "desc" },
    { key: "oldest", label: "Oldest first", k: "created_at", dir: "asc" },
    { key: "longest", label: "Longest run", k: "duration", dir: "desc" },
    { key: "highest", label: "Highest score", k: "score", dir: "desc" },
    { key: "lowest", label: "Lowest score", k: "score", dir: "asc" },
    { key: "share", label: "Share A–Z", k: "share", dir: "asc" },
];

/** Sentinel radio value for "no filter". */
const ALL = "all";

/** Sorted unique labels for the header filter menus. */
const uniq = (xs: (string | null | undefined)[]) =>
    Array.from(new Set(xs.filter((x): x is string => Boolean(x)))).sort();

/** GitHub's header control: label (or "Label: value" when set) + chevron. */
function MenuButton({
    label,
    value,
    items,
    onChange,
    align = "start",
    showAll = true,
    def = ALL,
}: {
    label: string;
    value: string;
    items: { value: string; label: string }[];
    onChange: (v: string) => void;
    align?: "start" | "end";
    /** Render the "All" sentinel item (filters). Sort/Group supply their own. */
    showAll?: boolean;
    /** Value considered "not set" — never painted blue. */
    def?: string;
}) {
    const active = value !== ALL && value !== def;
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <button
                    type="button"
                    className={cn(
                        "inline-flex items-center gap-1 text-[14px] font-light transition-colors",
                        active ? "text-[var(--gh-blue)]" : "text-[var(--gh-fg)] hover:text-[var(--gh-blue)]"
                    )}
                >
                    <span className="truncate max-w-[220px]">
                        {active ? `${label}: ${items.find((i) => i.value === value)?.label ?? value}` : label}
                    </span>
                    <ChevronDown className="size-3.5 shrink-0 text-[var(--gh-muted)]" aria-hidden />
                </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align={align} className="min-w-[180px]">
                <DropdownMenuLabel className="text-[12px] text-[var(--gh-muted)]">{label}</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={value} onValueChange={onChange}>
                    {showAll && (
                        <DropdownMenuRadioItem value={ALL} className="text-[14px]">
                            All
                        </DropdownMenuRadioItem>
                    )}
                    {items.map((i) => (
                        <DropdownMenuRadioItem key={i.value} value={i.value} className="text-[14px]">
                            {i.label}
                        </DropdownMenuRadioItem>
                    ))}
                </DropdownMenuRadioGroup>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

function groupAverage(items: any[]): number | null {
    const v = items.map((i) => i.total_score).filter((x: any) => typeof x === "number");
    return v.length ? v.reduce((s: number, x: number) => s + x, 0) / v.length : null;
}

function formatGroupDate(iso: string): string {
    const d = new Date(`${iso}T00:00:00`);
    if (isNaN(+d)) return iso === "undated" ? "Undated" : iso;
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const diff = Math.round((+d - +today) / 86400000);
    const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
    if (d.getFullYear() !== now.getFullYear()) opts.year = "numeric";
    const base = d.toLocaleDateString(undefined, opts);
    if (diff === 0) return `Today, ${base}`;
    if (diff === -1) return `Yesterday, ${base}`;
    return d.toLocaleDateString(undefined, { ...opts, weekday: "short" });
}

function GroupHeaderRow({
    avatar,
    label,
    count,
    avg,
    expanded,
    onToggle,
}: {
    avatar?: React.ReactNode;
    label: string;
    count: number;
    avg: number | null;
    expanded: boolean;
    onToggle: () => void;
}) {
    return (
        <tr
            className="cursor-pointer transition-colors hover:bg-[var(--surface-recessed)]"
            onClick={onToggle}
            aria-expanded={expanded}
        >
            <td colSpan={5} className="pt-4 pb-1.5">
                <div className="flex min-w-0 items-center gap-2">
                    <ChevronDown
                        aria-hidden
                        className={cn(
                            "size-4 shrink-0 text-[var(--gh-muted)] transition-transform",
                            expanded ? "" : "-rotate-90"
                        )}
                    />
                    {avatar}
                    <span className="truncate text-[15px] font-light text-[var(--gh-fg)]">{label}</span>
                    <span className="shrink-0 text-[13px] font-light text-[var(--gh-muted)] tabular-nums">
                        {count} {count === 1 ? "run" : "runs"}
                    </span>
                    {avg != null && (
                        <span className="ml-auto shrink-0 text-[13px] font-light text-[var(--gh-muted)] tabular-nums">
                            avg {avg.toFixed(0)}%
                        </span>
                    )}
                </div>
            </td>
        </tr>
    );
}

export default function AnalysisList() {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    // Stock pages deep-link here with ?q=<symbol> so this page's own search box
    // filters the runs to that stock. Typing in the box still works as usual.
    const symbolQuery = searchParams.get("q") || "";

    const [uniqueAnalysis, setUniqueAnalysis] = useState<any[]>([]);
    const [fetchError, setFetchError] = useState(false);
    const [loading, setLoading] = useState(false);
    // Header controls: sort preset + single-select filters (GitHub's table header).
    const [sort, setSort] = useState("newest");
    const [agentFilter, setAgentFilter] = useState(ALL);
    const [verdictFilter, setVerdictFilter] = useState(ALL);
    const [statusFilter, setStatusFilter] = useState(ALL);
    const [deleteTarget, setDeleteTarget] = useState<AnalysisItem | null>(null);
    // Deferred deletes: run id → timer. Deliberately NOT cleared on unmount —
    // the scheduled delete must still fire after navigating away (the setTimeout
    // outlives the component; setState after unmount is a harmless no-op).
    const pendingDeletes = useRef(new Map<string, ReturnType<typeof setTimeout>>());
    const [plugins, setPlugins] = useState<PluginSummary[]>([]);
    const [viewMode, setViewMode] = useState<GroupMode>("individual");
    const [query, setQuery] = useState(symbolQuery);

    useEffect(() => {
        setQuery(symbolQuery);
    }, [symbolQuery]);
    // Groups start collapsed — the headers themselves are the summary.
    const [expanded, setExpanded] = useState<Set<string>>(new Set());

    const toggleGroup = (key: string) => {
        setExpanded((prev) => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    };

    useEffect(() => {
        PluginService.list()
            .then(setPlugins)
            .catch(() => {});
    }, []);

    // Skill runs badge with the skill's name; built from the skill library.
    const [skills, setSkills] = useState<any[]>([]);
    useEffect(() => {
        SkillService.listSkills()
            .then((data) => {
                if (Array.isArray(data)) setSkills(data);
            })
            .catch(() => {});
    }, []);
    const skillName = (id: string | undefined) => skills.find((s) => s.id === id)?.name || id || "—";

    // Legacy rows keep their stored label (agent era); plugin runs resolve
    // their plugin_ids to display names below.
    const agentName = (raw: string | undefined) => raw || "";

    // Named system prompts (agent.yaml prompts.*) the runs read — the New Run
    // page's "Agent" pick, persisted on the row as system_prompt.
    const [systemPrompts, setSystemPrompts] = useState<{ id: string; name: string; default?: boolean }[]>([]);
    useEffect(() => {
        listSystemPrompts()
            .then((data) => {
                if (Array.isArray(data)) setSystemPrompts(data);
            })
            .catch(() => {});
    }, []);
    /** Chosen prompt name; no id (old rows) = the configured default prompt. */
    const promptName = (id: string | undefined) =>
        (id && systemPrompts.find((t) => t.id === id)?.name) ||
        systemPrompts.find((t) => t.default)?.name ||
        "—";

    const fetchUniqueAnalysis = async (silent = false) => {
        try {
            if (!silent) setLoading(true);
            const data = await AnalysisService.listAnalyses();
            if (Array.isArray(data)) {
                // Rows with a deferred delete still pending exist on the server —
                // drop them so a poll can't bring the row back before its timer.
                const pending = pendingDeletes.current;
                setUniqueAnalysis(
                    pending.size
                        ? data.filter((a: any) => !pending.has(a.analysis_id || a._id || a.id))
                        : data
                );
                setFetchError(false);
            } else if (!silent) {
                setUniqueAnalysis([]);
                setFetchError(true);
            }
        } catch (error) {
            console.log("Analysis fetch error:", error);
            // ponytail: a failed background poll keeps the last good list
            // (stale beats empty); only an explicit load flips to the error state.
            if (!silent) {
                setUniqueAnalysis([]);
                setFetchError(true);
            }
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchUniqueAnalysis();
    }, []);

    // ponytail: fixed 15s poll while the tab is visible — 15s stale ceiling,
    // pause-on-hidden is the only optimisation; gate on in-flight runs or push
    // updates if polling load ever matters.
    useEffect(() => {
        const t = setInterval(() => {
            if (!document.hidden) fetchUniqueAnalysis(true);
        }, 15000);
        return () => clearInterval(t);
    }, []);

    const handleDelete = (id: string | undefined) => {
        // One pending delete per run — scheduling only, the dialog closes now.
        if (!id || pendingDeletes.current.has(id)) return;
        setDeleteTarget(null);
        setUniqueAnalysis((prev) => prev.filter((a) => (a.analysis_id || a._id || a.id) !== id));
        // ponytail: client-side deferral — closing the tab before the 30s elapses
        // skips the delete; upgrade path is a server-side soft-delete
        // (deleted_at + purge job) if that ever matters.
        const timer = setTimeout(() => {
            pendingDeletes.current.delete(id);
            AnalysisService.deleteAnalysis(id).catch((error) => {
                console.error("Delete analysis error:", error);
                const e = error as { response?: { status?: number; data?: { error?: string } }; message?: string };
                const detail = e.response?.data?.error || e.message || "The run could not be deleted.";
                toaster.create({
                    title: "Couldn't delete run",
                    description: e.response?.status ? `HTTP ${e.response.status} — ${detail}` : detail,
                    type: "error",
                });
                fetchUniqueAnalysis(true); // server kept the row — bring it back
            });
        }, 30_000);
        pendingDeletes.current.set(id, timer);
        toaster.create({
            title: "Run deleted",
            duration: 30000,
            action: {
                label: "Undo",
                onClick: () => {
                    const pending = pendingDeletes.current.get(id);
                    if (!pending) return; // undo fires at most once
                    clearTimeout(pending);
                    pendingDeletes.current.delete(id);
                    fetchUniqueAnalysis(true); // refetch can't desync: server still has the row
                    toaster.create({ title: "Delete cancelled", type: "info" });
                },
            },
            type: "info",
        });
    };

    /** A run's plugin as the meta line shows it — also the filter's value. */
    const runAgentLabel = (a: any) =>
        runPluginLabel(a.plugin_ids, plugins, null) || agentName(a.agent_name || a.agent) || promptName(a.system_prompt);

    const sorted = useMemo(() => {
        // Free-text search across share, agent, skill and model.
        const q = query.trim().toLowerCase();
        let base = q
            ? uniqueAnalysis.filter((a) =>
                  [
                      a.symbol,
                      a.share_name,
                      a.model,
                      promptName(a.system_prompt),
                      runAgentLabel(a),
                      skillName(a.skill_id),
                      ...(Array.isArray(a.skill_ids) ? a.skill_ids.map(skillName) : []),
                  ].some((v) => String(v ?? "").toLowerCase().includes(q))
              )
            : uniqueAnalysis;
        if (agentFilter !== ALL) base = base.filter((a) => runAgentLabel(a) === agentFilter);
        if (verdictFilter !== ALL) base = base.filter((a) => runVerdict(a)?.label === verdictFilter);
        if (statusFilter !== ALL)
            base = base.filter((a) => String(a.status || "").toLowerCase() === statusFilter);

        const s = SORTS.find((x) => x.key === sort) ?? SORTS[0];
        return [...base].sort((a, b) => {
            let aVal: any, bVal: any;
            switch (s.k) {
                case "share":
                    aVal = (a.symbol || a.share_name || "").toLowerCase();
                    bVal = (b.symbol || b.share_name || "").toLowerCase();
                    break;
                case "created_at":
                    aVal = new Date(a.created_at || 0).getTime();
                    bVal = new Date(b.created_at || 0).getTime();
                    break;
                case "score":
                    aVal = a.total_score ?? -1;
                    bVal = b.total_score ?? -1;
                    break;
                case "agent":
                    aVal = runAgentLabel(a).toLowerCase();
                    bVal = runAgentLabel(b).toLowerCase();
                    break;
                case "model":
                    aVal = (a.model || "").toLowerCase();
                    bVal = (b.model || "").toLowerCase();
                    break;
                case "duration":
                    aVal = a.duration ?? -1;
                    bVal = b.duration ?? -1;
                    break;
                case "status":
                    aVal = (a.status || "").toLowerCase();
                    bVal = (b.status || "").toLowerCase();
                    break;
                default:
                    return 0;
            }
            if (aVal < bVal) return s.dir === "asc" ? -1 : 1;
            if (aVal > bVal) return s.dir === "asc" ? 1 : -1;
            return 0;
        });
    }, [uniqueAnalysis, sort, query, agentFilter, verdictFilter, statusFilter, plugins, skills, systemPrompts]);

    // Header filter-menu options, derived from the data actually loaded.
    const agentOptions = useMemo(
        () => uniq(uniqueAnalysis.map(runAgentLabel).filter((l) => l && l !== "—")),
        [uniqueAnalysis, plugins, systemPrompts]
    );
    const verdictOptions = useMemo(
        () => uniq(uniqueAnalysis.map((a) => runVerdict(a)?.label ?? null)),
        [uniqueAnalysis]
    );
    const statusOptions = useMemo(
        () => uniq(uniqueAnalysis.map((a) => String(a.status || "").toLowerCase() || null)),
        [uniqueAnalysis]
    );

    // Grouped sections for the non-individual views. Within each group the
    // current sort order is preserved; groups themselves sort by name (or
    // newest-first for dates).
    const sections = useMemo(() => {
        if (viewMode === "individual") return [{ key: "all", items: sorted }];
        const keyOf = (a: any): string => {
            switch (viewMode) {
                case "date":
                    return a.created_at ? new Date(a.created_at).toISOString().slice(0, 10) : "undated";
                case "agent":
                    return runAgentLabel(a);
                case "stock":
                    return String(a.share_name || a.symbol || "Unknown stock");
                case "model":
                    return a.model || "unknown";
                default:
                    return "";
            }
        };
        const map = new Map<string, any[]>();
        for (const a of sorted) {
            const k = keyOf(a);
            if (!map.has(k)) map.set(k, []);
            map.get(k)!.push(a);
        }
        const keys = Array.from(map.keys()).sort((x, y) =>
            viewMode === "date" ? y.localeCompare(x) : x.localeCompare(y)
        );
        return keys.map((k) => ({ key: k, items: map.get(k)! }));
    }, [viewMode, sorted, systemPrompts, plugins]);

    // Collapsed groups render only their header row.
    const visibleSections = useMemo(
        () =>
            viewMode === "individual"
                ? sections
                : sections.map((s) => (expanded.has(s.key) ? s : { ...s, items: [] })),
        [viewMode, sections, expanded]
    );

    const colSpan = 5;

    const onRowClick = (id: string) => {
        navigate("/runs/" + id);
    };

    return (
        <div className="min-h-full bg-[var(--surface-canvas)]">
            {/*
             * Masthead. The App wrapper already carries the navbar's 1.5rem
             * gutter, so this page adds no horizontal padding of its own —
             * the title lines up with the nav above it.
             */}
            <div className="flex w-full flex-col gap-6 py-6">
                <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
                    <div className="min-w-0">
                        <h1 className="text-[30px] leading-tight font-light tracking-[-0.01em] text-[var(--gh-fg)]">
                            Runs
                        </h1>
                        <p className="mt-0.5 text-[15px] font-light text-[var(--gh-muted)]">
                            Every run, powered by the plugins it used
                        </p>
                    </div>
                    <motion.div whileHover={{ y: -1 }} whileTap={{ scale: 0.97 }} className="shrink-0">
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => navigate("/new-run")}
                            className="px-4"
                        >
                            <Plus /> New Run
                        </Button>
                    </motion.div>
                </header>

                {/* Search — full width, no box: icon + light large text */}
                <div className="relative">
                    <Search
                        aria-hidden
                        className="pointer-events-none absolute top-1/2 left-0 size-4 -translate-y-1/2 text-[var(--gh-muted)]"
                    />
                    <input
                        type="text"
                        placeholder="Search runs"
                        aria-label="Search runs"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        className="h-9 w-full border-0 bg-transparent py-1 pr-3 pl-6 text-[16px] font-light text-[var(--gh-fg)] transition-colors placeholder:text-[var(--gh-muted)]"
                    />
                </div>

                {/*
                 * Two columns: insights stacked on the left (one width each),
                 * the runs table taking the wide right half.
                 */}
                <div className="grid grid-cols-1 gap-x-16 gap-y-8 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
                    {/* Left — insights in one thin-bordered box */}
                    <div className="min-w-0 rounded-xl border-[0.5px] border-[color:var(--hairline)] p-5">
                        <RunsInsights runs={uniqueAnalysis} labelPlugin={runAgentLabel} />
                    </div>

                    {/* Main table */}
                    <div className="min-w-0">
                    {loading && uniqueAnalysis.length === 0 ? (
                        <div className="flex justify-center gap-3 py-16 text-[var(--gh-muted)]">
                            <Spinner />
                            <span className="text-[15px] font-light">Loading runs…</span>
                        </div>
                    ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full min-w-[560px] border-collapse text-[15px]">
                                    <thead>
                                        <tr>
                                            <th colSpan={colSpan} className="p-0 text-left font-normal">
                                                <div className="flex flex-wrap items-center justify-between gap-2 py-2">
                                                    <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
                                                        <span className="text-[15px] font-light text-[var(--gh-fg)] tabular-nums">
                                                            {sorted.length} run{sorted.length === 1 ? "" : "s"}
                                                        </span>
                                                        <MenuButton
                                                            label="Sort"
                                                            value={sort}
                                                            def="newest"
                                                            showAll={false}
                                                            items={SORTS.map((s) => ({ value: s.key, label: s.label }))}
                                                            onChange={setSort}
                                                        />
                                                        <MenuButton
                                                            label="Group by"
                                                            value={viewMode === "individual" ? ALL : viewMode}
                                                            showAll={false}
                                                            items={[
                                                                { value: ALL, label: "All runs" },
                                                                ...GROUP_VIEWS.filter((g) => g.key !== "individual").map(
                                                                    (g) => ({ value: g.key, label: g.label })
                                                                ),
                                                            ]}
                                                            onChange={(v) =>
                                                                setViewMode((v === ALL ? "individual" : v) as GroupMode)
                                                            }
                                                        />
                                                    </div>
                                                    <div className="flex flex-wrap items-center gap-1.5">
                                                        <MenuButton
                                                            label="Plugin"
                                                            value={agentFilter}
                                                            items={agentOptions.map((a) => ({ value: a, label: a }))}
                                                            onChange={setAgentFilter}
                                                            align="end"
                                                        />
                                                        <MenuButton
                                                            label="Verdict"
                                                            value={verdictFilter}
                                                            items={verdictOptions.map((v) => ({ value: v, label: v }))}
                                                            onChange={setVerdictFilter}
                                                            align="end"
                                                        />
                                                        <MenuButton
                                                            label="Status"
                                                            value={statusFilter}
                                                            items={statusOptions.map((s) => ({
                                                                value: s,
                                                                label: s.charAt(0).toUpperCase() + s.slice(1),
                                                            }))}
                                                            onChange={setStatusFilter}
                                                            align="end"
                                                        />
                                                    </div>
                                                </div>
                                            </th>
                                        </tr>
                                    </thead>
                                    <motion.tbody variants={stagger} initial="initial" animate="animate">
                                        <AnimatePresence initial={false}>
                                        {loading ? (
                                            <motion.tr key="loading" variants={staggerItem} exit={{ opacity: 0 }}>
                                                <td colSpan={colSpan} className="py-12">
                                                    <div className="flex justify-center gap-3 text-[var(--gh-muted)]">
                                                        <Spinner />
                                                        <span className="text-[15px] font-light">Loading runs…</span>
                                                    </div>
                                                </td>
                                            </motion.tr>
                                        ) : fetchError ? (
                                            <motion.tr key="error" variants={staggerItem} exit={{ opacity: 0 }}>
                                                <td colSpan={colSpan} className="py-8">
                                                    <p className="text-[15px] font-light text-[var(--gh-fg)]">
                                                        Failed to fetch runs.
                                                    </p>
                                                    <p className="mt-1 text-[14px] font-light text-[var(--gh-muted)]">
                                                        Check if the backend service is running.
                                                    </p>
                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        className="mt-3"
                                                        onClick={() => fetchUniqueAnalysis()}
                                                    >
                                                        Retry
                                                    </Button>
                                                </td>
                                            </motion.tr>
                                        ) : sorted.length === 0 && !loading ? (
                                            <motion.tr key="empty" variants={staggerItem} exit={{ opacity: 0 }}>
                                                <td
                                                    colSpan={colSpan}
                                                    className="py-12 text-center text-[15px] font-light text-[var(--gh-muted)]"
                                                >
                                                    {uniqueAnalysis.length === 0 ? (
                                                        "No runs yet — start one from New Run."
                                                    ) : (
                                                        <span>
                                                            No runs match your filters.{" "}
                                                            <button
                                                                type="button"
                                                                onClick={() => {
                                                                    setQuery("");
                                                                    setAgentFilter(ALL);
                                                                    setVerdictFilter(ALL);
                                                                    setStatusFilter(ALL);
                                                                }}
                                                                className="cursor-pointer text-[var(--gh-blue)] underline underline-offset-2"
                                                            >
                                                                Clear filters
                                                            </button>
                                                        </span>
                                                    )}
                                                </td>
                                            </motion.tr>
                                        ) : (
                                            visibleSections.flatMap((sec) => [
                                                ...(viewMode === "individual"
                                                    ? []
                                                    : [
                                                        <GroupHeaderRow
                                                            key={`h-${sec.key}`}
                                                            avatar={
                                                                viewMode === "agent" ? (
                                                                    <PluginAvatar plugin={sec.key} size={24} />
                                                                ) : viewMode === "model" ? (
                                                                    <ModelLogo model={sec.key} size={14} />
) : viewMode === "stock" ? (
                                                                <TickerLogo
                                                                    symbol={sections.find((s) => s.key === sec.key)?.items[0]?.symbol}
                                                                    size={18}
                                                                />
                                                            ) : null
                                                            }
                                                            label={viewMode === "date" ? formatGroupDate(sec.key) : sec.key}
                                                            count={sections.find((s) => s.key === sec.key)?.items.length ?? sec.items.length}
                                                            avg={groupAverage(sections.find((s) => s.key === sec.key)?.items || sec.items)}
                                                            expanded={expanded.has(sec.key)}
                                                            onToggle={() => toggleGroup(sec.key)}
                                                        />,
                                                    ]),
                                                ...sec.items.map((item) => {
                                                const id =
                                                    item.analysis_id || item._id || item.id;
                                                const itemStatus = (
                                                    item.status || ""
                                                ).toLowerCase();
                                                const isItemComplete =
                                                    itemStatus === "complete" ||
                                                    itemStatus === "completed" ||
                                                    itemStatus === "success";
                                                // Verdict: harness runs carry the CLI's quality
                                                // grade inside report.verdict (list selects it as
                                                // the flat `verdict` key via report->verdict);
                                                // skill-era rows fall back to the score-band label.
                                                const verdict = runVerdict(item);
                                                // duration is written by harness runs; older rows
                                                // fall back to created→updated wall time.
                                                const durSec =
                                                    item.duration != null
                                                        ? item.duration
                                                        : isItemComplete &&
                                                            item.created_at &&
                                                            item.updated_at
                                                          ? (+new Date(item.updated_at) -
                                                                +new Date(item.created_at)) /
                                                            1000
                                                          : null;
                                                // The run's plugin (legacy rows: stored label, then prompt name).
                                                const agentLabel = runAgentLabel(item);

                                                return (
                                                    <motion.tr
                                                        variants={staggerItem}
                                                        exit={{ opacity: 0 }}
                                                        layout={false}
                                                        key={id}
                                                        onClick={(e) => {
                                                            // The title cell is a real <Link>: let it
                                                            // navigate (native ctrl-click/new tab).
                                                            if ((e.target as Element).closest?.("a")) return;
                                                            // Modified click = open in a new tab
                                                            // (browser-style); plain click navigates.
                                                            if (
                                                                e.ctrlKey ||
                                                                e.metaKey ||
                                                                e.shiftKey ||
                                                                e.altKey
                                                            ) {
                                                                window.open(
                                                                    "/runs/" + id,
                                                                    "_blank"
                                                                );
                                                                return;
                                                            }
                                                            onRowClick(id);
                                                        }}
                                                        className="group cursor-pointer transition-colors duration-[160ms] hover:bg-[var(--surface-recessed)]"
                                                    >
                                                        {/* Status glyph — leading check/x */}
                                                        <td className="w-[42px] py-3.5 pr-2 align-top">
                                                            <StatusGlyph status={itemStatus} />
                                                        </td>

                                                        {/* Run — title line + meta line; agent and model
                                                            fold into the meta cell */}
                                                        <td className="max-w-[420px] py-3.5 pr-4 align-top">
                                                            <div className="flex min-w-0 items-center gap-2">
                                                                <TickerLogo symbol={item.symbol} size={18} />
                                                                <Link
                                                                    to={`/runs/${id}`}
                                                                    className="truncate text-[16px] font-light text-[var(--gh-fg)]"
                                                                >
                                                                    {item.share_name || item.symbol || "—"}
                                                                </Link>
                                                            </div>
                                                            <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[13px] font-light text-[var(--gh-muted)]">
                                                                {item.share_name &&
                                                                    item.symbol &&
                                                                    item.share_name !== item.symbol && (
                                                                        <>
                                                                            <span>{item.symbol}</span>
                                                                            <span aria-hidden="true">·</span>
                                                                        </>
                                                                    )}
                                                                <PluginAvatar
                                                                    plugin={
                                                                        item.plugin_ids?.[0] ||
                                                                        item.agent_name ||
                                                                        item.system_prompt
                                                                    }
                                                                    size={16}
                                                                />
                                                                <span className="truncate" title={agentLabel}>
                                                                    {agentLabel}
                                                                </span>
                                                                {item.run_mode !== "agent" && (
                                                                    <span aria-hidden="true">·</span>
                                                                )}
                                                                {item.run_mode !== "agent" && (
                                                                    <span className="text-[13px] text-[var(--gh-muted)]">
                                                                        skill run
                                                                    </span>
                                                                )}
                                                                <span aria-hidden="true">·</span>
                                                                <ModelLogo model={item.model} size={14} />
                                                                <span
                                                                    className="truncate"
                                                                    title={item.model || undefined}
                                                                >
                                                                    {item.model || "—"}
                                                                </span>
                                                            </div>
                                                        </td>

                                                        {/* Verdict — tinted word, no pill */}
                                                        <td className="py-3.5 pr-4 align-top">
                                                            {verdict ? (
                                                                <span
                                                                    className="gh-chip text-[15px]"
                                                                    data-tone={verdict.tone}
                                                                >
                                                                    {verdict.label}
                                                                </span>
                                                            ) : (
                                                                <span className="text-[15px] font-light text-[var(--gh-muted)]">
                                                                    —
                                                                </span>
                                                            )}
                                                        </td>

                                                        {/* When + duration — icon-stacked right block */}
                                                        <td className="py-3.5 pr-4 align-top">
                                                            <div className="grid grid-cols-[16px_1fr] items-center gap-x-2 gap-y-1">
                                                                <Calendar
                                                                    aria-hidden
                                                                    className="size-4 text-[var(--gh-muted)]"
                                                                />
                                                                <span
                                                                    className="text-[15px] font-light whitespace-nowrap text-[var(--gh-fg)]"
                                                                    title={
                                                                        item.created_at
                                                                            ? new Date(
                                                                                  item.created_at
                                                                              ).toLocaleString()
                                                                            : undefined
                                                                    }
                                                                >
                                                                    {item.created_at
                                                                        ? whenLabel(item.created_at)
                                                                        : "—"}
                                                                </span>
                                                                <Clock
                                                                    aria-hidden
                                                                    className="size-4 text-[var(--gh-muted)]"
                                                                />
                                                                <span className="text-[15px] font-light whitespace-nowrap text-[var(--gh-muted)] tabular-nums">
                                                                    {durSec != null && durSec >= 0
                                                                        ? formatDuration(durSec)
                                                                        : "—"}
                                                                </span>
                                                            </div>
                                                        </td>

                                                        {/* Row actions — GitHub's kebab */}
                                                        <td className="w-[44px] py-3 pr-3 text-right align-top">
                                                            <DropdownMenu>
                                                                <DropdownMenuTrigger asChild>
                                                                    <button
                                                                        type="button"
                                                                        aria-label="Run actions"
                                                                        onClick={(e) => e.stopPropagation()}
                                                                        className="inline-flex size-7 items-center justify-center rounded-md text-[var(--gh-muted)] transition-opacity hover:bg-[var(--surface-raised)] focus-visible:opacity-100 md:opacity-0 md:group-hover:opacity-100"
                                                                    >
                                                                        <MoreHorizontal
                                                                            aria-hidden
                                                                            className="size-4"
 />
                                                                    </button>
                                                                </DropdownMenuTrigger>
                                                                <DropdownMenuContent
                                                                    align="end"
                                                                    className="min-w-[190px]"
                                                                    /* Portaled menu items bubble through the
                                                                       React tree into the row's onClick. */
                                                                    onClick={(e) => e.stopPropagation()}
                                                                >
                                                                    <DropdownMenuItem
                                                                        className="text-[14px]"
                                                                        onSelect={() => onRowClick(id)}
                                                                    >
                                                                        Open run
                                                                    </DropdownMenuItem>
                                                                    <DropdownMenuItem
                                                                        className="text-[14px]"
                                                                        onSelect={() =>
                                                                            window.open(
                                                                                "/runs/" + id,
                                                                                "_blank"
                                                                            )
                                                                        }
                                                                    >
                                                                        Open in new tab
                                                                    </DropdownMenuItem>
                                                                    <DropdownMenuItem
                                                                        className="text-[14px]"
                                                                        onSelect={() =>
                                                                            navigator.clipboard?.writeText(
                                                                                `${window.location.origin}/runs/${id}`
                                                                            )
                                                                        }
                                                                    >
                                                                        Copy link
                                                                    </DropdownMenuItem>
                                                                    {(itemStatus === "pending" ||
                                                                        itemStatus === "running" ||
                                                                        itemStatus === "processing") && (
                                                                        <DropdownMenuItem
                                                                            className="text-[14px]"
                                                                            variant="destructive"
                                                                            onSelect={() => {
                                                                                AnalysisService.cancelAnalysis(id)
                                                                                    .then(() => toaster.create({ title: "Run canceled", type: "info" }))
                                                                                    .catch(() =>
                                                                                        toaster.create({
                                                                                            title: "Couldn't cancel the run",
                                                                                            type: "error",
                                                                                        }),
                                                                                    );
                                                                            }}
                                                                        >
                                                                            Cancel run
                                                                        </DropdownMenuItem>
                                                                    )}
                                                                    <DropdownMenuSeparator />
                                                                    <DropdownMenuItem
                                                                        variant="destructive"
                                                                        className="text-[14px]"
                                                                        onSelect={() =>
                                                                            setDeleteTarget(item)
                                                                        }
                                                                    >
                                                                        Delete
                                                                    </DropdownMenuItem>
                                                                </DropdownMenuContent>
                                                            </DropdownMenu>
                                                        </td>
                                                    </motion.tr>
                                                );
                                            }),
                                        ])
                                        )}
</AnimatePresence>
                                    </motion.tbody>
                                </table>
                            </div>
                    )}
                    </div>
                </div>
            </div>

            {/* Delete confirmation */}
            <ConfirmDialog
                open={deleteTarget !== null}
                title="Delete run?"
                message={
                    deleteTarget
                        ? `"${deleteTarget.share_name || deleteTarget.symbol || "this run"}"${
                              runAgentLabel(deleteTarget) && runAgentLabel(deleteTarget) !== "—"
                                  ? ` · ${runAgentLabel(deleteTarget)}`
                                  : ""
                          } will be permanently removed and cannot be undone.`
                        : ""
                }
                onCancel={() => setDeleteTarget(null)}
                onConfirm={() =>
                    handleDelete(deleteTarget?.analysis_id || deleteTarget?._id || deleteTarget?.id)
                }
            />
        </div>
    );
}
