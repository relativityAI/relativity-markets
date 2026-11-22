import { Flex, Text, Spinner, Box } from "@/compat/ui";
import { useEffect, useState, useCallback, useMemo, useRef, type ReactNode, type CSSProperties } from "react";
import { MdCheck, MdClose } from "react-icons/md";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { AnalysisService, API_BASE, PluginService, listCategories, runPluginLabel, type AlertRuleRow, type McpSource, type PluginSummary, type SkillSummary } from "@/db";
import { formatSeconds } from "@/utils";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { type RunStep, runProgressPct } from "./shared/RunStatus";
import { Progress, ProgressLabel, ProgressValue } from "@/components/ui/progress";
import AgentActivity from "@/components/shared/AgentActivity";
import { motion, AnimatePresence } from "motion/react";
import { dur, ease } from "@/lib/motion";
import { FlagLogo, TickerLogo } from "@/lib/sourceLogos";
import PluginAvatar from "@/components/shared/PluginAvatar";
import { ModelLogo } from "@/lib/modelLogos";
import { Play, CalendarDays, Check, Clock, ChevronDown, Pause, Square, X } from "lucide-react";
import { toaster } from "@/compat/ui";
import {
    MenuDropdown,
    DropdownItem,
    PrimaryButton,
    SecondaryButton,
    ResumingButton,
} from "./shared/AnalysisControls";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import ScheduleCalendar from "@/components/ScheduleCalendar";
import ConfirmDialog from "@/components/ConfirmDialog";
import { DateTimePicker, type DateTimeValue, toDateKey } from "./shared/DateTimePicker";

const MAX_POLL_RETRIES = 600;

type StatusType = "EMPTY" | "PENDING" | "COMPLETED" | "ERROR";

type RunMode = "once" | "scheduled";
type Frequency = "daily" | "weekly" | "biweekly" | "monthly";
const FREQ_LABEL: Record<string, string> = { daily: "Daily", weekly: "Weekly", biweekly: "Biweekly", monthly: "Monthly" };
/** The badge phrase: how the schedule actually reads — "Every Sunday at 9:00 AM",
 *  "Every month on the 22nd at 9:00 AM"… never claims "every day" it doesn't do. */
function schedulePhrase(s: { frequency: string; time: string; start_date?: string | null }): string {
    const at = `at ${humanTime(s.time)}`;
    // start_date pins the weekday (weekly) / day-of-month (monthly) the rule runs on.
    const start = s.start_date ? new Date(`${s.start_date}T00:00:00Z`) : null;
    const day = start ? WEEKDAYS[start.getUTCDay()] : null;
    const dom = start ? start.getUTCDate() : NaN;
    switch (s.frequency) {
        case "daily":
            return `Every day ${at}`;
        case "weekly":
            return day ? `Every ${day} ${at}` : `Every week ${at}`;
        case "biweekly":
            return day ? `Every 2 weeks on ${day} ${at}` : `Every 2 weeks ${at}`;
        case "monthly":
            return Number.isNaN(dom) ? `Every month ${at}` : `Every month on the ${ordinal(dom)} ${at}`;
        case "weekdays":
            return `Weekdays ${at}`;
        case "weekends":
            return `Weekends ${at}`;
        case "once":
            return start ? `Once on ${start.toISOString().slice(0, 10)} ${at}` : `Once ${at}`;
        default:
            // Unknown frequency: say it as-is rather than lie with "every day".
            return `${s.frequency.charAt(0).toUpperCase()}${s.frequency.slice(1)} ${at}`;
    }
}
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
function ordinal(n: number): string {
    const s = ["th", "st", "nd", "rd"];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/** "09:00" → "9:00 AM" (the badge reads like a person would say it). */
function humanTime(hhmm: string): string {
    const [h, m] = hhmm.split(":").map(Number);
    if (Number.isNaN(h)) return hhmm;
    return `${h % 12 || 12}:${String(m || 0).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
}

function elapsed(from?: string | null): string {
    const start = from ? +new Date(from) : NaN;
    if (Number.isNaN(start)) return "";
    const s = Math.max(0, Math.floor((Date.now() - start) / 1000));
    if (s < 60) return `${s}s`;
    return `${Math.floor(s / 60)}m ${s % 60}s`;
}

/** The rows /api/analysis returns for the "running right now" cards. */
interface ActiveRunRow {
    id: string;
    status?: string | null;
    symbol?: string;
    share_name?: string;
    plugin_ids?: string[] | null;
    agent_name?: string;
    started_at?: string | null;
    created_at?: string;
}

/** Field input in the filled-box style: recessed surface, no hairline, 40px tall. */
const FIELD_INPUT =
    "h-10 w-full min-w-0 rounded-[8px] border border-transparent bg-[var(--surface-recessed)] px-3.5 text-sm text-console-ink shadow-none placeholder:text-console-ink-4 focus-visible:border-[color:var(--hairline)] focus-visible:ring-1 focus-visible:ring-console-accent/40 dark:bg-[var(--surface-recessed)]";
const SELECT_CLS =
    "h-10 w-full cursor-pointer rounded-[8px] border border-transparent bg-[var(--surface-recessed)] px-3.5 text-sm text-console-ink shadow-none outline-none focus-visible:ring-1 focus-visible:ring-console-accent/40 dark:bg-[var(--surface-recessed)] [&>option]:bg-[var(--surface-recessed)] [&>option]:text-console-ink";

/** Field label sitting above its control (label → filled box). */
function FieldLabel({ children }: { children: ReactNode }) {
    return <div className="mb-1.5 font-app-body text-[12px] font-normal text-[var(--ink-tertiary)]">{children}</div>;
}

/** Form section: the My-agents heading (light title) over whitespace-separated
 *  rows — no rules, no fills. `collapsible` turns the heading into a disclosure. */
function FormSection({ title, children, collapsible = false }: { title?: string; children: ReactNode; collapsible?: boolean }) {
    const [open, setOpen] = useState(true);
    return (
        <Box pt={6}>
            <div className="px-4">
                {collapsible ? (
                    <h2 className="m-0">
                        <button
                            type="button"
                            onClick={() => setOpen((o) => !o)}
                            aria-expanded={open}
                            className="flex w-full cursor-pointer items-center gap-1.5 text-left font-app-body text-[20px] leading-none font-light tracking-tight text-console-ink"
                        >
                            <ChevronDown
                                className={cn("size-4 shrink-0 transition-transform", open ? "" : "-rotate-90")}
                                aria-hidden
                            />
                            {title}
                        </button>
                    </h2>
                ) : (
                    <h2 className="font-app-body text-[20px] leading-none font-light tracking-tight text-console-ink">
                        {title}
                    </h2>
                )}
            </div>
            {open && <Box mt={3}>{children}</Box>}
        </Box>
    );
}

/** One field block: label above, control(s) below — spacing does the rest. */
function FormRow({ label, children }: { label?: ReactNode; children: ReactNode }) {
    return (
        <Box px={4} py={1.5}>
            {label && <FieldLabel>{label}</FieldLabel>}
            <Flex direction="column" gap={2}>
                {children}
            </Flex>
        </Box>
    );
}

/** Skill picker: search-only results — the dropdown opens on focus/typing and
 *  closes when you click elsewhere. Circular checkboxes; picks render as
 *  avatar badges under the box. */
function SkillPicker({
    skills,
    loading,
    error,
    onRetry,
    selected,
    onToggle,
}: {
    skills: { skill: SkillSummary; plugin: PluginSummary }[];
    loading: boolean;
    error: boolean;
    onRetry: () => void;
    selected: Set<string>;
    onToggle: (id: string) => void;
}) {
    const [query, setQuery] = useState("");
    const [open, setOpen] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);
    // Click anywhere outside → the dropdown drops.
    useEffect(() => {
        if (!open) return;
        const onDown = (e: MouseEvent) => {
            if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener("mousedown", onDown);
        return () => document.removeEventListener("mousedown", onDown);
    }, [open]);
    const lower = query.trim().toLowerCase();
    const visible = lower
        ? skills.filter(({ skill, plugin }) =>
              `${skill.id} ${skill.name} ${skill.description} ${plugin.display_name}`.toLowerCase().includes(lower),
          )
        : [];

    if (error) {
        return (
            <div className="flex flex-col items-start gap-2">
                <p className="font-app-body text-[12px] text-[var(--signal-negative)]">Couldn&apos;t load plugins.</p>
                <button
                    type="button"
                    onClick={onRetry}
                    className="rounded-[6px] border border-[color:var(--hairline)] px-3 py-1 font-app-body text-[12px] text-console-ink hover:text-console-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-console-accent/40"
                >
                    Retry
                </button>
            </div>
        );
    }

    return (
        <div data-testid="skill-picker" ref={rootRef}>
            <div className="pb-2">
                <Input
                    value={query}
                    onChange={(e) => {
                        setQuery(e.target.value);
                        setOpen(true);
                    }}
                    onFocus={() => setOpen(true)}
                    placeholder="Search skills…"
                    aria-label="Search skills"
                    className={FIELD_INPUT}
                />
                {!lower && (
                    <p className="mt-2 font-app-body text-[12px] font-light text-console-ink-3">
                        {loading ? "Loading skills…" : "Type to search every plugin's skills."}
                    </p>
                )}
                {lower && open && (
                    <div className="mt-2 max-h-[300px] divide-y divide-[color:var(--hairline)] overflow-y-auto overflow-x-hidden rounded-[10px] border border-[color:var(--hairline)]">
                        {visible.length === 0 && (
                            <p className="px-2 py-3 font-app-body text-[12px] font-light text-console-ink-3">
                                Nothing matches “{query}”.
                            </p>
                        )}
                        {visible.map(({ skill, plugin }) => {
                            const on = selected.has(skill.id);
                            return (
                                <label
                                    key={skill.id}
                                    className={cn(
                                        "flex w-full cursor-pointer items-center gap-3 px-2 py-2 transition-colors hover:bg-[color-mix(in_srgb,var(--ink-primary)_4%,transparent)]",
                                        on && "bg-[color-mix(in_srgb,var(--signal-positive)_8%,transparent)]",
                                    )}
                                >
                                    <input
                                        type="checkbox"
                                        checked={on}
                                        onChange={() => onToggle(skill.id)}
                                        data-testid={`skill-check-${skill.id}`}
                                        aria-label={`Skill ${skill.id}`}
                                        className="size-4 shrink-0 appearance-none rounded-full border border-[color:var(--hairline)] bg-[var(--surface-recessed)] transition-colors checked:border-[var(--signal-positive)] checked:bg-[var(--signal-positive)]"
                                    />
                                    <span className="min-w-0 flex-1 truncate font-app-mono text-[12.5px] text-console-ink">
                                        {skill.id}
                                    </span>
                                    {/* The owning plugin, as a badge on the row's right edge. */}
                                    <span className="flex max-w-[45%] shrink-0 items-center gap-1.5 rounded-full bg-[var(--surface-recessed)] py-1 pl-1 pr-2.5">
                                        <PluginAvatar plugin={plugin.id} size={24} />
                                        <span className="truncate font-app-body text-[11px] text-console-ink-2">{plugin.display_name}</span>
                                    </span>
                                </label>
                            );
                        })}
                    </div>
                )}
                {/* The picks, as avatar badges — where "N selected" used to sit. */}
                {selected.size > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                        {[...selected].map((id) => {
                            const owner = skills.find((x) => x.skill.id === id);
                            return (
                                <span
                                    key={id}
                                    className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-[var(--surface-recessed)] py-1 pr-1.5 pl-1"
                                >
                                    {owner && <PluginAvatar plugin={owner.plugin.id} size={18} />}
                                    <span className="truncate font-app-mono text-[11.5px] text-console-ink">{id}</span>
                                    <button
                                        type="button"
                                        aria-label={`Remove skill ${id}`}
                                        onClick={() => onToggle(id)}
                                        className="rounded-full p-0.5 text-console-ink-3 transition hover:text-console-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-console-accent/40"
                                    >
                                        <X className="size-3" aria-hidden />
                                    </button>
                                </span>
                            );
                        })}
                    </div>
                )}
            </div>
            {!loading && selected.size === 0 && (
                <p role="alert" className="font-app-body text-[12px] text-[var(--signal-negative)]">
                    Pick at least one skill for this run.
                </p>
            )}
        </div>
    );
}

/** Selected toggle: the New-agent pill with a green tick marking the choice. */
function ModeButton({ selected, onClick, children, testId }: { selected: boolean; onClick: () => void; children: ReactNode; testId?: string }) {
    return (
        <Button
            size="sm"
            variant={selected ? "default" : "outline"}
            className="px-4 font-light"
            aria-pressed={selected}
            onClick={onClick}
            data-testid={testId}
        >
            {selected && <Check className="size-3.5 text-[var(--signal-positive)]" aria-hidden />}
            {children}
        </Button>
    );
}

/** Form action bar: status readout left, actions right — the run button lives here. */
function RunFooter({
    status,
    resuming,
    statusLine,
    canRun,
    hint,
    scheduled,
    onRun,
    onReset,
    elapsedTime,
    analysisDuration,
    correlationId,
}: {
    status: StatusType;
    resuming: boolean;
    statusLine: string;
    canRun: boolean;
    hint: string;
    scheduled: boolean;
    onRun: () => void;
    onReset: () => void;
    elapsedTime: number;
    analysisDuration: string;
    correlationId: string;
}) {
    const action: CSSProperties = {
        width: "auto",
        height: "40px",
        padding: "0 24px",
        borderRadius: "9999px",
        boxShadow: "none",
        fontWeight: 400,
    };
    // The run button: blue (the app's --primary), fully rounded, greyed while disabled.
    const runAction: CSSProperties = {
        ...action,
        background: canRun ? "var(--primary)" : "var(--surface-recessed)",
        color: canRun ? "var(--primary-foreground)" : "var(--ink-tertiary)",
    };
    const ghost: CSSProperties = { height: "36px", borderRadius: "9999px", fontWeight: 300, border: "none", background: "transparent" };

    return (
        <Flex align="center" justify="space-between" gap={3} flexWrap="wrap" px={4} py={3} mt={2} minH="60px">
            <Flex align="center" gap={2} minW={0} flex={1}>
                {status === "EMPTY" && (
                    <Text
                        fontSize="12px"
                        fontWeight={300}
                        color={statusLine ? "var(--ink-secondary)" : "var(--ink-tertiary)"}
                        minW={0}
                        overflow="hidden"
                        textOverflow="ellipsis"
                        whiteSpace="nowrap"
                    >
                        {statusLine || "Select a company to enable the run"}
                    </Text>
                )}
                {status === "PENDING" && (
                    <>
                        <Spinner size="sm" borderWidth="2px" color="var(--accent-primary)" />
                        <Text fontSize="13px" fontWeight={300} color="var(--ink-primary)">
                            {resuming ? "Resuming" : "Running"}
                        </Text>
                        {elapsedTime > 0 && (
                            <Text fontSize="12px" fontWeight={300} color="var(--ink-tertiary)" fontVariantNumeric="tabular-nums" ml="auto">
                                {formatSeconds(elapsedTime)}
                            </Text>
                        )}
                    </>
                )}
                {status === "COMPLETED" && (
                    <>
                        <MdCheck size={16} color="var(--signal-positive)" />
                        <Text fontSize="13px" fontWeight={300} color="var(--ink-primary)">Complete</Text>
                        {analysisDuration && (
                            <Text fontSize="12px" fontWeight={300} color="var(--ink-tertiary)" ml="auto">{analysisDuration}</Text>
                        )}
                    </>
                )}
                {status === "ERROR" && (
                    <>
                        <MdClose size={16} color="var(--signal-negative)" />
                        <Text fontSize="13px" fontWeight={300} color="var(--signal-negative)">Failed</Text>
                    </>
                )}
            </Flex>
            <Flex align="center" gap={2} flexShrink={0}>
                {status === "EMPTY" && !resuming && !canRun && hint && (
                    <Text fontSize="11px" fontWeight={300} color="var(--ink-tertiary)" whiteSpace="nowrap">
                        {hint}
                    </Text>
                )}
                {status === "EMPTY" &&
                    (resuming ? (
                        <ResumingButton style={action}>
                            <Flex align="center" gap={2}>
                                <Spinner size="sm" borderWidth="2px" />
                                <Text fontSize="13px" fontWeight={300}>Resuming analysis…</Text>
                            </Flex>
                        </ResumingButton>
                    ) : (
                        <PrimaryButton onClick={onRun} disabled={!canRun} style={runAction}>
                            {scheduled ? <><CalendarDays size={16} /> Schedule agent</> : <><Play size={16} /> Run analysis</>}
                        </PrimaryButton>
                    ))}
                {status === "PENDING" && (
                    <SecondaryButton onClick={onReset} style={ghost}>Run another</SecondaryButton>
                )}
                {status === "COMPLETED" && (
                    <>
                        {correlationId && (
                            <Link to={`/runs/${correlationId}`} style={{ textDecoration: "none" }}>
                                <PrimaryButton style={action}>View report</PrimaryButton>
                            </Link>
                        )}
                        <SecondaryButton onClick={onReset} style={ghost}>Run again</SecondaryButton>
                    </>
                )}
                {status === "ERROR" && (
                    <>
                        {correlationId && (
                            <Link to={`/runs/${correlationId}`} style={{ textDecoration: "none" }}>
                                <SecondaryButton style={ghost}>View report</SecondaryButton>
                            </Link>
                        )}
                        <SecondaryButton onClick={onReset} style={ghost}>Try again</SecondaryButton>
                    </>
                )}
            </Flex>
        </Flex>
    );
}

export default function Analysis() {
    const { id } = useParams();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();

    const [correlationId, setCorrelationId] = useState<string>(id || "");
    const [status, setStatus] = useState<StatusType>("EMPTY");
    const [loading, setLoading] = useState(false);
    const [analysisDuration, setAnalysisDuration] = useState<string>("");
    const [elapsedTime, setElapsedTime] = useState(0);
    const [steps, setSteps] = useState<RunStep[]>([]);

    const [startedAt, setStartedAt] = useState<number | undefined>(undefined);

    useEffect(() => {
        if (status === "PENDING") {
            const start = startedAt ?? Date.now();
            const tick = () => setElapsedTime(Math.max(0, Math.floor((Date.now() - start) / 1000)));
            tick();
            const interval = setInterval(tick, 1000);
            return () => clearInterval(interval);
        }
    }, [status, startedAt]);

    // CLI parity: the run page passes the same flags as
    // `cli.ts --real --symbol --model --max-steps --max-tokens`.
    // Market is fixed to SEC (the CLI's --source default); the persona comes
    // from the server's seeded default agent — the CLI has no --agent either.
    const [config, setConfig] = useState({
        source: "SEC",
        share: "",
        shareName: "",
    });

    const [stockQuery, setStockQuery] = useState("");
    const [stockItems, setStockItems] = useState<any[]>([]);
    const [stockLoading, setStockLoading] = useState(false);
    // A failed search must not read as a genuinely empty result.
    const [stockError, setStockError] = useState(false);
    // Bumped by the Retry link to re-run the current query.
    const [stockRetry, setStockRetry] = useState(0);
    // The picked search row — carries the metadata the card shows (exchange…).
    const [pickedStock, setPickedStock] = useState<any>(null);
    const stockAbortRef = useRef<AbortController | null>(null);
    const stockDebounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    useEffect(() => {
        if (stockDebounceRef.current) clearTimeout(stockDebounceRef.current);
        if (stockAbortRef.current) stockAbortRef.current.abort();
        const query = stockQuery.trim();
        stockDebounceRef.current = setTimeout(async () => {
            if (!query) {
                setStockItems([]);
                setStockError(false);
                setStockLoading(false);
                return;
            }
            setStockLoading(true);
            const controller = new AbortController();
            stockAbortRef.current = controller;
            try {
                // One search across BOTH markets — the picked row decides the source.
                const params = new URLSearchParams({ query });
                const response = await fetch(`${API_BASE}/stocks/search?${params}`, {
                    signal: controller.signal,
                });
                if (!response.ok) throw new Error(`search failed (${response.status})`);
                const data = await response.json();
                if (!controller.signal.aborted) {
                    setStockItems(Array.isArray(data) ? data : []);
                    setStockError(false);
                }
            } catch (err: any) {
                if (err?.name !== "AbortError") {
                    setStockItems([]);
                    setStockError(true);
                }
            } finally {
                if (!controller.signal.aborted) setStockLoading(false);
            }
        }, 300);
        return () => {
            if (stockDebounceRef.current) clearTimeout(stockDebounceRef.current);
        };
    }, [stockQuery, stockRetry]);

    const [model, setModel] = useState("");
    const [availableModels, setAvailableModels] = useState<string[]>([]);
    const [modelError, setModelError] = useState<string | null>(null);
    const [maxSteps, setMaxSteps] = useState("");
    const [maxTokens, setMaxTokens] = useState("");
    // Available plugins — the skill picker searches every plugin's skills.
    const [plugins, setPlugins] = useState<PluginSummary[]>([]);
    // A failed fetch must not look like "no plugins yet".
    const [pluginsError, setPluginsError] = useState(false);
    // …and neither must the empty state, before the first fetch lands.
    const [pluginsLoading, setPluginsLoading] = useState(true);
    // Skills of every plugin, keyed by plugin id — fetched once the list lands.
    const [pluginSkills, setPluginSkills] = useState<Record<string, SkillSummary[]>>({});
    // The run's skills, picked directly — the owning plugins follow the skills.
    const [selectedSkills, setSelectedSkills] = useState<Set<string>>(new Set());

    // skill id → owning plugin: the picker shows it, the run payload derives from it.
    const skillOwner = useMemo(() => {
        const map = new Map<string, PluginSummary>();
        for (const p of plugins) for (const s of pluginSkills[p.id] ?? []) map.set(s.id, p);
        return map;
    }, [plugins, pluginSkills]);
    const allSkills = useMemo(
        () => plugins.flatMap((p) => (pluginSkills[p.id] ?? []).map((skill) => ({ skill, plugin: p }))),
        [plugins, pluginSkills],
    );
    const pluginIds = useMemo(
        () => [...new Set([...selectedSkills].map((id) => skillOwner.get(id)?.id).filter((id): id is string => !!id))],
        [selectedSkills, skillOwner],
    );
    // Per-run MCP toggles; default = every configured server enabled.
    const [mcpSources, setMcpSources] = useState<McpSource[]>([]);
    const [mcpEnabled, setMcpEnabled] = useState<string[]>([]);
    // Category narrows the company picker (equity is the runnable class).
    const [categories, setCategories] = useState<string[]>([]);
    const [category, setCategory] = useState("");

    const loadPlugins = useCallback(() => {
        setPluginsError(false);
        setPluginsLoading(true);
        PluginService.list()
            .then((list) => setPlugins(list))
            .catch(() => {
                setPlugins([]);
                setPluginsError(true);
            })
            .finally(() => setPluginsLoading(false));
    }, []);

    useEffect(() => {
        loadPlugins();
        listCategories()
            .then((data) => { if (Array.isArray(data)) setCategories(data); })
            .catch(() => {});
        PluginService.mcpSources()
            .then((list) => {
                setMcpSources(list);
                // Settings → MCP decides the default; the toggles still change it per run.
                setMcpEnabled(list.filter((m) => m.enabled).map((m) => m.name));
            })
            .catch(() => {});
    }, [loadPlugins]);

    // Load every plugin's skill list (cached per id; failures cached as empty
    // so a down API can't retry-loop the effect).
    useEffect(() => {
        for (const p of plugins) {
            if (pluginSkills[p.id]) continue;
            PluginService.read(p.id)
                .then((d) => setPluginSkills((prev) => ({ ...prev, [p.id]: d.skills ?? [] })))
                .catch(() => setPluginSkills((prev) => ({ ...prev, [p.id]: [] })));
        }
    }, [plugins, pluginSkills]);

    const toggleSkill = useCallback((id: string) => {
        setSelectedSkills((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }, []);
    const toggleMcp = useCallback(
        (name: string) => setMcpEnabled((prev) => (prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name])),
        [],
    );

    // ?plugin=id preselects — the directory card's “+” shortcut: every skill
    // of that plugin, once its list has landed.
    const presetApplied = useRef(false);
    useEffect(() => {
        const preset = searchParams.get("plugin");
        if (!preset || presetApplied.current) return;
        const skills = pluginSkills[preset];
        if (!skills) return;
        presetApplied.current = true;
        setSelectedSkills((prev) => new Set([...prev, ...skills.map((s) => s.id)]));
    }, [searchParams, pluginSkills]);

    const handleCategoryChange = (next: string) => {
        setCategory(next);
        // Only equity supports a company pick; leaving equity drops it.
        if (next !== "equity") {
            setPickedStock(null);
            setConfig((prev) => ({ ...prev, share: "", shareName: "" }));
        }
    };

    const handleStockPick = useCallback((stock: any) => {
        // Rows from /stocks/search always carry both key styles; pick from the
        // row itself so NSE/SEC rows resolve correctly regardless of prior config.
        const src = String(stock.source || "").toUpperCase() === "NSE" ? "NSE" : "SEC";
        setPickedStock(stock);
        setConfig(prev => ({
            ...prev,
            source: src,
            share: stock.ticker || stock.SYMBOL || "",
            shareName: stock.name || stock.NAME || stock.ticker || stock.SYMBOL || "",
        }));
    }, []);

    // /models is already filtered by the user's added API keys.
    useEffect(() => {
        AnalysisService.getAvailableModels()
            .then((data: unknown) => {
                const fromKeys = Array.isArray(data) ? (data as string[]) : [];
                setAvailableModels([...new Set(["opencode/deepseek-v4.1-flash", ...fromKeys])]);
            })
            .catch(() => setAvailableModels(["opencode/deepseek-v4.1-flash"]));
    }, []);

    const checkModel = useCallback(async (modelId: string) => {
        setModelError(null);
        try {
            const result = await AnalysisService.validateModel(modelId);
            if (!result.valid) {
                setModelError(result.error || "Model validation failed.");
                return false;
            }
            return true;
        } catch (e: any) {
            setModelError(e.response?.data?.error || e.message || "Model validation failed.");
            return false;
        }
    }, []);

    useEffect(() => {
        if (id) {
            fetchAnalysisData(id);
        }
        // fetchAnalysisData is a stable useCallback; effect key is the route id.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [id]);

    const [starting, setStarting] = useState(false);
    const [runError, setRunError] = useState<string | null>(null);
    // The single failure path: message AND status together, so the alert
    // (gated on both) always renders for every failed run.
    const failRun = useCallback((message: string) => {
        setRunError(message);
        setStatus("ERROR");
    }, []);
    // "New alert" on the workspace opens ?mode=alert — alert mode preselected.
    const [runMode, setRunMode] = useState<RunMode>(() => (searchParams.get("mode") === "alert" ? "scheduled" : "once"));
    const [frequency, setFrequency] = useState<Frequency>("daily");
    const [scheduleAt, setScheduleAt] = useState<DateTimeValue>(() => ({ date: toDateKey(new Date()), time: "09:00" }));

    // ── Scheduled Agents: the alert rules (with CRUD) + what's running now ──
    const [alertRules, setAlertRules] = useState<AlertRuleRow[]>([]);
    const [ruleToStop, setRuleToStop] = useState<AlertRuleRow | null>(null);
    const loadAlertRules = useCallback(() => {
        AnalysisService.listAlertRules().then((r) => { if (Array.isArray(r)) setAlertRules(r); }).catch(() => {});
    }, []);

    useEffect(() => {
        loadAlertRules();
        // Every create/delete/enable pokes this event — the list never goes stale.
        window.addEventListener("alert-rules-changed", loadAlertRules);
        return () => window.removeEventListener("alert-rules-changed", loadAlertRules);
    }, [loadAlertRules]);

    const toggleRule = async (rule: AlertRuleRow) => {
        try {
            await AnalysisService.setAlertRuleEnabled(rule.id, !rule.enabled);
        } catch {
            toaster.create({ title: "Couldn't update the alert", type: "error" });
        }
    };

    // Active runs — poll fast while something runs, lazily otherwise.
    const [activeRuns, setActiveRuns] = useState<ActiveRunRow[]>([]);
    useEffect(() => {
        let alive = true;
        let timer: ReturnType<typeof setTimeout>;
        const tick = async () => {
            try {
                const rows = await AnalysisService.listAnalyses();
                if (!alive) return;
                const active = (Array.isArray(rows) ? rows : []).filter(
                    (r: ActiveRunRow) => (r.status || "").toUpperCase() === "RUNNING",
                );
                setActiveRuns(active);
                timer = setTimeout(tick, active.length ? 5000 : 30_000);
            } catch {
                if (alive) timer = setTimeout(tick, 15_000);
            }
        };
        void tick();
        return () => { alive = false; clearTimeout(timer); };
    }, []);

    const runAnalysis = async () => {
        if (starting || status !== "EMPTY") return;
        if (!config.share || !pluginIds.length) return;

        setStarting(true);
        setRunError(null);
        try {
            const isValid = await checkModel(model.trim());
            if (!isValid) return;

            const result = await AnalysisService.runAnalysis({
                share_name: config.shareName || config.share,
                symbol: config.share,
                model: model.trim(),
                source: config.source,
                plugin_ids: pluginIds,
                skills: selectedSkillIds,
                mcp_enabled: mcpEnabled,
                max_steps: maxSteps ? Number(maxSteps) : undefined,
                max_tokens: maxTokens ? Number(maxTokens) : undefined,
            });

            if (result?.id) {
                navigate(`/runs/${result.id}`);
            } else {
                failRun(result?.errors?.join("; ") || "The run could not be started — no run id was returned.");
            }
        } catch (error: any) {
            console.error("Run analysis error:", error);
            failRun(
                error?.response?.data?.error ||
                error?.message ||
                "The run could not be started. Check your selection and try again."
            );
        } finally {
            setStarting(false);
        }
    };

    const createAlert = async () => {
        if (starting || status !== "EMPTY" || !config.share || !pluginIds.length) return;

        setStarting(true);
        setRunError(null);
        try {
            const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
            await AnalysisService.createAlertRule({
                symbol: config.share,
                share_name: config.shareName || config.share,
                source: config.source,
                model: model.trim(),
                plugin_ids: pluginIds,
                skills: selectedSkillIds,
                max_steps: maxSteps ? Number(maxSteps) : undefined,
                max_tokens: maxTokens ? Number(maxTokens) : undefined,
                frequency,
                start_date: scheduleAt.date,
                time: scheduleAt.time,
                timezone,
            });
            toaster.create({
                title: `${FREQ_LABEL[frequency]} alert set`,
                description: `${config.shareName || config.share} · from ${scheduleAt.date} at ${scheduleAt.time} (${timezone})`,
                type: "success",
            });
        } catch (error) {
            console.error("Alert error:", error);
            toaster.create({
                title: "Couldn't set the alert",
                description:
                    (error as { response?: { data?: { error?: string } } })?.response?.data?.error ||
                    (error as Error)?.message ||
                    "The alert could not be created.",
                type: "error",
            });
        } finally {
            setStarting(false);
        }
    };

    const fetchAnalysisData = useCallback(async (analysisId: string) => {
        try {
            setLoading(true);
            const data = await AnalysisService.readAnalysis(analysisId);
            if (data) {
                const exchangeSrc = !data.exchange ? "SEC"
                    : data.exchange.toUpperCase().includes("NSE") ? "NSE" : "SEC";
                setConfig(prev => ({
                    ...prev,
                    share: data.symbol || data.share || prev.share,
                    shareName: data.share_name || prev.shareName,
                    source: exchangeSrc,
                }));

                setCorrelationId(analysisId);

                if (Array.isArray(data.steps)) setSteps(data.steps);
                const runStart = data.started_at || data.created_at;
                if (runStart) setStartedAt(+new Date(runStart));

                const s = (data.status || "").toLowerCase();
                if (s === "complete" || s === "completed" || s === "error" || s === "failed" || s === "success" || s === "budget_exhausted") {
                    const isComplete = s === "complete" || s === "completed" || s === "success";
                    if (isComplete) setStatus("COMPLETED");
                    else failRun(data.error || `The run ended with status “${data.status}”.`);
                    if (data.duration != null) {
                        const d = data.duration;
                        setAnalysisDuration(d >= 60 ? `${Math.floor(d / 60)}m ${Math.floor(d % 60)}s` : `${d.toFixed(1)}s`);
                    }
                } else {
                    setStatus("PENDING");
                }

                if (data.model) setModel(data.model);
            }
        } catch (error: any) {
            const code = error?.response?.status;
            failRun(code
                ? `Couldn't load the run — the server responded ${code}.`
                : "Couldn't load the run — the server could not be reached.");
        } finally {
            setLoading(false);
        }
    }, []);

    const pollRetriesRef = useRef(0);
    useEffect(() => {
        if (status === "PENDING" && correlationId) {
            pollRetriesRef.current = 0;
            const interval = setInterval(async () => {
                try {
                    const data = await AnalysisService.readAnalysis(correlationId);
                    if (data) {
                        if (Array.isArray(data.steps)) setSteps(data.steps);
                        const s = (data.status || "").toLowerCase();
                        if (s === "complete" || s === "completed" || s === "error" || s === "failed" || s === "success" || s === "budget_exhausted") {
                            const isComplete = s === "complete" || s === "completed" || s === "success";
                            if (isComplete) setStatus("COMPLETED");
                            else failRun(data.error || `The run ended with status “${data.status}”.`);
                            if (data.duration != null) {
                                const d = data.duration;
                                setAnalysisDuration(d >= 60 ? `${Math.floor(d / 60)}m ${Math.floor(d % 60)}s` : `${d.toFixed(1)}s`);
                            }
                            clearInterval(interval);
                            if (isComplete) navigate(`/runs/${correlationId}`);
                            return;
                        }
                    }
                } catch {
                    // One failed status poll just retries in 2s; the 20-minute
                    // ceiling below is the path that reports failure loudly.
                }
                pollRetriesRef.current += 1;
                if (pollRetriesRef.current >= MAX_POLL_RETRIES) {
                    clearInterval(interval);
                    failRun("Status checks timed out after 20 minutes — the run may still be going. Reload the page to check on it.");
                }
            }, 2000);
            return () => {
                clearInterval(interval);
                pollRetriesRef.current = 0;
            };
        }
    }, [status, correlationId, navigate]);

    const isConfigComplete = config.share !== "" && !!model.trim();
    // Which MCP server offers web search — the run warns when none is on.
    const webSearchEnabled = mcpSources.some((m) => m.webProvider && mcpEnabled.includes(m.name));
    const selectedSkillIds = [...selectedSkills];
    const skillsLoading = plugins.some((p) => pluginSkills[p.id] === undefined);
    const canRunAnalysis =
        category === "equity" &&
        isConfigComplete &&
        selectedSkillIds.length > 0 &&
        !skillsLoading &&
        (runMode === "once" || (!!scheduleAt.date && !!scheduleAt.time));
    // One line naming what's still missing while the run button is disabled.
    const runHint = canRunAnalysis
        ? ""
        : !category
            ? "Pick a category first"
            : category !== "equity"
                ? "Only equity runs are available"
                : !config.share
                    ? "Pick a company first"
                    : !model.trim()
                        ? "Choose a model"
                        : skillsLoading
                            ? "Loading skills…"
                            : "Choose at least one skill";
    const statusLine = config.share
        ? `${config.share} · ${config.source} · ${runMode === "scheduled" ? `${FREQ_LABEL[frequency]} from ${scheduleAt.date} at ${scheduleAt.time}` : "Single run"}`
        : "";

    return (
        <Box
            bg="var(--surface-canvas)"
            minH="100vh"
            fontFamily="var(--font-body)"
        >
            {starting && (
                <Box
                    position="fixed"
                    inset="0"
                    zIndex={50}
                    bg="var(--surface-canvas)"
                    display="flex"
                    alignItems="center"
                    justifyContent="center"
                    opacity={0.92}
                >
                    <Flex direction="column" align="center" gap={3}>
                        <Spinner size="lg" borderWidth="2px" color="var(--accent-primary)" />
                        <Text fontSize="13px" fontFamily="var(--font-body)" color="var(--ink-secondary)">
                            Running analysis…
                        </Text>
                    </Flex>
                </Box>
            )}
            <Box py={{ base: 4, md: 6 }}>
                {/* Two columns: the form, and this month's schedule beside it. */}
                <div className="flex flex-col gap-8 lg:flex-row lg:items-start">
                <div className="min-w-0 flex-1">
                <AnimatePresence initial={false}>
                    {status === "ERROR" && runError && (
                        <Box
                            as={motion.div}
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: "auto" }}
                            exit={{ opacity: 0, height: 0 }}
                            transition={{ duration: dur.base, ease }}
                            overflow="hidden"
                            mb={4}
                        >
                            <Alert variant="destructive">
                                <AlertTitle>Run error</AlertTitle>
                                <AlertDescription>{runError}</AlertDescription>
                            </Alert>
                        </Box>
                    )}
                </AnimatePresence>

                {/* One flat form: title, quiet sections, action bar — spacing only, no rules. */}
                <Box>
                    <div className="px-4 pt-2 pb-1">
                        <h1 className="rel-run-title font-app-body text-[30px] leading-none font-light tracking-tight">
                            {"New Run".split("").map((ch, i) => (
                                <span
                                    key={i}
                                    className="rel-run-letter"
                                    style={{ animationDelay: `${i * 0.1}s` }}
                                >
                                    {ch === " " ? "\u00A0" : ch}
                                </span>
                            ))}
                        </h1>
                    </div>

                    <FormSection>
                        <FormRow label="Mode">
                            <div className="flex flex-wrap gap-2">
                                {(["once", "scheduled"] as const).map((m) => (
                                    <ModeButton
                                        key={m}
                                        selected={runMode === m}
                                        onClick={() => setRunMode(m)}
                                        testId={m === "scheduled" ? "mode-alert" : undefined}
                                    >
                                        {m === "once" ? "Single" : <><Clock className="size-3.5" aria-hidden /> Alert</>}
                                    </ModeButton>
                                ))}
                            </div>
                        </FormRow>
                        {runMode === "scheduled" && (
                            <FormRow label="Schedule">
                                {/* Frequency + first check side by side, like the modal's two-up schedule. */}
                                <div className="grid gap-3 sm:grid-cols-2">
                                    <select
                                        value={frequency}
                                        onChange={(e) => setFrequency(e.target.value as Frequency)}
                                        aria-label="Checks"
                                        data-testid="run-frequency"
                                        className={SELECT_CLS}
                                    >
                                        {(["daily", "weekly", "biweekly", "monthly"] as const).map((f) => (
                                            <option key={f} value={f}>{FREQ_LABEL[f]}</option>
                                        ))}
                                    </select>
                                    <DateTimePicker value={scheduleAt} onChange={setScheduleAt} />
                                </div>
                            </FormRow>
                        )}
                    </FormSection>

                    <FormSection>
                        {/* Category gates the ticker: only equity has a stock search. */}
                        <FormRow>
                            <div className="grid gap-3 sm:grid-cols-2">
                                <div>
                                    <FieldLabel>Category</FieldLabel>
                                    <select
                                value={category}
                                onChange={(e) => handleCategoryChange(e.target.value)}
                                aria-label="Agent category filter"
                                data-testid="run-category"
                                className={SELECT_CLS}
                            >
                                <option value="">Select category…</option>
                                {categories.map((c) => (
                                    <option key={c} value={c}>{c}</option>
                                ))}
                            </select>
                                </div>
                                {/* Same cell shape as Category: label + control, no extra gap. */}
                                <div>
                                    <FieldLabel>Ticker</FieldLabel>
                                    <MenuDropdown
                                        value={null}
                                        disabled={category !== "equity"}
                                        placeholder={category !== "equity" ? "Pick a category first" : config.share ? "Change company…" : "Search company or symbol…"}
                                        search={{
                                            value: stockQuery,
                                            onChange: setStockQuery,
                                            placeholder: "Search by company name or symbol…",
                                        }}
                                    >
                                    {(close) => (
                                        <Box>
                                            {stockLoading && (
                                                <Text px={3} py={2.5} fontSize="12px" fontFamily="var(--font-body)" color="var(--ink-tertiary)">
                                                    Searching…
                                                </Text>
                                            )}
                                            {!stockLoading && stockItems.length === 0 && (
                                                <Text px={3} py={2.5} fontSize="12px" fontFamily="var(--font-body)" color="var(--ink-tertiary)">
                                                    {stockError ? (
                                                        <>
                                                            Couldn&apos;t search — the lookup failed.{" "}
                                                            <button
                                                                type="button"
                                                                className="font-inherit text-[var(--accent-primary)] underline underline-offset-2"
                                                                onClick={() => setStockRetry((n) => n + 1)}
                                                            >
                                                                Retry
                                                            </button>
                                                        </>
                                                    ) : stockQuery ? `Nothing matches “${stockQuery}”.` : "Start typing to search."}
                                                </Text>
                                            )}
                                            {stockItems.map((stock: any) => {
                                                const sym = stock.ticker || stock.SYMBOL || "";
                                                const nm = stock.name || stock.NAME || sym;
                                                const india = String(stock.source || "").toLowerCase() === "nse";
                                                const market = india ? "NSE" : "SEC";
                                                return (
                                                    <DropdownItem
                                                        key={`${market}-${sym}`}
                                                        label={nm}
                                                        sub={
                                                            <span className="flex items-center gap-1">
                                                                <FlagLogo source={stock.source} size={11} />
                                                                {market}:{sym}
                                                            </span>
                                                        }
                                                        selected={sym === config.share && market === config.source}
                                                        logo={<TickerLogo symbol={sym} size={18} />}
                                                        onClick={() => {
                                                            handleStockPick(stock);
                                                            close();
                                                        }}
                                                    />
                                                );
                                            })}
                                        </Box>
                                    )}
                                    </MenuDropdown>
                                    {/* The picked company — plain line under the picker. */}
                                    {config.share && (
                                        <div className="mt-2.5 flex items-center gap-3 px-1 py-1">
                                            <TickerLogo symbol={config.share} size={40} />
                                            <div className="min-w-0">
                                                <div className="truncate font-app-body text-[15px] font-light leading-tight text-[var(--ink-primary)]">
                                                    {config.shareName || config.share}
                                                </div>
                                                <div className="mt-1 flex items-center gap-1.5 font-app-body text-[12px] font-normal text-[var(--ink-tertiary)]">
                                                    <span className="text-[14px] leading-none">
                                                        <FlagLogo source={config.source} size={14} />
                                                    </span>
                                                    <span className="truncate">
                                                        {config.source}
                                                        {" · "}
                                                        {config.share}
                                                        {pickedStock?.exchange ? ` · ${pickedStock.exchange}` : ""}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </FormRow>
                    </FormSection>

                    <FormSection>
                        {/* Skills — one searchable list across every plugin; the
                            owning plugin rides along on the right of each row. */}
                        <FormRow
                            label={
                                // The live pick count rides next to the label.
                                <span className="flex items-center gap-2">
                                    Skills
                                    <span
                                        aria-label={`${selectedSkills.size} skills selected`}
                                        className="inline-flex size-[18px] items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--gh-blue)_14%,transparent)] font-app-body text-[10px] font-light text-[var(--gh-blue)]"
                                    >
                                        {selectedSkills.size}
                                    </span>
                                </span>
                            }
                        >
                            <SkillPicker
                                skills={allSkills}
                                loading={pluginsLoading || skillsLoading}
                                error={pluginsError}
                                onRetry={loadPlugins}
                                selected={selectedSkills}
                                onToggle={toggleSkill}
                            />
                        </FormRow>
                    </FormSection>

                    <FormSection title="Model options" collapsible>
                        <FormRow label="Model">
                            <div className="flex items-center gap-3">
                            <div className="min-w-0 flex-1" data-testid="run-model">
                                <MenuDropdown
                                    value={model}
                                    placeholder="Select model…"
                                    logo={model ? <ModelLogo model={model} size={16} /> : undefined}
                                >
                                    {(close) => availableModels.map((m) => (
                                        <DropdownItem
                                            key={m}
                                            label={m}
                                            logo={<ModelLogo model={m} size={16} />}
                                            selected={m === model}
                                            onClick={() => {
                                                setModel(m);
                                                setModelError(null);
                                                close();
                                            }}
                                        />
                                    ))}
                                </MenuDropdown>
                            </div>
                            <Link
                                to="/settings"
                                className="shrink-0 font-app-body text-[11px] text-[var(--accent-primary)] underline underline-offset-2 hover:opacity-80"
                            >
                                Add keys
                            </Link>
                            </div>
                            {modelError && (
                                <Text fontSize="11px" fontWeight={400} fontFamily="var(--font-body)" color="var(--signal-negative)">
                                    {modelError}
                                </Text>
                            )}
                        </FormRow>

                        <FormRow>
                            {/* The two limits are peers — one line, two boxes. */}
                            <div className="grid gap-3 sm:grid-cols-2">
                                <div>
                                    <FieldLabel>Max steps</FieldLabel>
                                    <Input
                                        type="number"
                                        min={1}
                                        value={maxSteps}
                                        onChange={(e) => setMaxSteps(e.target.value)}
                                        placeholder="20"
                                        aria-label="Max steps"
                                        data-testid="run-max-steps"
                                        className={FIELD_INPUT}
                                    />
                                </div>
                                <div>
                                    <FieldLabel>Max tokens</FieldLabel>
                                    <Input
                                        type="number"
                                        min={1000}
                                        value={maxTokens}
                                        onChange={(e) => setMaxTokens(e.target.value)}
                                        placeholder="200000"
                                        aria-label="Max tokens"
                                        data-testid="run-max-tokens"
                                        className={FIELD_INPUT}
                                    />
                                </div>
                            </div>
                        </FormRow>
                    </FormSection>

                    <FormSection title="MCP tools">
                        <FormRow label="Servers">
                            {/* Same shape, side by side; the warning spans both. */}
                            <div className="grid gap-2 sm:grid-cols-2">
                                {mcpSources.length === 0 && (
                                    <Text fontSize="12px" fontWeight={400} fontFamily="var(--font-body)" color="var(--ink-tertiary)">
                                        No MCP servers configured.
                                    </Text>
                                )}
                                {mcpSources.map((m) => {
                                    const on = mcpEnabled.includes(m.name);
                                    return (
                                        <div key={m.name} className="flex items-center gap-3">
                                            <button
                                                type="button"
                                                role="switch"
                                                aria-checked={on}
                                                aria-label={m.label}
                                                data-testid={`mcp-${m.name}`}
                                                onClick={() => toggleMcp(m.name)}
                                                className={cn(
                                                    "relative h-5 w-9 shrink-0 rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-console-accent/50",
                                                    on
                                                        ? "border-[var(--signal-positive)] bg-[var(--signal-positive)]"
                                                        : "border-[color:var(--hairline)] bg-transparent",
                                                )}
                                            >
                                                <span
                                                    className={cn(
                                                        "absolute top-0.5 size-3.5 rounded-full bg-white transition-all",
                                                        on ? "left-[18px]" : "left-0.5 bg-console-ink-3",
                                                    )}
                                                />
                                            </button>
                                            <span className="min-w-0">
                                                <span className="font-app-body text-[13px] text-console-ink">{m.label}</span>
                                                {m.webProvider && (
                                                    <span className="ml-2 inline-flex items-center rounded-full bg-[color-mix(in_srgb,var(--gh-blue)_14%,transparent)] px-2 py-0.5 font-app-body text-[10px] font-light tracking-wide text-[var(--gh-blue)] uppercase">
                                                        web search
                                                    </span>
                                                )}
                                            </span>
                                        </div>
                                    );
                                })}
                                {!webSearchEnabled && mcpSources.length > 0 && (
                                    <Alert variant="destructive" className="mt-1 sm:col-span-2">
                                        <AlertTitle>No web search enabled</AlertTitle>
                                        <AlertDescription>
                                            Neither web-search MCP (SearXNG or Tavily) is selected — the run can start, but it won&apos;t be able to search the web.
                                        </AlertDescription>
                                    </Alert>
                                )}
                            </div>
                        </FormRow>
                    </FormSection>

                    <RunFooter
                        status={status}
                        resuming={!!id && status === "EMPTY"}
                        statusLine={statusLine}
                        canRun={canRunAnalysis && !starting}
                        hint={runHint}
                        scheduled={runMode === "scheduled"}
                        onRun={runMode === "scheduled" ? createAlert : runAnalysis}
                        onReset={() => {
                            navigate("/new-run");
                            setStatus("EMPTY");
                            setRunError(null);
                            setSteps([]);
                        }}
                        elapsedTime={elapsedTime}
                        analysisDuration={analysisDuration}
                        correlationId={correlationId}
                    />
                </Box>

                <AnimatePresence mode="wait" initial={false}>
                    {status === "PENDING" && correlationId && (
                        <Box
                            key="progress"
                            as={motion.div}
                            initial={{ opacity: 0, y: 8 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, height: 0 }}
                            transition={{ duration: dur.base, ease }}
                            overflow="hidden"
                            mt={5}
                        >
                            <Flex justify="space-between" align="center" mb={4}>
                                <Flex align="center" gap={2.5}>
                                    <Spinner size="sm" borderWidth="2px" color="var(--accent-primary)" />
                                    <Text fontSize="13px" fontFamily="var(--font-body)" fontWeight={400} color="var(--ink-secondary)">
                                        Analysis in progress.
                                    </Text>
                                </Flex>
                                {elapsedTime > 0 && (
                                    <Text
                                        fontSize="12px"
                                        fontFamily="var(--font-body)"
                                        color="var(--ink-tertiary)"
                                        fontVariantNumeric="tabular-nums"
                                        whiteSpace="nowrap"
                                    >
                                        {formatSeconds(elapsedTime)}
                                    </Text>
                                )}
                            </Flex>
                            <Box maxW="400px" mb={5}>
                                <Progress value={runProgressPct(steps)}>
                                    <ProgressLabel>Progress</ProgressLabel>
                                    <ProgressValue />
                                </Progress>
                            </Box>
                            <AgentActivity
                                title={`Analyzing ${config.shareName || config.share}`}
                                subtitle={`${model} · gathering data, searching, scoring`}
                                streamUrl={`/analysis/${correlationId}/stream`}
                                steps={steps}
                                startedAt={startedAt}
                                active
                            />
                        </Box>
                    )}
                </AnimatePresence>

                {loading && (
                    <Flex justify="center" align="center" gap={3} py={16} color="var(--ink-secondary)">
                        <Spinner size="sm" borderWidth="2px" />
                        <Text fontSize="13px" fontFamily="var(--font-body)">Loading analysis data…</Text>
                    </Flex>
                )}
                </div>

                {/* ── Scheduled Agents: running + scheduled cards — CRUD for
                    schedules lives here now (the workspace's old rail). ── */}
                <aside className="w-full lg:w-[560px] lg:shrink-0">
                    <h2 className="font-app-body text-[30px] leading-none font-light tracking-tight text-console-ink">
                        Scheduled Agents
                    </h2>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                        {activeRuns.map((r) => (
                            <Link
                                key={r.id}
                                to={`/runs/${encodeURIComponent(r.id)}`}
                                className="group rounded-xl border border-[color:var(--hairline)] p-4 transition-colors hover:bg-[color-mix(in_srgb,var(--ink-primary)_4%,transparent)] focus-visible:outline-none focus-visible:[outline-offset:-2px]"
                            >
                                <div className="flex items-center gap-2.5">
                                    <TickerLogo symbol={r.symbol || ""} size={26} />
                                    <p className="min-w-0 flex-1 truncate font-app-body text-[15px] leading-tight font-light text-console-ink">
                                        {r.share_name || r.symbol}
                                    </p>
                                </div>
                                <p className="mt-1 flex items-center gap-1.5 truncate font-app-body text-[12.5px] font-light text-console-ink-3">
                                    <PluginAvatar plugin={r.plugin_ids?.[0] || r.agent_name || "run"} size={16} />
                                    <span className="truncate">{runPluginLabel(r.plugin_ids, plugins, r.agent_name) || "Run"}</span>
                                </p>
                                <span className="mt-2.5 inline-flex max-w-full items-center gap-1.5 rounded-full bg-[color-mix(in_srgb,var(--gh-blue)_14%,transparent)] px-2.5 py-1 font-app-body text-[11.5px] font-light text-[var(--gh-blue)]">
                                    <Clock size={12} aria-hidden className="shrink-0" />
                                    <span className="truncate">Running · {elapsed(r.started_at || r.created_at)}</span>
                                </span>
                            </Link>
                        ))}

                        {alertRules.map((s) => {
                            const label = runPluginLabel(s.plugin_ids, plugins, null) || "Scheduled run";
                            const paused = !s.enabled;
                            return (
                                <div
                                    key={s.id}
                                    className={cn(
                                        "rounded-xl border border-[color:var(--hairline)] p-4",
                                        paused && "opacity-60",
                                    )}
                                >
                                    <div className="flex items-start gap-2.5">
                                        <TickerLogo symbol={s.symbol} size={26} />
                                        <p className="min-w-0 flex-1 truncate font-app-body text-[15px] leading-tight font-light text-console-ink">
                                            {s.share_name || s.symbol}
                                        </p>
                                        <span className="ml-auto flex shrink-0 gap-1">
                                            <button
                                                type="button"
                                                aria-label={`${paused ? "Resume" : "Pause"} schedule for ${s.share_name || s.symbol}`}
                                                onClick={() => void toggleRule(s)}
                                                className="rounded-[6px] p-1.5 text-[var(--gh-blue)] transition hover:bg-[color-mix(in_srgb,var(--gh-blue)_12%,transparent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-console-accent/40"
                                            >
                                                {paused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
                                            </button>
                                            <button
                                                type="button"
                                                aria-label={`Stop schedule for ${s.share_name || s.symbol}`}
                                                onClick={() => setRuleToStop(s)}
                                                className="rounded-[6px] p-1.5 text-[var(--signal-negative)] transition hover:bg-[color-mix(in_srgb,var(--signal-negative)_12%,transparent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-console-accent/40"
                                            >
                                                <Square className="size-3.5" />
                                            </button>
                                        </span>
                                    </div>
                                    <p className="mt-1 flex items-center gap-1.5 truncate font-app-body text-[12.5px] font-light text-console-ink-3">
                                        <PluginAvatar plugin={s.plugin_ids?.[0] || label} size={16} />
                                        <span className="truncate">
                                            {label}{paused && <span className="text-console-ink-4"> · Paused</span>}
                                        </span>
                                    </p>
                                    <span className="mt-2.5 inline-flex max-w-full items-center gap-1.5 rounded-full bg-[color-mix(in_srgb,var(--signal-positive)_14%,transparent)] px-2.5 py-1 font-app-body text-[11.5px] font-light text-[var(--signal-positive)]">
                                        <Clock size={12} aria-hidden className="shrink-0" />
                                        <span className="truncate">
                                            {schedulePhrase(s)}
                                        </span>
                                    </span>
                                </div>
                            );
                        })}

                        {activeRuns.length === 0 && alertRules.length === 0 && (
                            <p className="col-span-full rounded-xl border border-dashed border-[color:var(--hairline)] px-4 py-6 text-center font-app-body text-[13px] font-light text-console-ink-3">
                                Nothing scheduled yet — set the mode to Alert and create one from the form.
                            </p>
                        )}
                    </div>

                    <ConfirmDialog
                        open={!!ruleToStop}
                        title="Stop this schedule?"
                        message={`The ${FREQ_LABEL[ruleToStop?.frequency ?? "daily"].toLowerCase()} check for ${ruleToStop?.share_name || ruleToStop?.symbol || ""} will stop. This can't be undone.`}
                        confirmLabel="Stop"
                        onCancel={() => setRuleToStop(null)}
                        onConfirm={() => {
                            const target = ruleToStop;
                            setRuleToStop(null);
                            if (!target) return;
                            AnalysisService.deleteAlertRule(target.id)
                                .catch(() => toaster.create({ title: "Couldn't delete the schedule", type: "error" }));
                        }}
                    />

                    {/* Month schedule — the same calendar as the home rail, one
                        level of detail up. */}
                    <h2 className="mt-10 font-app-body text-[30px] leading-none font-light tracking-tight text-console-ink">
                        This month
                    </h2>
                    <div className="mt-4">
                        <ScheduleCalendar view="month" />
                    </div>
                </aside>
                </div>
            </Box>
        </Box>
    );
}
