import { Flex, Text, Spinner, Box } from "@/compat/ui";
import { useEffect, useState, useCallback, useRef, type ReactNode, type CSSProperties } from "react";
import { MdCheck, MdClose } from "react-icons/md";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { AnalysisService, API_BASE, PluginService, listCategories, type AlertRuleRow, type McpSource, type PluginSummary, type SkillSummary } from "@/db";
import { formatSeconds } from "@/utils";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { type RunStep, runProgressPct } from "./shared/RunStatus";
import { Progress, ProgressLabel, ProgressValue } from "@/components/ui/progress";
import AgentActivity from "@/components/shared/AgentActivity";
import { motion, AnimatePresence } from "motion/react";
import { dur, ease } from "@/lib/motion";
import { FlagLogo, TickerLogo } from "@/lib/sourceLogos";
import PluginAvatar from "@/components/shared/PluginAvatar";
import PluginPicker from "@/components/plugins/PluginPicker";
import { ModelLogo } from "@/lib/modelLogos";
import { Play, CalendarDays, Check, Clock } from "lucide-react";
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
import ConfirmDialog from "@/components/ConfirmDialog";
import { DateTimePicker, type DateTimeValue, toDateKey } from "./shared/DateTimePicker";

const MAX_POLL_RETRIES = 600;

type StatusType = "EMPTY" | "PENDING" | "COMPLETED" | "ERROR";

const microLabel = {
    fontSize: "11px",
    fontFamily: "var(--font-body)",
    fontWeight: 400,
    color: "var(--ink-tertiary)",
};

type RunMode = "once" | "scheduled";
type Frequency = "daily" | "weekly" | "biweekly" | "monthly";
const FREQ_LABEL: Record<string, string> = { daily: "Daily", weekly: "Weekly", biweekly: "Biweekly", monthly: "Monthly" };

/** Field input styled like the workspace popup boxes (hairline, h-9). */
const FIELD_INPUT =
    "h-9 rounded-[6px] border-[0.5px] border-[color:var(--hairline)] bg-transparent px-2.5 text-sm shadow-none placeholder:text-console-ink-4 focus-visible:ring-1 focus-visible:ring-console-accent/40 dark:bg-transparent";
const SELECT_CLS =
    "h-9 w-full max-w-64 cursor-pointer rounded-[6px] border-[0.5px] border-[color:var(--hairline)] bg-transparent px-2 text-sm text-console-ink shadow-none outline-none focus-visible:ring-1 focus-visible:ring-console-accent/40 dark:bg-transparent [&>option]:bg-[var(--surface-recessed)] [&>option]:text-console-ink";

/** Form section: the My-agents heading (light title) over whitespace-separated
 *  rows — no rules, no fills. */
function FormSection({ title, children }: { title: string; children: ReactNode }) {
    return (
        <Box pt={6}>
            <div className="px-4">
                <h2 className="font-app-body text-[20px] leading-none font-light tracking-tight text-console-ink">
                    {title}
                </h2>
            </div>
            <Box mt={3}>{children}</Box>
        </Box>
    );
}

/** One label | field row — the label column aligns the fields; spacing does the rest. */
function FormRow({ label, children }: { label: string; children: ReactNode }) {
    return (
        <Flex direction={{ base: "column", md: "row" }}>
            <Box
                w={{ base: "full", md: "176px" }}
                flexShrink={0}
                px={4}
                py={{ base: 1.5, md: 3 }}
                display="flex"
                alignItems="center"
            >
                <Text {...microLabel}>{label}</Text>
            </Box>
            <Flex direction="column" gap={1.5} justify="center" flex={1} minW={0} px={3} py={{ base: 1, md: 2 }}>
                {children}
            </Flex>
        </Flex>
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
                            {scheduled ? <><CalendarDays size={16} /> Create alert</> : <><Play size={16} /> Run analysis</>}
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
    // Available plugins — the run selects one or more; ALL of their skills load.
    const [plugins, setPlugins] = useState<PluginSummary[]>([]);
    const [pluginIds, setPluginIds] = useState<string[]>([]);
    // A failed fetch must not look like "no plugins yet".
    const [pluginsError, setPluginsError] = useState(false);
    // …and neither must the empty state, before the first fetch lands.
    const [pluginsLoading, setPluginsLoading] = useState(true);
    // Skills inside the selected plugins — all on by default; unchecking
    // narrows the run to a chosen subset (one or many).
    const [pluginSkills, setPluginSkills] = useState<Record<string, SkillSummary[]>>({});
    const [deselectedSkills, setDeselectedSkills] = useState<Set<string>>(new Set());
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
                setMcpEnabled(list.map((m) => m.name));
            })
            .catch(() => {});
    }, [loadPlugins]);

    const togglePlugin = useCallback(
        (id: string) => setPluginIds((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id])),
        [],
    );

    // Load each selected plugin's skill list (cached per id; failures cached
    // as empty so a down API can't retry-loop the effect).
    useEffect(() => {
        for (const id of pluginIds) {
            if (pluginSkills[id]) continue;
            PluginService.read(id)
                .then((d) => setPluginSkills((prev) => ({ ...prev, [id]: d.skills ?? [] })))
                .catch(() => setPluginSkills((prev) => ({ ...prev, [id]: [] })));
        }
    }, [pluginIds, pluginSkills]);

    const toggleSkill = useCallback((id: string) => {
        setDeselectedSkills((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }, []);
    const selectAllSkills = useCallback(() => setDeselectedSkills(new Set()), []);
    const toggleMcp = useCallback(
        (name: string) => setMcpEnabled((prev) => (prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name])),
        [],
    );

    // ?plugin=id preselects — the directory card's “+” shortcut.
    useEffect(() => {
        const preset = searchParams.get("plugin");
        if (preset) setPluginIds((prev) => (prev.includes(preset) ? prev : [...prev, preset]));
    }, [searchParams]);

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
    const [alertRules, setAlertRules] = useState<AlertRuleRow[]>([]);
    const [ruleToDelete, setRuleToDelete] = useState<AlertRuleRow | null>(null);

    const loadAlertRules = useCallback(() => {
        AnalysisService.listAlertRules().then(setAlertRules).catch(() => {});
    }, []);

    useEffect(() => {
        loadAlertRules();
    }, [loadAlertRules]);

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
            loadAlertRules();
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
    // Equity only, for now: industry/commodities runs say "not supported yet".
    const webSearchEnabled = mcpSources.some((m) => m.webProvider && mcpEnabled.includes(m.name));
    const skillsByPlugin = pluginIds.flatMap((id) => {
        const plugin = plugins.find((x) => x.id === id);
        return plugin ? [{ plugin, skills: pluginSkills[id] ?? [] }] : [];
    });
    const availableSkillIds = skillsByPlugin.flatMap((g) => g.skills.map((s) => s.id));
    const selectedSkillIds = availableSkillIds.filter((id) => !deselectedSkills.has(id));
    const skillsLoading = pluginIds.some((id) => pluginSkills[id] === undefined);
    // A plugin with no skills can't gate on a choice that doesn't exist —
    // the run just goes bare (routes still mount for the plugin).
    const canRunAnalysis =
        category === "equity" &&
        isConfigComplete &&
        pluginIds.length > 0 &&
        !skillsLoading &&
        (selectedSkillIds.length > 0 || availableSkillIds.length === 0) &&
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
                        : !pluginIds.length
                            ? "Choose a plugin"
                            : skillsLoading
                                ? "Loading skills…"
                                : availableSkillIds.length === 0
                                    ? ""
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
            <Box py={{ base: 4, md: 6 }} maxW="960px" mx="auto">
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
                        <h1 className="font-app-body text-[30px] leading-none font-light tracking-tight text-console-ink">
                            New Run
                        </h1>
                        <p className="mt-1.5 font-app-body text-[12px] font-normal text-console-ink-3">
                            Run one analysis now, or set an alert that checks on a schedule.
                        </p>
                    </div>

                    <FormSection title="Run settings">
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
                            <>
                                <FormRow label="Checks">
                                    <div className="flex flex-wrap gap-2">
                                        {(["daily", "weekly", "biweekly", "monthly"] as const).map((f) => (
                                            <ModeButton key={f} selected={frequency === f} onClick={() => setFrequency(f)}>
                                                {FREQ_LABEL[f]}
                                            </ModeButton>
                                        ))}
                                    </div>
                                </FormRow>
                                <FormRow label="First check">
                                    <DateTimePicker value={scheduleAt} onChange={setScheduleAt} />
                                </FormRow>
                            </>
                        )}
                    </FormSection>

                    <FormSection title="Company">
                        {/* Category — the class this run analyzes; gates what follows. */}
                        <FormRow label="Category">
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
                        </FormRow>
                        {/* Equity only, for now: the stock search lives here. */}
                        {category === "equity" && (
                            <FormRow label="Ticker">
                                <div className="flex flex-col gap-2.5">
                                    <MenuDropdown
                                        value={null}
                                        placeholder={config.share ? "Change company…" : "Search company or symbol…"}
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
                                        <div className="flex items-center gap-3 px-1 py-1">
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
                            </FormRow>
                        )}
                        {category && category !== "equity" && (
                            <FormRow label="Ticker">
                                <Text fontSize="12px" fontWeight={400} fontFamily="var(--font-body)" color="var(--ink-tertiary)">
                                    Not supported yet — only equity runs are available for now.
                                </Text>
                            </FormRow>
                        )}
</FormSection>

                    <FormSection title="Plugins">
                        {/* Plugins — Claude/ChatGPT-style picker: toggle one or
                            more; every selected plugin's skills load. */}
                        <FormRow label="Plugins">
                            <PluginPicker
                                plugins={plugins}
                                selected={pluginIds}
                                onToggle={togglePlugin}
                                loading={pluginsLoading}
                                error={pluginsError}
                                onRetry={loadPlugins}
                            />
                            {/* The chosen plugins' skills — every skill on by
                                default; uncheck to narrow the run. */}
                            {pluginIds.length > 0 && (
                                <div
                                    className="mt-1 overflow-hidden rounded-[8px] border border-[color:var(--hairline)]"
                                    data-testid="skill-picker"
                                >
                                    <div className="flex items-center justify-between border-b border-[color:var(--hairline)] px-3 py-2">
                                        <span className="font-app-body text-[11px] font-semibold tracking-[0.14em] text-console-ink-3 uppercase">
                                            Skills
                                        </span>
                                        <span className="flex items-center gap-3">
                                            <span className="font-app-body text-[11px] text-console-ink-3" role="status">
                                                {skillsLoading
                                                    ? "Loading…"
                                                    : `${selectedSkillIds.length} of ${availableSkillIds.length} selected`}
                                            </span>
                                            {!skillsLoading && availableSkillIds.length > 1 && (
                                                <button
                                                    type="button"
                                                    onClick={selectAllSkills}
                                                    className="font-app-body text-[11px] text-[var(--gh-blue)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-console-accent/40"
                                                >
                                                    All
                                                </button>
                                            )}
                                        </span>
                                    </div>
                                    {skillsLoading ? (
                                        <p className="px-3 py-3 font-app-body text-[12px] text-console-ink-3">
                                            Loading skills…
                                        </p>
                                    ) : (
                                        skillsByPlugin.map(({ plugin, skills }) => (
                                            <div
                                                key={plugin.id}
                                                className="divide-y divide-[color:var(--hairline)]"
                                            >
                                                {skillsByPlugin.length > 1 && (
                                                    <div className="flex items-center gap-2 bg-[color-mix(in_srgb,var(--ink-primary)_4%,transparent)] px-3 py-1.5">
                                                        <PluginAvatar plugin={plugin.id} size={16} />
                                                        <span className="truncate font-app-body text-[12px] text-console-ink-2">
                                                            {plugin.display_name}
                                                        </span>
                                                    </div>
                                                )}
                                                {skills.length === 0 && (
                                                    <p className="px-3 py-2 font-app-body text-[12px] text-console-ink-3">
                                                        No skills in this plugin.
                                                    </p>
                                                )}
                                                {skills.map((sk) => {
                                                    const on = !deselectedSkills.has(sk.id);
                                                    return (
                                                        <label
                                                            key={sk.id}
                                                            className="flex w-full cursor-pointer items-center gap-3 px-3 py-2 transition-colors hover:bg-[color-mix(in_srgb,var(--ink-primary)_4%,transparent)] focus-within:bg-[color-mix(in_srgb,var(--ink-primary)_4%,transparent)]"
                                                        >
                                                            <input
                                                                type="checkbox"
                                                                checked={on}
                                                                onChange={() => toggleSkill(sk.id)}
                                                                aria-label={`Skill ${sk.id}`}
                                                                data-testid={`skill-check-${sk.id}`}
                                                                className="size-4 shrink-0 accent-[var(--signal-positive)]"
                                                            />
                                                            <span className="w-[34%] max-w-[200px] shrink-0 truncate font-app-mono text-[12.5px] text-console-ink">
                                                                {sk.id}
                                                            </span>
                                                            <span className="min-w-0 flex-1 truncate font-app-body text-[12.5px] font-light text-console-ink-3">
                                                                {sk.description}
                                                            </span>
                                                        </label>
                                                    );
                                                })}
                                            </div>
                                        ))
                                    )}
                                    {!skillsLoading && availableSkillIds.length > 0 && selectedSkillIds.length === 0 && (
                                        <p
                                            role="alert"
                                            className="border-t border-[color:var(--hairline)] px-3 py-2 font-app-body text-[12px] text-[var(--signal-negative)]"
                                        >
                                            Pick at least one skill for this run.
                                        </p>
                                    )}
                                </div>
                            )}
                        </FormRow>
                    </FormSection>

                    <FormSection title="Model & limits">
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

                        <FormRow label="Max steps">
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
                        </FormRow>

                        <FormRow label="Max tokens">
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
                        </FormRow>
                    </FormSection>

                    <FormSection title="MCP tools">
                        <FormRow label="Servers">
                            <div className="flex flex-col gap-2.5">
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
                                                    <span className="ml-2 rounded-[4px] border border-[color:var(--hairline)] px-1.5 py-0.5 font-app-mono text-[10px] tracking-wide text-console-ink-3 uppercase">
                                                        web search
                                                    </span>
                                                )}
                                            </span>
                                        </div>
                                    );
                                })}
                                {!webSearchEnabled && mcpSources.length > 0 && (
                                    <Alert variant="destructive" className="mt-1">
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

                {status === "EMPTY" && alertRules.length > 0 && (
                    <Box mt={5}>
                        <Text {...microLabel} mb={2}>Your alerts</Text>
                        {alertRules.map((s) => (
                            <Flex key={s.id} align="center" gap={2.5} py={1.5}>
                                <TickerLogo symbol={s.symbol} size={16} />
                                <Text
                                    fontSize="13px"
                                    fontWeight={400}
                                    fontFamily="var(--font-body)"
                                    color="var(--ink-primary)"
                                    minW={0}
                                    overflow="hidden"
                                    textOverflow="ellipsis"
                                    whiteSpace="nowrap"
                                >
                                    {s.share_name || s.symbol}
                                </Text>
                                <Text fontSize="12px" fontWeight={300} fontFamily="var(--font-body)" color="var(--ink-tertiary)" ml="auto" whiteSpace="nowrap">
                                    {FREQ_LABEL[s.frequency] || "Daily"} at {s.time} · {s.timezone}
                                </Text>
                                <Box
                                    as="button"
                                    aria-label={`Delete alert for ${s.share_name || s.symbol}`}
                                    onClick={() => setRuleToDelete(s)}
                                    display="flex"
                                    flexShrink={0}
                                    border="none"
                                    background="transparent"
                                    color="var(--ink-tertiary)"
                                    cursor="pointer"
                                    _hover={{ color: "var(--signal-negative)" }}
                                >
                                    <MdClose size={14} />
                                </Box>
                            </Flex>
                        ))}
                    </Box>
                )}

                <ConfirmDialog
                    open={!!ruleToDelete}
                    title="Delete this alert?"
                    message={`The ${FREQ_LABEL[ruleToDelete?.frequency ?? "daily"]} check for ${ruleToDelete?.share_name || ruleToDelete?.symbol || ""} will stop. This can't be undone.`}
                    confirmLabel="Delete"
                    onCancel={() => setRuleToDelete(null)}
                    onConfirm={async () => {
                        const target = ruleToDelete;
                        setRuleToDelete(null);
                        if (!target) return;
                        try {
                            await AnalysisService.deleteAlertRule(target.id);
                            loadAlertRules();
                        } catch (error) {
                            toaster.create({
                                title: "Couldn't delete the alert",
                                description:
                                    (error as { response?: { data?: { error?: string } } })?.response?.data?.error ||
                                    (error as Error)?.message ||
                                    "The alert could not be deleted.",
                                type: "error",
                            });
                        }
                    }}
                />

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
            </Box>
        </Box>
    );
}
