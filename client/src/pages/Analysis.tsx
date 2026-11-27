import { Flex, Text, Spinner, Box } from "@/compat/ui";
import { useEffect, useState, useCallback, useMemo, useRef, type ReactNode, type CSSProperties } from "react";
import { MdCheck, MdClose } from "react-icons/md";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { AnalysisService, API_BASE, PluginService, TaxonomyService, runPluginLabel, type AlertRuleRow, type GroupDetail, type McpSource, type PluginSummary, type SkillSummary } from "@/db";
import { formatSeconds } from "@/utils";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { type RunStep, runProgressPct } from "./shared/RunStatus";
import { Progress, ProgressLabel, ProgressValue } from "@/components/ui/progress";
import AgentActivity from "@/components/shared/AgentActivity";
import { motion, AnimatePresence } from "motion/react";
import { dur, ease } from "@/lib/motion";
import { FlagLogo, TickerLogo } from "@/lib/sourceLogos";
import { mcpServerState, MCP_STATE_DOT, requiredIssue } from "@/lib/mcp";
import PluginAvatar from "@/components/shared/PluginAvatar";
import EntitySearch, { GroupMark, type EntityPick } from "@/components/search/EntitySearch";
import { ModelLogo, providerDisplayName } from "@/lib/modelLogos";
import { Play, CalendarDays, Check, Clock, ChevronDown, MoreHorizontal, Pause, Search, Trash2, X } from "lucide-react";
import { toaster } from "@/compat/ui";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { runVerdict, verdictInk } from "@/lib/analysisFormat";
import { timeUntil } from "@/lib/relativeTime";
import {
    MenuDropdown,
    DropdownItem,
    PrimaryButton,
    SecondaryButton,
    ResumingButton,
} from "./shared/AnalysisControls";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn, errorCopy } from "@/lib/utils";
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

/** The rows /api/analysis returns for a schedule's last-run verdict. */
interface ActiveRunRow {
    id: string;
    status?: string | null;
    symbol?: string;
    share_name?: string;
    plugin_ids?: string[] | null;
    agent_name?: string;
    verdict?: string | null;
    total_score?: number | null;
    started_at?: string | null;
    created_at?: string;
}

/** The header menu on a schedule card — same rounding the watchlist uses. */
const MENU_CLS = "rounded-[12px] [&_[data-slot=dropdown-menu-item]]:rounded-[8px]";

/** "Europe/Berlin" → "CET": the zone's short name as the browser reports it in
 *  this locale, so "Every Sunday at 9:00 AM" can carry its timezone. */
function tzLabel(tz: string): string {
    try {
        const part = new Intl.DateTimeFormat(undefined, { timeZone: tz, timeZoneName: "short" })
            .formatToParts(new Date())
            .find((p) => p.type === "timeZoneName");
        return part?.value || tz;
    } catch {
        return tz; // not a valid IANA zone — show it verbatim rather than hide it
    }
}

/** One schedule card: logo + name · ticker + state badge + ⋯ menu, the agent
 *  label, the cadence with its timezone, last/next run as relative times, then
 *  the two actions (pause/resume is the primary, delete lives in the menu).
 *  The title link stretches over the whole card, so a click anywhere opens the
 *  run history — buttons and menu sit above it (z-10) and stop at their own
 *  click. `busy` is this rule's action in flight (disabled + aria-busy). */
function ScheduleCard({
    rule,
    plugins,
    runs,
    occs,
    now,
    busy,
    onToggle,
    onRunNow,
    onDelete,
}: {
    rule: AlertRuleRow;
    plugins: PluginSummary[];
    runs: ActiveRunRow[];
    occs: { rule_id: string; at: number }[];
    now: number;
    busy: boolean;
    onToggle: () => void;
    onRunNow: () => void;
    onDelete: () => void;
}) {
    const name = rule.share_name || rule.symbol;
    const label = runPluginLabel(rule.plugin_ids, plugins, null) || "Scheduled run";
    const paused = !rule.enabled;

    // Next / last fire: the occurrence instants the calendars already fetch,
    // split on now — exact on the rule's own clock, no timezone math here.
    const times = occs.filter((o) => o.rule_id === rule.id).map((o) => o.at).sort((a, b) => a - b);
    const nextAt = times.find((t) => t > now);
    const past = times.filter((t) => t <= now);
    const lastAt = past[past.length - 1];
    const fired = Boolean(rule.last_fired_date || rule.last_run_id);
    const lastRun = rule.last_run_id ? runs.find((r) => r.id === rule.last_run_id) : undefined;
    const lastWord = lastRun
        ? runVerdict(lastRun)?.label ||
          ((lastRun.status || "").toUpperCase() === "ERROR" ? "Failed" : null)
        : null;

    // This rule's symbol + plugins running right now = the Running state.
    const running = runs.some(
        (r) =>
            (r.status || "").toUpperCase() === "RUNNING" &&
            r.symbol === rule.symbol &&
            (!rule.plugin_ids?.length || (r.plugin_ids || []).some((p) => rule.plugin_ids?.includes(p))),
    );
    const state = running
        ? { word: "Running", dot: "var(--signal-live)" }
        : paused
          ? { word: "Paused", dot: "var(--ink-tertiary)" }
          : { word: "Active", dot: "var(--signal-positive)" };

    return (
        <div
            data-state={state.word.toLowerCase()}
            className={cn(
                "group relative cursor-pointer rounded-xl border border-[color:var(--hairline)] p-4 transition-colors",
                "hover:bg-[color-mix(in_srgb,var(--ink-primary)_4%,transparent)]",
                "active:bg-[color-mix(in_srgb,var(--ink-primary)_7%,transparent)]",
                "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-console-accent/50",
                paused && "opacity-70",
            )}
        >
            <div className="flex items-start gap-2.5">
                <TickerLogo symbol={rule.symbol} size={26} />
                <div className="min-w-0 flex-1">
                    <Link
                        to={`/analysis?q=${encodeURIComponent(rule.symbol)}`}
                        className="block truncate font-app-body text-[15px] leading-tight font-normal text-console-ink after:absolute after:inset-0 after:content-[''] hover:text-console-ink"
                    >
                        {name}
                        {rule.symbol && rule.symbol !== name && (
                            <span className="text-console-ink-3"> · {rule.symbol}</span>
                        )}
                    </Link>
                    <p className="mt-1 flex min-w-0 items-center gap-1.5 font-app-body text-[12.5px] font-normal text-console-ink-2">
                        <PluginAvatar plugin={rule.plugin_ids?.[0] || label} size={16} />
                        <span className="truncate">{label}</span>
                    </p>
                </div>
                <Badge
                    variant="secondary"
                    className={cn(
                        "relative z-10",
                        // Docs' own custom-colour recipes (ui.shadcn.com Badge →
                        // Custom Colors): sky = running, green = active, the
                        // stock secondary = paused.
                        running && "bg-sky-50 text-sky-700 dark:bg-sky-950 dark:text-sky-300",
                        !running && !paused && "bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300",
                    )}
                >
                    <span className="size-[6px] shrink-0 rounded-full" style={{ background: state.dot }} aria-hidden />
                    {state.word}
                </Badge>
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            aria-label={`Schedule actions for ${name}`}
                            className="relative z-10 text-console-ink-3 hover:text-console-ink"
                        >
                            <MoreHorizontal aria-hidden />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className={`min-w-[190px] ${MENU_CLS}`}>
                        <DropdownMenuItem
                            variant="destructive"
                            className="gap-2.5"
                            onSelect={(e) => { e.preventDefault(); onDelete(); }}
                        >
                            <Trash2 aria-hidden /> Delete schedule
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>

            <Badge className="mt-2.5 max-w-full justify-start bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                <CalendarDays aria-hidden />
                <span className="truncate">{schedulePhrase(rule)} ({tzLabel(rule.timezone)})</span>
            </Badge>

            <p className="mt-1 flex flex-wrap items-center gap-x-1.5 font-app-body text-[12.5px] font-normal text-console-ink-2">
                {fired ? (
                    <>
                        <span>Last run {lastAt ? timeUntil(lastAt, now) : "—"}</span>
                        {lastWord && (
                            <span style={{ color: verdictInk(lastWord) }} className="font-normal">
                                {lastWord}
                            </span>
                        )}
                    </>
                ) : (
                    <span>Never run</span>
                )}
                {!paused && nextAt ? (
                    <>
                        <span aria-hidden className="text-console-ink-3">·</span>
                        <span>Next {timeUntil(nextAt, now)}</span>
                    </>
                ) : null}
            </p>

            <div className="relative z-10 mt-3 flex items-center justify-end gap-1.5">
                <Button
                    type="button"
                    size="xs"
                    variant="default"
                    onClick={onToggle}
                    disabled={busy}
                    aria-busy={busy || undefined}
                >
                    {paused ? <Play aria-hidden /> : <Pause aria-hidden />}
                    {paused ? "Resume" : "Pause"}
                </Button>
                <Button
                    type="button"
                    size="xs"
                    variant="ghost"
                    className="text-console-ink-2"
                    onClick={onRunNow}
                    disabled={busy || running}
                    aria-busy={busy || undefined}
                    title={running ? "This schedule is already running" : "Run it once, now"}
                >
                    {busy ? <Spinner size="sm" borderWidth="2px" /> : null}
                    {busy ? "Starting…" : "Run now"}
                </Button>
            </div>
        </div>
    );
}

/** Every field bar wears the entity search bar's chrome: a raised pill with a
 *  soft drop shadow that deepens on focus. `pl-8` leaves room for a leading
 *  icon, matching EntitySearch's icon slot. */
const FIELD_BAR =
    // `!` because Input's own dark:bg-input/30 would otherwise out-rank the
    // raised shade — the bars must read as the entity search bar's colour.
    "h-8 w-full min-w-0 rounded-full border border-transparent bg-[var(--surface-raised)]! text-sm text-console-ink shadow-[0_8px_24px_rgba(0,0,0,0.14)] outline-none transition-shadow placeholder:text-console-ink-4 focus-visible:ring-0 focus-visible:shadow-[0_8px_24px_rgba(0,0,0,0.3)]";
const FIELD_INPUT = `${FIELD_BAR} px-3.5`;
const SELECT_CLS = `${FIELD_BAR} cursor-pointer appearance-none pl-3.5 pr-8 [option]:bg-[var(--surface-raised)] [option]:text-console-ink`;
/** The skill search bar: the same pill, with the magnifier in EntitySearch's slot. */
const SKILL_INPUT = `${FIELD_BAR} pr-14 pl-8`;
/** Panel under a bar — EntitySearch's floating card. */
const BAR_PANEL =
    "rounded-[12px] border border-[var(--hairline)] bg-[var(--surface-canvas)] shadow-[0_16px_40px_rgba(0,0,0,0.18)]";

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
            {title && (
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
            )}
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

/** Skill picker: the full list is offered on open — like the model dropdown's
 *  default options — and typing just narrows it. Skills that don't serve the
 *  picked entity stay listed, greyed with a caution badge, instead of vanishing.
 *  With no entity yet the whole bar sits closed. */
function SkillPicker({
    skills,
    category,
    disabled,
    loading,
    error,
    onRetry,
    selected,
    onToggle,
}: {
    skills: { skill: SkillSummary; plugin: PluginSummary }[];
    /** "equity" | "industry" once an entity is picked, null before that. */
    category: "equity" | "industry" | null;
    disabled: boolean;
    loading: boolean;
    error: boolean;
    onRetry: () => void;
    selected: Set<string>;
    onToggle: (id: string) => void;
}) {
    const [query, setQuery] = useState("");
    const [open, setOpen] = useState(false);
    // Only nag about a missing skill once the user has actually been here.
    const [touched, setTouched] = useState(false);
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
    // A skill serves the entity when it's untagged or tagged with its kind —
    // nothing is unavailable until an entity pins the category down.
    const servesEntity = ({ plugin }: { skill: SkillSummary; plugin: PluginSummary }) =>
        !category || !plugin.agent_category || plugin.agent_category === category;
    // The open list is the whole menu — typing only narrows it.
    const visible = lower
        ? skills.filter(({ skill, plugin }) =>
              `${skill.id} ${skill.name} ${skill.description} ${plugin.display_name}`.toLowerCase().includes(lower),
          )
        : skills;
    // No entity → the bar stays shut and forgets what was typed.
    useEffect(() => {
        if (!disabled) return;
        setOpen(false);
        setQuery("");
    }, [disabled]);

    if (error) {
        return (
            <div className="flex flex-col items-start gap-2">
                <p className="font-app-body text-[12px] text-[var(--signal-negative-text)]">Couldn&apos;t load plugins.</p>
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
                <div className="relative">
                    <Search
                        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-[var(--ink-tertiary)]"
                        aria-hidden
                    />
                    <Input
                        value={query}
                        disabled={disabled}
                        onChange={(e) => {
                            setQuery(e.target.value);
                            setOpen(true);
                            setTouched(true);
                        }}
                        onFocus={() => {
                            if (disabled) return;
                            setOpen(true);
                            setTouched(true);
                        }}
                        placeholder={disabled ? "Pick an entity first…" : "Search skills…"}
                        aria-label="Search skills"
                        aria-expanded={open}
                        className={SKILL_INPUT}
                    />
                </div>
                {!lower && !open && (
                    <p className="mt-2 font-app-body text-[12px] font-light text-console-ink-3">
                        {disabled
                            ? "Choose an entity first — skills depend on what you're analysing."
                            : loading
                              ? "Loading skills…"
                              : "Every plugin's skills — ones this entity can't run stay marked."}
                    </p>
                )}
                {!disabled && open && (
                    <div className={`mt-2 max-h-[300px] divide-y divide-[color:var(--hairline)] overflow-y-auto overflow-x-hidden ${BAR_PANEL}`}>
                        {visible.length === 0 && (
                            <p className="px-2 py-3 font-app-body text-[12px] font-light text-console-ink-3">
                                Nothing matches “{query}”.
                            </p>
                        )}
                        {visible.map(({ skill, plugin }) => {
                            const on = selected.has(skill.id);
                            const ok = servesEntity({ skill, plugin });
                            return (
                                <label
                                    key={skill.id}
                                    className={cn(
                                        "flex w-full items-center gap-3 px-2 py-2 transition-colors",
                                        ok
                                            ? "cursor-pointer hover:bg-[color-mix(in_srgb,var(--ink-primary)_4%,transparent)]"
                                            : "cursor-not-allowed",
                                        on && ok && "bg-[color-mix(in_srgb,var(--signal-positive)_8%,transparent)]",
                                    )}
                                >
                                    <input
                                        type="checkbox"
                                        checked={on}
                                        disabled={!ok}
                                        onChange={() => ok && onToggle(skill.id)}
                                        data-testid={`skill-check-${skill.id}`}
                                        aria-label={`Skill ${skill.id}`}
                                        className={cn(
                                            "size-4 shrink-0 appearance-none rounded-full border border-[color:var(--hairline)] bg-[var(--surface-recessed)] transition-colors checked:border-[var(--signal-positive)] checked:bg-[var(--signal-positive)]",
                                            !ok && "opacity-30",
                                        )}
                                    />
                                    <span
                                        className={cn(
                                            "min-w-0 flex-1 truncate font-app-mono text-[12.5px]",
                                            ok ? "text-console-ink" : "text-console-ink-4",
                                        )}
                                    >
                                        {skill.id}
                                    </span>
                                    {/* The owning plugin rides the right edge; skills the entity can't use
                                        swap it for the caution chip. */}
                                    {ok ? (
                                        <span className="flex max-w-[45%] shrink-0 items-center gap-1.5 rounded-full bg-[var(--surface-recessed)] py-1 pl-1 pr-2.5">
                                            <PluginAvatar plugin={plugin.id} size={24} />
                                            <span className="truncate font-app-body text-[11px] text-console-ink-2">{plugin.display_name}</span>
                                        </span>
                                    ) : (
                                        <span
                                            data-testid={`skill-unavailable-${skill.id}`}
                                            className="shrink-0 rounded-full bg-[color-mix(in_srgb,var(--signal-warning)_20%,transparent)] px-2 py-0.5 font-app-body text-[10.5px] font-medium tracking-[0.04em] uppercase text-[color-mix(in_srgb,var(--signal-warning)_55%,black)] dark:text-[color-mix(in_srgb,var(--signal-warning)_85%,white)]"
                                        >
                                            Not available for this entity
                                        </span>
                                    )}
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
            {!disabled && touched && !loading && selected.size === 0 && (
                <p role="alert" className="font-app-body text-[12px] text-[var(--signal-negative-text)]">
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
                            {scheduled ? <><CalendarDays size={16} /> Create schedule</> : <><Play size={16} /> Run analysis</>}
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

    // Entity picker dropdown state + the picked stock row's display metadata.
    const [pickerOpen, setPickerOpen] = useState(false);
    const [pickedStock, setPickedStock] = useState<{ symbol: string; exchange?: string } | null>(null);

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
    // The picked entity — a stock (config.share = ticker) or a group
    // (config.share = taxonomy key). `pickedGroup` drives the badge, the
    // icon line and the industry-category skill filter; category is inferred.
    const [pickedGroup, setPickedGroup] = useState<GroupDetail | null>(null);
    // The picked entity picks the category — a stock is equity, a sector or
    // industry is industry. Nothing picked yet → no category: the badge stays
    // empty and every skill is on offer (disabled ones marked, not hidden).
    const category: "equity" | "industry" | null = pickedGroup
        ? "industry"
        : config.share
          ? "equity"
          : null;

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
    // Every skill stays listed; SkillPicker greys the ones the picked entity
    // can't run instead of filtering them out of the menu.
    // Per-run MCP toggles; default = every configured server enabled.
    const [mcpSources, setMcpSources] = useState<McpSource[]>([]);
    const [mcpEnabled, setMcpEnabled] = useState<string[]>([]);

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
        PluginService.mcpSources()
            .then(({ servers }) => {
                setMcpSources(servers);
                // Settings → MCP decides the default; the toggles still change it per run.
                setMcpEnabled(servers.filter((m) => m.enabled).map((m) => m.name));
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

    /** The picked entity — a stock (config.share = ticker) or a group
     *  (config.share = taxonomy key). `pickedGroup` drives the badge, the
     *  icon line and the industry-category skill filter. */
    const pickEntity = useCallback(
        (pick: EntityPick) => {
            if (pick.kind === "group") {
                // Group details (constituents, path) fetch for the display line;
                // the run payload needs key/name/market — market lands with the fetch.
                setPickedGroup({ key: pick.key, name: pick.name } as GroupDetail);
                TaxonomyService.group(pick.key)
                    .then((g) => {
                        setPickedGroup(g);
                        setConfig((prev) => ({ ...prev, share: g.key, shareName: g.name, source: g.market }));
                    })
                    .catch(() => {});
                setPickedStock(null);
                setConfig((prev) => ({ ...prev, share: pick.key, shareName: pick.name }));
                return;
            }
            // Rows from /entities/search always carry the source (NSE/SEC).
            setPickedGroup(null);
            setPickedStock({ symbol: pick.symbol, exchange: pick.exchange });
            setConfig((prev) => ({
                ...prev,
                source: pick.source,
                share: pick.symbol || "",
                shareName: pick.name || pick.symbol || "",
            }));
        },
        [],
    );

    // ?group=<key> preselects a group — the group page's "Run analysis" button.
    const groupPresetApplied = useRef(false);
    useEffect(() => {
        const preset = searchParams.get("group");
        if (!preset || groupPresetApplied.current) return;
        groupPresetApplied.current = true;
        TaxonomyService.group(preset)
            .then((g) => {
                setPickedGroup(g);
                setConfig((prev) => ({ ...prev, share: g.key, shareName: g.name, source: g.market }));
            })
            .catch(() => {});
    }, [searchParams]);

    // Category changed (stock ↔ group): drop skills whose plugin serves the
    // other category so a stale selection can't ride along. Before an entity is
    // picked there's no category to prune against — nothing gets dropped.
    useEffect(() => {
        if (!category) return;
        setSelectedSkills((prev) => {
            const next = new Set([...prev].filter((id) => {
                const owner = skillOwner.get(id);
                return !owner?.agent_category || owner.agent_category === category;
            }));
            return next.size === prev.size ? prev : next;
        });
    }, [category, skillOwner]);

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

    /** The rule whose pause / run-now is in flight — its card shows the
     *  spinner and both of its buttons go disabled. */
    const [busyId, setBusyId] = useState<string | null>(null);

    const toggleRule = async (rule: AlertRuleRow) => {
        setBusyId(rule.id);
        try {
            await AnalysisService.setAlertRuleEnabled(rule.id, !rule.enabled);
        } catch {
            toaster.create({ title: "Couldn't update the schedule", type: "error" });
        } finally {
            setBusyId(null);
        }
    };

    /** Run Now: the same POST /analysis the form posts, with the rule's stored
     *  config — no new endpoint, and the run page opens like any other run. */
    const runNow = async (rule: AlertRuleRow) => {
        setBusyId(rule.id);
        try {
            const result = await AnalysisService.runAnalysis({
                symbol: rule.symbol,
                source: rule.source,
                plugin_ids: rule.plugin_ids || [],
                skills: rule.skill_ids?.length ? rule.skill_ids : undefined,
                model: rule.model || undefined,
                system_prompt: rule.system_prompt || undefined,
                max_steps: rule.max_steps ?? undefined,
                max_tokens: rule.max_tokens ?? undefined,
            });
            if (result?.id) navigate(`/runs/${result.id}`);
            else toaster.create({ title: "The run could not be started", type: "error" });
        } catch (error) {
            toaster.create({
                title: "Couldn't run it now",
                description:
                    (error as { response?: { data?: { error?: string } } })?.response?.data?.error ||
                    (error as Error)?.message,
                type: "error",
            });
        } finally {
            setBusyId(null);
        }
    };

    // Runs — every row (a schedule's last-run verdict needs them), polled fast
    // while something runs and lazily otherwise.
    const [runRows, setRunRows] = useState<ActiveRunRow[]>([]);
    useEffect(() => {
        let alive = true;
        let timer: ReturnType<typeof setTimeout>;
        const tick = async () => {
            try {
                const rows = await AnalysisService.listAnalyses();
                if (!alive) return;
                const all: ActiveRunRow[] = Array.isArray(rows) ? rows : [];
                setRunRows(all);
                const active = all.filter((r) => (r.status || "").toUpperCase() === "RUNNING");
                timer = setTimeout(tick, active.length ? 5000 : 30_000);
            } catch {
                if (alive) timer = setTimeout(tick, 15_000);
            }
        };
        void tick();
        return () => { alive = false; clearTimeout(timer); };
    }, []);

    // Occurrence instants (last/next fire per rule) for a padded window either
    // side of today — biweekly is the widest cadence, so 14 days back.
    const [occs, setOccs] = useState<{ rule_id: string; at: number }[]>([]);
    useEffect(() => {
        let alive = true;
        const fmt = (d: Date) =>
            `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        const load = () => {
            const from = fmt(new Date(Date.now() - 14 * 86_400_000));
            const to = fmt(new Date(Date.now() + 60 * 86_400_000));
            AnalysisService.listOccurrences(from, to)
                .then((rows) => { if (alive && Array.isArray(rows)) setOccs(rows); })
                .catch(() => {});
        };
        load();
        window.addEventListener("alert-rules-changed", load);
        return () => { alive = false; window.removeEventListener("alert-rules-changed", load); };
    }, []);

    // "now" for the relative labels: re-render every 30s so "in 5m" stays true.
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const t = setInterval(() => setNow(Date.now()), 30_000);
        return () => clearInterval(t);
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
            failRun(errorCopy(error, "The run could not be started. Check your selection and try again."));
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
                title: `${FREQ_LABEL[frequency]} schedule created`,
                description: `${config.shareName || config.share} · from ${scheduleAt.date} at ${scheduleAt.time} (${timezone})`,
                type: "success",
            });
            // Clear the skills so the button disables — a second click
            // can't silently create a duplicate schedule.
            setSelectedSkills(new Set());
        } catch (error) {
            console.error("Alert error:", error);
            toaster.create({
                title: "Couldn't set the schedule",
                description: errorCopy(error, "The schedule could not be created."),
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
    // A required server (incl. the SearXNG web-search source) off for this
    // run is worth a quiet heads-up.
    const missingRequired = requiredIssue(mcpSources, mcpEnabled);
    const selectedSkillIds = [...selectedSkills];
    const skillsLoading = plugins.some((p) => pluginSkills[p.id] === undefined);
    const canRunAnalysis =
        isConfigComplete &&
        selectedSkillIds.length > 0 &&
        !skillsLoading &&
        (runMode === "once" || (!!scheduleAt.date && !!scheduleAt.time));
    // One line naming what's still missing while the run button is disabled.
    const runHint = canRunAnalysis
        ? ""
        : !config.share
            ? "Pick a company, sector or industry first"
            : !model.trim()
                ? "Choose a model"
                : skillsLoading
                    ? "Loading skills…"
                    : "Choose at least one skill";
    const statusLine = config.share
        ? `${config.shareName || config.share} · ${config.source} · ${runMode === "scheduled" ? `${FREQ_LABEL[frequency]} from ${scheduleAt.date} at ${scheduleAt.time}` : "Single run"}`
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
                            {runMode === "scheduled" ? "Creating schedule…" : "Running analysis…"}
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
                                        {m === "once" ? "Single" : <><Clock className="size-3.5" aria-hidden /> Scheduled</>}
                                    </ModeButton>
                                ))}
                            </div>
                        </FormRow>
                        {runMode === "scheduled" && (
                            <FormRow label="Schedule">
                                {/* Frequency + first check side by side, like the modal's two-up schedule. */}
                                <div className="grid gap-3 sm:grid-cols-2">
                                <div className="relative">
                                    <select
                                        value={frequency}
                                        onChange={(e) => setFrequency(e.target.value as Frequency)}
                                        aria-label="Frequency"
                                        data-testid="run-frequency"
                                        className={SELECT_CLS}
                                    >
                                        {(["daily", "weekly", "biweekly", "monthly"] as const).map((f) => (
                                            <option key={f} value={f}>{FREQ_LABEL[f]}</option>
                                        ))}
                                    </select>
                                    <ChevronDown
                                        className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-[var(--ink-tertiary)]"
                                        aria-hidden
                                    />
                                </div>
                                    <DateTimePicker value={scheduleAt} onChange={setScheduleAt} />
                                </div>
                            </FormRow>
                        )}
                    </FormSection>

                    <FormSection>
                        {/* Category is inferred from the picked entity — no select.
                            A stock runs equity, a sector or industry runs
                            industry; before any pick the badge has nothing to
                            say. */}
                        <FormRow>
                            <div>
                                <div className="mb-1.5 flex items-center justify-between">
                                    <FieldLabel>Entity</FieldLabel>
                                    {category && (
                                        <span
                                            data-testid="run-category-badge"
                                            className="rounded-full bg-[var(--surface-recessed)] px-2 py-0.5 font-app-body text-[10.5px] font-medium tracking-[0.06em] text-console-ink-2 uppercase"
                                        >
                                            {pickedGroup ? "Industry" : "Equity"}
                                        </span>
                                    )}
                                </div>
                                {/* Picker + picked entity. No wrapper box: the
                                    input's raised shade is the only surface, the
                                    entity hangs off it under a hairline. */}
                                <>
                                    <EntitySearch
                                        open={pickerOpen}
                                        onOpenChange={setPickerOpen}
                                        onPick={pickEntity}
                                        placeholder={config.share ? "Change company, sector or industry…" : "Search company, sector, industry…"}
                                        showTabs={false}
                                    />
                                    {config.share && (
                                        <>
                                            <div className="mx-3 my-1.5 h-px bg-[var(--hairline)]" />
                                            <div className="flex items-center gap-3 px-3">
                                                {pickedGroup ? (
                                                    <GroupMark level={pickedGroup.level} market={pickedGroup.market} size={40} />
                                                ) : (
                                                    <TickerLogo symbol={pickedStock?.symbol || config.share} size={40} />
                                                )}
                                                <div className="min-w-0">
                                                    <div className="truncate font-app-body text-[15px] font-light leading-tight text-[var(--ink-primary)]">
                                                        {config.shareName || config.share}
                                                    </div>
                                                    <div className="mt-1 flex items-center gap-1.5 font-app-body text-[12px] font-normal text-[var(--ink-tertiary)]">
                                                        {pickedGroup ? (
                                                            <span className="truncate">
                                                                {pickedGroup.market} · {pickedGroup.count ?? "—"} stocks
                                                            </span>
                                                        ) : (
                                                            <>
                                                                <span className="text-[14px] leading-none">
                                                                    <FlagLogo source={config.source} size={14} />
                                                                </span>
                                                                <span className="truncate">
                                                                    {config.source}
                                                                    {" · "}
                                                                    {config.share}
                                                                    {pickedStock?.exchange ? ` · ${pickedStock.exchange}` : ""}
                                                                </span>
                                                            </>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        </>
                                    )}
                                </>
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
                                category={category}
                                disabled={!config.share}
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
                                            sub={providerDisplayName(m)}
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
                                Settings
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

                    {/* Schedules don't carry mcp_enabled (alert_rules has no
                        column), so don't show toggles that would be ignored. */}
                    {runMode === "once" && (
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
                                    const state = mcpServerState({ enabled: on, status: m.status });
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
                                                <span className="flex items-center gap-1.5">
                                                    <span
                                                        aria-hidden
                                                        className="size-1.5 shrink-0 rounded-full"
                                                        style={{ background: MCP_STATE_DOT[state] }}
                                                        title={m.error || undefined}
                                                    />
                                                    <span className="font-app-body text-[13px] text-console-ink">{m.label}</span>
                                                </span>
                                                {state === "down" && m.error && (
                                                    <span
                                                        className="mt-0.5 block text-[11px] text-[var(--signal-negative-text)] [overflow-wrap:anywhere]"
                                                        title={m.error}
                                                    >
                                                        {errorCopy(new Error(m.error), "Not responding — it's off for this run.")}
                                                    </span>
                                                )}
                                            </span>
                                        </div>
                                    );
                                })}
                                {missingRequired && (
                                    <p className="mt-1 text-[11.5px] text-[var(--ink-tertiary)] sm:col-span-2">{missingRequired}</p>
                                )}
                            </div>
                        </FormRow>
                    </FormSection>
                    )}

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
                                    <Text fontSize="13px" fontFamily="var(--font-body)" fontWeight={400} color="var(--ink-secondary)" role="status" aria-live="polite">
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
                        Scheduled runs
                    </h2>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                        {alertRules.map((s) => (
                            <ScheduleCard
                                key={s.id}
                                rule={s}
                                plugins={plugins}
                                runs={runRows}
                                occs={occs}
                                now={now}
                                busy={busyId === s.id}
                                onToggle={() => void toggleRule(s)}
                                onRunNow={() => void runNow(s)}
                                onDelete={() => setRuleToStop(s)}
                            />
                        ))}

                        {alertRules.length === 0 && (
                            <p className="col-span-full rounded-xl border border-dashed border-[color:var(--hairline)] px-4 py-6 text-center font-app-body text-[13px] font-light text-console-ink-3">
                                Nothing scheduled yet — set the mode to Scheduled and create one from the form.
                            </p>
                        )}
                    </div>

                    <ConfirmDialog
                        open={!!ruleToStop}
                        title="Delete schedule?"
                        message={`The ${FREQ_LABEL[ruleToStop?.frequency ?? "daily"].toLowerCase()} check for ${ruleToStop?.share_name || ruleToStop?.symbol || ""} will stop. This can't be undone.`}
                        confirmLabel="Delete"
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
