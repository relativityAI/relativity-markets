import { useParams, Link } from "react-router-dom";
import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import {
    Box,
    Flex,
    Text,
    Spinner,
    Container,
    Button,
    HStack,
    VStack,
    Tabs,
} from "@/compat/ui";
import { AnalysisService, API_BASE } from "@/db";
import { toaster } from "@/components/ui/toaster";
import axios from "axios";
import { formatSeconds } from "@/utils";
import PluginAvatar from "@/components/shared/PluginAvatar";
import AgentActivity from "../components/shared/AgentActivity";
import { MdArrowBack, MdInfo } from "react-icons/md";
import { Download } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { dur, ease } from "@/lib/motion";
import { ReportBlockRenderer } from "../components/builder/ReportBlockRenderer";
import { ReportDocumentRenderer } from "../components/report/ReportDocumentRenderer";
import { WorkspaceExplorer } from "../components/report/WorkspaceExplorer";
import { AgentStatus } from "@/components/assistant-ui/elements/agent-status";
import type { TraceSpan } from "@/components/assistant-ui/elements/trace-waterfall";
import { CostMeter, type CostLine } from "@/components/assistant-ui/elements/cost-meter";
import { ToolTimeline } from "@/components/assistant-ui/elements/tool-timeline";
import type { LucideIcon } from "lucide-react";
import { formatTokenCount } from "@/components/assistant-ui/utils/tokens";
import type { ReportDocument } from "@/lib/reportContract";

import SkillResultCard from "./sections/SkillResultCard";
import { useSkillLibrary } from "@/lib/skillLibrary";
import { SourceMark, TickerLogo } from "@/lib/sourceLogos";
import { ModelLogo } from "@/lib/modelLogos";
import {
    coverageLabel,
    insufficientCoverage,
    verdictForScore,
} from "@/lib/analysisFormat";

const TABS = ["report", "reasoning", "run info"] as const;
type Tab = (typeof TABS)[number];

const OP_SYMBOL: Record<string, string> = {
    gt: ">", gte: "≥", lt: "<", lte: "≤", eq: "=", between: "between",
};

export function tokensUsed(qualAnalysis: Record<string, any>): { input: number; output: number; total: number } | null {
    let input = 0;
    let output = 0;
    for (const entry of Object.values(qualAnalysis)) {
        const t = entry?.tokens;
        if (!t) continue;
        input += typeof t.input === "number" ? t.input : 0;
        output += typeof t.output === "number" ? t.output : 0;
    }
    if (input + output === 0) return null;
    return { input, output, total: input + output };
}

export function formatTokens(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
    return String(n);
}

/** Icon-only PDF export at the right end of the result navbar. */
function DownloadButton({ runId, name }: { runId?: string; name?: string }) {
    const [state, setState] = useState<"idle" | "busy" | "error">("idle");
    if (!runId) return null;
    const download = async () => {
        try {
            setState("busy");
            const res = await axios.get(`${API_BASE}/analysis/${encodeURIComponent(runId)}/pdf`, { responseType: "blob" });
            if (!res.data || !(res.data instanceof Blob)) throw new Error("No PDF received");
            const url = URL.createObjectURL(res.data);
            const a = document.createElement("a");
            a.href = url;
            a.download = `${(name || "analysis").replace(/\s+/g, "-")}.pdf`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
            setState("idle");
        } catch (e) {
            setState("error");
            // The aria-label flip alone is invisible to sighted users.
            toaster.create({
                title: "Couldn't export the PDF",
                description: (e as Error)?.message || "The download didn't come through. Try again.",
                type: "error",
            });
        }
    };
    return (
        <Button
            as={motion.button}
            whileTap={{ scale: 0.96 }}
            variant="subtle"
            size="sm"
            px={2}
            color="var(--ink-secondary)"
            _hover={{ color: "var(--ink-primary)" }}
            onClick={download}
            disabled={state === "busy"}
            aria-label={state === "busy" ? "Generating PDF…" : state === "error" ? "Export failed — retry" : "Download as PDF"}
        >
            <Download size={15} aria-hidden="true" />
        </Button>
    );
}

interface MetaRow {
    label: string;
    value: string;
}

const TERMINAL = ["complete", "completed", "success", "error", "failed", "budget_exhausted"];

/**
 * The run info tab: tool calls, started, duration, tokens in/out, agent, stock.
 * Missing fields render as "—" rather than a guessed number.
 */
export function runMetadata(run: any): { rows: MetaRow[] } {
    const trace: any[] = Array.isArray(run?.trace) ? run.trace : [];
    const toolCalls = trace.filter((e) => e?.type === "tool_call");
    const status = String(run?.status || "").toLowerCase();
    const terminal = TERMINAL.includes(status);

    const tokens = tokensUsed(run?.qualitative_analysis || {});

    const started = run?.started_at || run?.created_at || null;
    const wallMs = started ? (terminal ? +new Date(run?.updated_at || started) : Date.now()) - +new Date(started) : null;
    const duration =
        typeof run?.duration === "number" && run.duration > 0
            ? formatSeconds(Math.round(run.duration))
            : wallMs !== null && wallMs >= 0
                ? formatSeconds(Math.round(wallMs / 1000))
                : null;
    const ts = (v: any) =>
        typeof v === "string" && v
            ? new Date(v).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
            : null;

    const rows: MetaRow[] = [];
    const push = (label: string, value: string | null | undefined) => {
        rows.push({ label, value: value ?? "—" });
    };

    push("Tool calls", trace.length ? String(toolCalls.length) : "—");
    push("Started", ts(started));
    push("Duration", duration);
    push("Tokens in", tokens ? formatTokens(tokens.input) : "—");
    push("Tokens out", tokens ? formatTokens(tokens.output) : "—");
    push("Plugin", run?.agent_name);
    push("Stock", run?.symbol);

    return { rows };
}

/** What the run row records — one label/value line each (the Run Info tab). */
/** Trace → waterfall spans: one per tool call, timed from the event timestamps. */
function waterfallFor(trace: any[], durationSec?: number): { spans: TraceSpan[]; totalMs: number } {
    const events = Array.isArray(trace) ? trace : [];
    if (!events.length) return { spans: [], totalMs: 0 };
    const t0 = typeof events[0]?.ts === "number" ? events[0].ts : 0;
    const acc: (TraceSpan & { startTs: number })[] = [];
    for (const ev of events) {
        if (ev?.type === "tool_call") {
            acc.push({
                id: ev.tool_call_id || `${ev.tool}-${acc.length}`,
                name: ev.tool || "tool",
                depth: 0,
                startTs: typeof ev.ts === "number" ? ev.ts : t0,
                durationMs: 0,
                status: "running",
            });
        } else if (ev?.type === "tool_result") {
            for (let i = acc.length - 1; i >= 0; i--) {
                const s = acc[i];
                if (s.status === "running" && s.name === (ev.tool || "tool")) {
                    s.durationMs =
                        typeof ev.duration_ms === "number"
                            ? ev.duration_ms
                            : Math.max(0, (typeof ev.ts === "number" ? ev.ts : s.startTs) - s.startTs);
                    s.status = ev.status === "ERR" ? "failed" : "completed";
                    break;
                }
            }
        }
    }
    const spans: TraceSpan[] = acc.map(({ startTs, ...s }) => ({ ...s, startMs: Math.max(0, Math.round(startTs - t0)) }));
    const lastTs = typeof events[events.length - 1]?.ts === "number" ? events[events.length - 1].ts : t0;
    // ponytail: flat spans (no call nesting in the trace) — depth stays 0 until the trace records parents.
    const totalMs = Math.max(1, typeof durationSec === "number" && durationSec > 0 ? Math.round(durationSec * 1000) : Math.round(lastTs - t0));
    return { spans, totalMs };
}

/** The timeline rows render without icons — a no-op stand-in keeps the
 *  vendored tool-timeline element untouched. */
const NO_ICON = (() => null) as unknown as LucideIcon;

export function RunMetadata({ run }: { run: any }) {
    const { rows } = useMemo(() => runMetadata(run), [run]);
    const [timelineOpen, setTimelineOpen] = useState(false);

    const { spans, totalMs } = useMemo(() => waterfallFor(run?.trace, typeof run?.duration === "number" ? run.duration : undefined), [run?.trace, run?.duration]);

    // Token usage: harness runs record a final "usage" trace event (the run
    // table has no token columns); legacy pipeline runs carry per-section
    // tokens in qualitative_analysis. Either source feeds the CostMeter.
    const tokens = useMemo(() => {
        const trace = Array.isArray(run?.trace) ? run.trace : [];
        for (let i = trace.length - 1; i >= 0; i--) {
            const ev = trace[i];
            if (ev?.type === "usage" && ev.value) {
                const v = ev.value as { tokens_in?: number; tokens_out?: number };
                const input = Number(v.tokens_in ?? 0);
                const output = Number(v.tokens_out ?? 0);
                if (input + output > 0) return { input, output, total: input + output };
            }
        }
        return tokensUsed(run?.qualitative_analysis || {});
    }, [run?.trace, run?.qualitative_analysis]);

    // ponytail: the harness records no per-model pricing — the meter reads tokens, not dollars; add $ when cost data lands.
    const costLines: CostLine[] =
        tokens && run?.model
            ? [
                  {
                      model: String(run.model),
                      inputTokens: tokens.input,
                      outputTokens: tokens.output,
                      cost: `${formatTokenCount(tokens.input + tokens.output)} tok`,
                      share: 1,
                  },
              ]
            : [];

    if (!rows.length && !spans.length && !costLines.length) return null;
    return (
        <Flex direction="column" gap={4} py={2}>
            {rows.length > 0 && (
                <Flex direction="column" gap={1.5}>
                    {rows.map((r) => (
                        <Flex key={r.label} gap={3} align="baseline" minW={0}>
                            <Text w="140px" flexShrink={0} fontSize="12.5px" fontWeight={300} color="var(--ink-tertiary)">
                                {r.label}
                            </Text>
                            <Text fontSize="13px" fontWeight={400} color="var(--ink-primary)" overflowWrap="anywhere" minW={0}>
                                {r.value}
                            </Text>
                        </Flex>
                    ))}
                </Flex>
            )}
            {spans.length > 0 && (
                <ToolTimeline
                    steps={spans.map((s) => ({ verb: s.name, chip: `${(s.durationMs / 1000).toFixed(1)}s`, icon: NO_ICON }))}
                    visibleSteps={12}
                    streaming={!TERMINAL.includes(String(run?.status || "").toLowerCase())}
                    open={timelineOpen}
                    onOpenChange={setTimelineOpen}
                    restingLabel={`${spans.length} tool calls`}
                    activeLabel={`${spans.length} tools so far`}
                    stats={[]}
                />
            )}
            {costLines.length > 0 && (
                <CostMeter
                    runCost={`${formatTokenCount(tokens!.total)} tok`}
                    sessionCost="—"
                    lines={costLines}
                />
            )}
        </Flex>
    );
}

/** Sticky-navbar run pill (assistant-ui agent-status): what the run is doing + elapsed. */
function AgentStatusPill({ analysis }: { analysis: any }) {
    const statusKey = String(analysis?.status || "").toLowerCase();
    const terminal = TERMINAL.includes(statusKey);
    const failed = ["error", "failed", "budget_exhausted"].includes(statusKey);
    const running = !!analysis && !terminal;

    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        if (!running) return;
        const iv = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(iv);
    }, [running]);

    const label = useMemo(() => {
        if (!analysis) return "Loading…";
        if (failed) return "Run failed";
        if (terminal) return "Run complete";
        const trace: any[] = Array.isArray(analysis.trace) ? analysis.trace : [];
        for (let i = trace.length - 1; i >= 0; i--) {
            const ev = trace[i];
            if (ev?.type === "tool_call") return `${ev.tool || "working"}…`;
            if (ev?.type === "thought" && ev.text) {
                const t = ev.text.trim().replace(/\s+/g, " ");
                return t.length > 44 ? `${t.slice(0, 44)}…` : t;
            }
        }
        return "Working…";
    }, [analysis, failed, terminal]);

    const elapsed = useMemo(() => {
        if (!running) return undefined;
        const t0 = analysis?.started_at
            ? +new Date(analysis.started_at)
            : analysis?.created_at
              ? +new Date(analysis.created_at)
              : now;
        return Math.max(0, Math.floor((now - t0) / 1000));
    }, [running, analysis, now]);

    return (
        <AgentStatus
            state={failed ? "failed" : terminal ? "done" : "working"}
            label={label}
            elapsed={elapsed !== undefined && elapsed > 0 ? formatSeconds(elapsed) : undefined}
            aria-live="polite"
        />
    );
}

export default function AnalysisResult() {
    const { id } = useParams();
    const reducedMotion = useReducedMotion();
    const [analysis, setAnalysis] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<Tab>("report");

    const statusKey = (analysis?.status || "").toLowerCase();
    const terminalStatuses = ["complete", "completed", "success", "error", "failed", "budget_exhausted"];
    const isRunning = !!analysis && !terminalStatuses.includes(statusKey);
    const isComplete = !!analysis && terminalStatuses.includes(statusKey);

    const fetchCancelled = useRef(false);
    const fetchTimer = useRef<number | null>(null);
    useEffect(() => {
        fetchCancelled.current = false;
        const run = () => {
            if (fetchCancelled.current || !id) return;
            (async () => {
                try {
                    setLoading(true);
                    const data = await AnalysisService.readAnalysis(id);
                    if (fetchCancelled.current) return;
                    if (data) {
                        setAnalysis(data);
                        const s = (data.status || "").toLowerCase();
                        if (s === "pending" || s === "running" || s === "processing") {
                            fetchTimer.current = window.setTimeout(run, 3000);
                        }
                    } else {
                        setError("Run not found");
                    }
                } catch {
                    if (!fetchCancelled.current) setError("Failed to load run result");
                } finally {
                    if (!fetchCancelled.current) setLoading(false);
                }
            })();
        };
        run();
        return () => {
            fetchCancelled.current = true;
            if (fetchTimer.current != null) window.clearTimeout(fetchTimer.current);
        };
    }, [id]);

    /** Re-read the run — the Retry affordance shared by the load-error state
     *  and the failed-run banner below. Keeps polling while the run is live
     *  (a retried run comes back RUNNING and must not freeze on one fetch). */
    const reload = () => {
        setError(null);
        setLoading(true);
        fetchTimer.current != null && window.clearTimeout(fetchTimer.current);
        fetchCancelled.current = false;
        (async () => {
            try {
                const data = await AnalysisService.readAnalysis(id!);
                if (fetchCancelled.current) return;
                if (data) {
                    setAnalysis(data);
                    const s = (data.status || "").toLowerCase();
                    if (s === "pending" || s === "running" || s === "processing")
                        fetchTimer.current = window.setTimeout(reload, 3000);
                } else setError("Run not found");
            } catch {
                setError("Failed to load run result");
            } finally {
                if (!fetchCancelled.current) setLoading(false);
            }
        })();
    };

    /** The failed-run Retry: relaunch server-side, then poll the fresh run. */
    const retryRun = async () => {
        try {
            await AnalysisService.retryAnalysis(id!);
            reload();
        } catch (e: any) {
            toaster.create({ title: "Couldn't retry the run", description: e?.message, type: "error" });
        }
    };

    // U4: the Report tab is not populated while a run is in progress.
    const reportAvailable = isComplete;

    const handleTabChange = useCallback((details: { value: string }) => {
        const tab = details.value as Tab;
        setActiveTab(tab);
        // Only scroll the tab panel into view when its top is above the
        // viewport (hidden under the sticky bar); never force-scroll otherwise.
        requestAnimationFrame(() => {
            const el = document.getElementById("tab-panels");
            if (el) {
                const top = el.getBoundingClientRect().top;
                if (top < 0) el.scrollIntoView({ behavior: "smooth", block: "start" });
            }
        });
    }, []);

    // Resolve reported citedKeys/sourceKeys to concrete data points for captions.
    const evidenceLookup = useMemo(() => {
        const m: Record<string, string> = {};
        const quant = analysis?.quantitative_analysis || {};
        for (const [k, d] of Object.entries(quant)) {
            const label = d.metric_name || k;
            const rule = `${OP_SYMBOL[d.operator] || "="} ${d.threshold ?? "—"}`;
            const line = d.price_unavailable
                ? `${label} → N/A (no live price)`
                : `${label} ${rule} → ${d.value ?? "—"} · score ${Math.round((d.score ?? 0) * 10) / 10}`;
            m[k] = line;
            m[label] = line;
        }
        const qual = analysis?.qualitative_analysis || {};
        for (const [k, p] of Object.entries(qual)) {
            const line = p.error ? `score N/A (${p.error})` : `score ${Math.round((p.score ?? 0) * 10) / 10}`;
            m[k] = line;
        }
        return m;
    }, [analysis]);

    // Skill tags come from the live library, keyed by skill id — shown on the
    // hero identity line (skill runs) and in run metadata (harness runs).
    const { library: skillLibrary } = useSkillLibrary();
    const skillTags = useMemo(() => {
        const m: Record<string, string[]> = {};
        for (const s of skillLibrary) if (s.tags?.length) m[s.id] = s.tags;
        return m;
    }, [skillLibrary]);
    const runSkillTags = useMemo(() => {
        const ids: string[] = Array.isArray(analysis?.skill_ids) && analysis.skill_ids.length
            ? analysis.skill_ids
            : analysis?.skill_id ? [analysis.skill_id] : [];
        return Array.from(new Set(ids.flatMap((i) => skillTags[i] || [])));
    }, [analysis, skillTags]);

    if (loading && !analysis) {
        // 5e: skeleton of the real layout instead of a bare spinner — no layout shift.
        return (
            <Box bg="var(--surface-canvas)" minH="100%">
                <Container maxW="full" px={0} py={6}>
                    <VStack gap={4} align="stretch">
                        <HStack justify="space-between" align="center">
                            <HStack gap={3}>
                                <Box h="24px" w="90px" bg="var(--surface-recessed)" borderRadius="6px" />
                                <Box h="24px" w="180px" bg="var(--surface-recessed)" borderRadius="6px" />
                            </HStack>
                            <Box h="28px" w="120px" bg="var(--surface-recessed)" borderRadius="6px" />
                        </HStack>
                        <Box h="20px" w="60%" bg="var(--surface-recessed)" borderRadius="6px" />
                        <Box border="1px solid var(--hairline)" borderRadius="6px" p={6}>
                            <HStack gap={8} align="flex-start">
                                <Box>
                                    <Box h="16px" w="160px" bg="var(--surface-recessed)" borderRadius="6px" mb={2} />
                                    <Box h="52px" w="110px" bg="var(--surface-recessed)" borderRadius="6px" />
                                </Box>
                                <Box flex={1}>
                                    <Box h="16px" w="90px" bg="var(--surface-recessed)" borderRadius="6px" mb={2} />
                                    <Box h="6px" w="100%" bg="var(--surface-recessed)" borderRadius="3px" />
                                </Box>
                                <Box flex={1}>
                                    <Box h="16px" w="90px" bg="var(--surface-recessed)" borderRadius="6px" mb={2} />
                                    <Box h="6px" w="100%" bg="var(--surface-recessed)" borderRadius="3px" />
                                </Box>
                            </HStack>
                        </Box>
                        {[0, 1, 2].map((i) => (
                            <Box key={i} border="1px solid var(--hairline)" borderRadius="6px" px={4} py={3}>
                                <HStack justify="space-between">
                                    <Box h="16px" w={`${45 - i * 8}%`} bg="var(--surface-recessed)" borderRadius="6px" />
                                    <Box h="16px" w="48px" bg="var(--surface-recessed)" borderRadius="6px" />
                                </HStack>
                            </Box>
                        ))}
                        <Flex justify="center" py={2}>
                            <Spinner size="sm" borderWidth="2px" color="var(--ink-secondary)" />
                        </Flex>
                    </VStack>
                </Container>
            </Box>
        );
    }

    if (error) {
        return (
            <Container maxW="960px" py={12}>
                <Flex direction="column" align="center" minH="50vh" gap={4}>
                    <Box maxW="520px">
                        <Callout tone="negative" title="Something went wrong">
                            {error}
                        </Callout>
                    </Box>
                    <HStack gap={3}>
                        <Link to="/runs" style={{ textDecoration: "none" }}>
                            <Button variant="subtle" size="sm" color="var(--ink-secondary)">
                                <MdArrowBack style={{ marginRight: 6 }} /> Back to Runs
                            </Button>
                        </Link>
                        <Button
                            variant="solid"
                            size="sm"
                            onClick={reload}
                        >
                            Retry
                        </Button>
                    </HStack>
                </Flex>
            </Container>
        );
    }

    if (!analysis) return null;

    // Harness runs (and any live run, even before the first canvas snapshot)
    // render the workspace-first view: agent workspace only while running,
    // report only once the run is terminal. The legacy layout below is for
    // completed skill-era rows.
    if (isRunning || analysis.report_document) {
        return <HarnessRunView run={analysis} tags={runSkillTags} onRetry={retryRun} />;
    }

    const s = (analysis.status || "").toLowerCase();
    const isError = s === "error" || s === "failed";

    // Per-skill reports — what the skill pipeline actually produced for this run.
    const skillOutputs: any[] = Array.isArray(analysis.skill_outputs) ? analysis.skill_outputs : [];

    const traceCount = Array.isArray(analysis.trace) ? analysis.trace.length : 0;

    const totalScore: number | null = analysis.total_score;
    const coverage: number | null = analysis.coverage ?? null;
    // U2: low coverage must never show a big headline number AND a suppression
    // message — the hero reports "Unscored" and the caution callout explains why.
    const lowCoverage = insufficientCoverage(coverage);
    const showScore = totalScore != null && !lowCoverage;

    const runSubject = skillOutputs[0]?.skill_name || "Skill";

    // Hero data: the verdict leads, the identity block and score sentence hang off it.
    const verdict = verdictForScore(showScore ? totalScore : null);
    const company = analysis.share_name || analysis.symbol || "this company";
    const verdictDate = analysis.created_at
        ? new Date(analysis.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
        : "";
    const identityLine = [skillOutputs[0]?.category, ...(skillTags[skillOutputs[0]?.skill_id] || [])]
        .filter(Boolean)
        .join(" · ");
    const skillScores = skillOutputs.map((o) => ({
        name: o.skill_name as string | undefined,
        score: typeof o.score_0_100 === "number" ? Math.round(o.score_0_100) : null,
    }));

    return (
        <Box bg="var(--surface-canvas)" minH="100%">
            <Tabs.Root value={activeTab} onValueChange={handleTabChange} variant="subtle" size="sm">
            <Container maxW="full" px={0} py={6}>
                {/* Sticky identity + utility bar */}                    <Box
                    as={motion.div}
                    initial={reducedMotion ? false : { opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: dur.base, ease }}
                    position="sticky"
                    top={0}
                    zIndex={20}
                    bg="var(--surface-canvas)"
                    borderBottom="1px solid var(--hairline)"
                    pb={3}
                    pt={2}
                    mb={5}
                    data-print-hide
                >
                    <Flex align="center" gap={2} minH="44px">
                        {/* Router Link doesn't take Chakra props — this is
                            styled with utility classes so the icon, label
                            and hover/focus states actually apply. */}
                        <Link
                            to="/runs"
                            aria-label="Back to runs"
                            className="inline-flex shrink-0 items-center gap-1 rounded-[4px] px-1.5 py-1 text-[13px] text-[var(--ink-secondary)] transition-colors hover:text-[var(--ink-primary)] focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-primary)]"
                        >
                            <MdArrowBack aria-hidden="true" />
                            <span className="hidden sm:inline">Runs</span>
                        </Link>
                        {/* One mini navbar: tabs inline, no rule under them —
                            the selected tab is a tinted rounded pill. The strip
                            scrolls itself, scrollbar hidden. */}
                        <Tabs.List
                            flex={1}
                            minW={0}
                            gap={1}
                            overflowX="auto"
                            css={{ scrollbarWidth: "none", "&::-webkit-scrollbar": { display: "none" } }}
                            data-print-hide
                        >
                            {TABS.map((tab) => {
                                const disabled = tab === "report" && !reportAvailable;
                                return (
                                    <Tabs.Trigger
                                        key={tab}
                                        value={tab}
                                        fontSize="13px"
                                        fontWeight={400}
                                        color={activeTab === tab ? "var(--ink-primary)" : "var(--ink-tertiary)"}
                                        bg={activeTab === tab ? "var(--surface-recessed)" : "transparent"}
                                        textTransform="capitalize"
                                        px={3}
                                        flexShrink={0}
                                        whiteSpace="nowrap"
                                        borderRadius="6px"
                                        _hover={disabled ? {} : { color: "var(--ink-primary)" }}
                                        transition="none"
                                        disabled={disabled}
                                        opacity={disabled ? 0.55 : 1}
                                        title={disabled ? "Available when the run is complete" : undefined}
                                    >
                                        {tab}
                                    </Tabs.Trigger>
                                );
                            })}
                        </Tabs.List>
                        <HStack gap={2} align="center" flexShrink={0}>
                            <AgentStatusPill analysis={analysis} />
                            {isComplete && <DownloadButton runId={id} name={analysis.share_name || analysis.symbol} />}
                        </HStack>
                    </Flex>
                </Box>

                {/* Company identity: non-sticky sub-header, visible at all widths */}
                <Box mb={5}>
                    <Flex align="center" gap={2.5} minW={0}>
                        <TickerLogo symbol={analysis.symbol} size={22} />
                        <Text
                            as="h1"
                            fontSize="16px"
                            fontWeight={600}
                            color="var(--ink-primary)"
                            lineHeight="short"
                            truncate
                        >
                            {analysis.share_name || analysis.symbol}
                        </Text>
                        <Text
                            fontSize="12px"
                            fontFamily="var(--font-mono)"
                            color="var(--ink-tertiary)"
                            flexShrink={0}
                        >
                            {analysis.symbol}
                        </Text>
                        <Box w="1px" h="14px" bg="var(--hairline)" flexShrink={0} />
                        <SourceMark
                            source={(analysis.source || "").toUpperCase().includes("SEC") ? "sec" : "nse"}
                            size={16}
                        />
                    </Flex>
                </Box>

                {analysis.price_data === "unavailable" && (
                    <Box mb={6}>
                        <Callout tone="caution" title="Live price data unavailable">
                            No live price feed for this instrument — valuation and technical criteria are shown as N/A.
                        </Callout>
                    </Box>
                )}

                {analysis.error && isComplete && (
                    <Box mb={6}>
                        <Callout tone="negative" title="Run Error">
                            <Text
                                as="span"
                                fontFamily="var(--font-mono)"
                                whiteSpace="pre-wrap"
                                wordBreak="break-word"
                                fontSize="12.5px"
                            >
                                {analysis.error}
                            </Text>
                        </Callout>
                    </Box>
                )}

                {/* Hero: the verdict leads — its word is the headline, the
                    identity block (avatar → actor → skills → model) and the
                    score sentence are read from it. Skill runs get the same
                    block; only the wording of the sentence changes. */}
                {isComplete && (
                    <Box mb={6} as={motion.div} initial={reducedMotion ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: dur.base, ease }}>
                        <Text fontSize="12px" color="var(--ink-tertiary)" mb={3} letterSpacing="0.03em">
                            {verdictDate ? `Verdict as of ${verdictDate}` : "Verdict"}
                        </Text>
                        <Text
                            fontSize={{ base: "52px", md: "88px" }}
                            fontWeight={400}
                            lineHeight="0.95"
                            fontFamily="var(--font-display)"
                            color={verdict.color}
                            mb={4}
                        >
                            {verdict.label}
                        </Text>
                        <Flex align="flex-start" gap={3} mb={4}>
                            <PluginAvatar plugin={analysis.plugin_ids?.[0] || analysis.agent_name || "run"} size={56} />
                            <Box minW={0}>
                                <Text fontSize="15px" fontWeight={600} color="var(--ink-primary)" lineHeight="1.35">
                                    {runSubject || "Plugin"}
                                </Text>
                                {identityLine && (
                                    <Text
                                        fontSize="12px"
                                        fontFamily="var(--font-mono)"
                                        color="var(--ink-tertiary)"
                                        mt={1}
                                        overflowWrap="anywhere"
                                    >
                                        {identityLine}
                                    </Text>
                                )}
                                <HStack gap={1.5} mt={1} align="center">
                                    <ModelLogo model={analysis.model} size={13} />
                                    <Text fontSize="12px" color="var(--ink-tertiary)" truncate>
                                        {analysis.model || "Unknown model"}
                                    </Text>
                                </HStack>
                            </Box>
                        </Flex>
                        <Text fontSize="15px" color="var(--ink-secondary)" lineHeight="1.6" maxW="74ch" mb={2}>
                            <ScoreSentence
                                mode="skill"
                                actor={runSubject}
                                company={company}
                                score={showScore ? totalScore : null}
                                color={verdict.color}
                                skills={skillScores}
                            />
                        </Text>
                        {/* Disclaimer: verdict provenance, kept quiet — grey, small, icon-led. */}
                        <Text
                            display="flex"
                            alignItems="flex-start"
                            gap={1.5}
                            fontSize="11.5px"
                            color="var(--ink-tertiary)"
                            lineHeight="1.5"
                            maxW="74ch"
                            mb={4}
                        >
                            <MdInfo size={13} style={{ marginTop: 2, flexShrink: 0 }} aria-hidden="true" />
                            <span>
                                The verdict is not investment advice — it depends on the quality of the{" "}
                                <Link
                                    to="/my-workspace"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-[var(--ink-tertiary)] underline decoration-[var(--hairline)] underline-offset-2 transition-colors hover:text-[var(--ink-secondary)] focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-primary)]"
                                >
                                    skills
                                </Link>
                                ; make sure their instructions are verified before running them.
                            </span>
                        </Text>
                        <HStack gap={2} flexWrap="wrap">
                            {coverage != null && (
                                <Box px={3} py={1} borderRadius="full" border="1px solid var(--hairline)" bg="var(--surface-panel)">
                                    <Text fontSize="12px" fontFamily="var(--font-mono)" color="var(--ink-secondary)">
                                        {coverageLabel(coverage)} of rubric scored
                                    </Text>
                                </Box>
                            )}
                        </HStack>
                        {lowCoverage && (
                            <Box maxW="70ch" mt={3}>
                                <Callout tone="caution" title="Not enough of the rubric could be scored to give a reliable headline score.">
                                    Only {coverageLabel(coverage)} of the criteria had usable data. Review the breakdowns below — unscored criteria are excluded, not failed.
                                </Callout>
                            </Box>
                        )}
                    </Box>
                )}

                {/* Completed runs: report tabs (legacy skill pipeline). */}
                <Box key="report" id="tab-panels" css={{ scrollMarginTop: "64px" }}>
                    {/* tab triggers live in the sticky navbar above */}

                        {/* ── Report ── */}
                        <Tabs.Content value="report">
                            <Box>
                                {isComplete ? (
                                    <Box>
                                        {/* Decision-first order (E1): synthesis and verdict
                                            first, evidence-dense breakdowns after. */}
                                        {/* Report Section (agent runs, or skill runs that got a synthesized report) */}
                                        {(!!analysis.report) && (
                                        <Box mb={6}>
                                            {analysis.report ? (
                                                <>
                                                    <ReportBlockRenderer blocks={analysis.report.blocks} lookup={evidenceLookup} />
                                                </>
                                            ) : (
                                                <Callout tone="caution">
                                                    No executive synthesis for this run — review the parameter breakdowns below.
                                                </Callout>
                                            )}
                                        </Box>
                                        )}

                                        <Box mb={4}>
                                            {skillOutputs.length > 0 ? (
                                                <Flex direction="column" gap={6}>
                                                    {skillOutputs.map((out: any, i: number) => (
                                                        <SkillResultCard key={out.skill_id || out.skill_name || i} output={out} analysisId={id} />
                                                    ))}
                                                </Flex>
                                            ) : (
                                                <Callout tone="caution">
                                                    No skill reports were stored for this run.
                                                </Callout>
                                            )}
                                        </Box>
                                        </Box>
                                ) : (
                                    <EmptyState message="Waiting for the run to complete — the report appears here when it's done." />
                                )}
                            </Box>
                        </Tabs.Content>

                        {/* ── Reasoning (full agent trace, live while running) ── */}
                        <Tabs.Content value="reasoning">
                            <Box>
                                <SectionHeader label="Agent Reasoning" count={traceCount} />
                                {isRunning ? (
                                    <AgentActivity
                                        title={`Analyzing ${analysis.share_name || analysis.symbol || "…"} with ${runSubject}`}
                                        subtitle="gathering data, searching, scoring"
                                        streamUrl={`/analysis/${id}/stream`}
                                        steps={[]}
                                        agent={analysis.agent_name || undefined}
                                        startedAt={analysis.created_at ? +new Date(analysis.created_at) : undefined}
                                        active
                                        maxHeight={480}
                                    />
                                ) : (
                                    <AgentActivity
                                        title={`Reasoning history — ${analysis.share_name || analysis.symbol || "…"} with ${runSubject}`}
                                        subtitle="full tool and thought trace"
                                        events={analysis.trace || []}
                                        steps={[]}
                                        agent={analysis.agent_name || undefined}
                                        active={false}
                                        maxHeight={480}
                                    />
                                )}
                            </Box>
                        </Tabs.Content>

                        {/* ── Run info — what the run recorded, one line each ── */}
                        <Tabs.Content value="run info">
                            <RunMetadata run={analysis} />
                        </Tabs.Content>
                    </Box>

            </Container>
            </Tabs.Root>
        </Box>
    );
}

/* ─── Sub-components ─── */

/** 5d: one shared callout for caution/negative/info — replaces 5 copy-pasted blocks. */

/**
 * Surfaces `artifacts.verification` (services/api/types/layout.ts): silent only when
 * the layout came straight from the model and every reference grounded — the
 * fallback sources and unresolved refs otherwise say so, so a best-effort
 * render is never mistaken for a full one.
 */
function Callout({
    tone,
    title,
    children,
}: {
    tone: "caution" | "negative" | "info";
    title?: string;
    children: React.ReactNode;
}) {
    const color =
        tone === "negative"
            ? "var(--signal-negative)"
            : tone === "caution"
              ? "var(--signal-caution)"
              : "var(--accent-primary)";
    return (
        <Box
            borderLeft={`3px solid ${color}`}
            bg="var(--surface-panel)"
            border="1px solid var(--hairline)"
            borderLeftWidth="3px"
            borderRadius="6px"
            pl={4}
            pr={4}
            py={3}
        >
            {title && (
                <Text fontSize="13px" fontWeight={500} color="var(--ink-primary)" mb={1}>
                    {title}
                </Text>
            )}
            <Text fontSize="13px" color="var(--ink-secondary)">
                {children}
            </Text>
        </Box>
    );
}

// Hard-coded score sentence, per run mode. Scores are set in the display face
// at weight 500 and tinted with the verdict colour, so colour = band only.
function ScoreSentence({
    mode,
    actor,
    company,
    score,
    color,
    skills,
}: {
    mode: "agent" | "skill";
    actor: string;
    company: string;
    score: number | null;
    color: string;
    skills: { name?: string; score: number | null }[];
}) {
    const num = (v: number, key?: string) => (
        <Text
            as="span"
            key={key}
            fontFamily="var(--font-display)"
            fontWeight={500}
            color={color}
        >
            {v}/100
        </Text>
    );

    if (score == null) {
        return (
            <span>
                {mode === "agent" ? "The agent" : `The ${actor}`} evaluated {company} — no headline score for this run.
            </span>
        );
    }

    if (mode === "skill") {
        return (
            <span>
                The {actor} skill scored {company} {num(score)}.
            </span>
        );
    }

    const perSkill = skills
        .filter((s) => s.name && s.score != null)
        .slice(0, 3)
        .map((s) => `${s.name} ${s.score}`)
        .join(" and ");

    return (
        <span>
            The agent scored {company} {num(score)}
            {perSkill ? `, with individual skill scores of ${perSkill}.` : "."}
        </span>
    );
}

// 5f: no per-header fade/slide — the only entrance animation is the hero's,
// and it's disabled under prefers-reduced-motion.
function SectionHeader({ label, count }: { label: string; count: number }) {
    return (
        <Flex align="center" gap={2} mb={4}>
            <Text
                fontSize="13px"
                fontWeight={600}
                color="var(--ink-primary)"
                letterSpacing="0.04em"
            >
                {label}
            </Text>
            {count > 0 && (
                <Box
                    as="span"
                    fontSize="12px"
                    fontFamily="var(--font-mono)"
                    color="var(--ink-tertiary)"
                    px={2}
                    py={0.5}
                    borderRadius="full"
                    bg="var(--surface-recessed)"
                >
                    {count}
                </Box>
            )}
            <Box flex={1} h="1px" bg="var(--hairline)" ml={2} />
        </Flex>
    );
}

function EmptyState({ message }: { message: string }) {
    return (
        <Flex
            py={16}
            justify="center"
            color="var(--ink-tertiary)"
            fontSize="13px"
        >
            {message}
        </Flex>
    );
}

const HARNESS_TABS = ["report", "agent workspace", "run info"] as const;
type HarnessTab = (typeof HARNESS_TABS)[number];

/** One score inside each verdict band — keeps the big verdict's ink in sync
 *  with verdictForScore(), the single source of truth for verdict colours. */
const VERDICT_BAND_EXAMPLE: Record<string, number> = {
    Outstanding: 95, Strong: 80, Fair: 60, Underwhelming: 45, Subpar: 20,
};

/** Harness run result: the typed ReportDocument + the Agent Workspace (reasoning + knowledge base). */
/** The banner's Retry — spins while the relaunch request is in flight, so
 *  a click always answers visibly. */
function RetryButton({ onRetry }: { onRetry: () => void | Promise<void> }) {
    const [retrying, setRetrying] = useState(false);
    return (
        <Button
            variant="solid"
            size="sm"
            loading={retrying}
            onClick={() => {
                if (retrying) return;
                setRetrying(true);
                void Promise.resolve(onRetry()).finally(() => setRetrying(false));
            }}
        >
            Retry
        </Button>
    );
}

function HarnessRunView({ run, onRetry }: { run: any; tags?: string[]; onRetry?: () => void | Promise<void> }) {
    const doc = run.report_document as ReportDocument;
    const status = String(run.status || "").toLowerCase();
    const failed = status === "failed" || status === "budget_exhausted" || status === "error";
    // Mid-run the canvas pipeline flushes a partial document — but the report
    // tab stays hidden until the run is terminal; live viewing happens in the
    // agent workspace (reasoning timeline + knowledge base) behind a spinner.
    const drafting = status === "running" || status === "pending" || status === "processing";
    // Derived tab — no effect: while drafting the workspace is the ONLY view;
    // the moment the run finishes the report is selected (unless the user
    // picks a tab afterwards, which is what the null default preserves).
    const [postRunTab, setPostRunTab] = useState<HarnessTab | null>(null);
    const harnessTab: HarnessTab = drafting ? "agent workspace" : postRunTab ?? "report";
    const workspace = (run.workspace ?? null) as Record<string, string> | null;
    const hasTrace = Array.isArray(run.trace) && run.trace.length > 0;
    // The document carries the verdict word (e.g. "Fair"); older rows without
    // one fall back to the score-derived word.
    const verdictWord = String((doc as any)?.verdict || verdictForScore(run.total_score).label);
    const verdictInk = verdictForScore(VERDICT_BAND_EXAMPLE[verdictWord] ?? null).color;
    const ticker = String(doc?.symbol || run.symbol || "");
    const stockName = String(run.share_name || ticker);
    // Some runs store the ticker as the share name — don't print it twice.
    const showTicker = ticker && ticker.toLowerCase() !== stockName.toLowerCase();
    return (
        <Box bg="var(--surface-canvas)">
            <Tabs.Root
                value={harnessTab}
                onValueChange={(details) => {
                    if (!drafting) setPostRunTab(details.value as HarnessTab);
                }}
                variant="subtle"
                size="sm"
            >
            <Container maxW="full" px={0} pt={6} pb={2}>
                {/* One mini navbar: back · tabs · download. Tabs carry no rule —
                    the selected one is a tinted rounded pill; the strip scrolls
                    itself with the scrollbar hidden. */}
                <Flex align="center" gap={2} minH="44px" mb={3}>
                    <Link
                        to="/runs"
                        aria-label="Back to runs"
                        className="inline-flex shrink-0 items-center gap-1 rounded-[4px] px-1.5 py-1 text-[13px] text-[var(--ink-secondary)] transition-colors hover:text-[var(--ink-primary)] focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-primary)]"
                    >
                        <MdArrowBack aria-hidden="true" />
                        <span className="hidden sm:inline">Runs</span>
                    </Link>
                    <Tabs.List
                        flex={1}
                        minW={0}
                        gap={1}
                        overflowX="auto"
                        css={{ scrollbarWidth: "none", "&::-webkit-scrollbar": { display: "none" } }}
                        data-print-hide
                    >
                        {HARNESS_TABS.map((tab) => {
                            // No report trigger until the run completes — the
                            // report must not be reachable mid-run at all.
                            if (drafting && tab !== "agent workspace") return null;
                            return (
                            <Tabs.Trigger
                                key={tab}
                                value={tab}
                                fontSize="13px"
                                fontWeight={400}
                                color={harnessTab === tab ? "var(--ink-primary)" : "var(--ink-tertiary)"}
                                bg={harnessTab === tab ? "var(--surface-recessed)" : "transparent"}
                                textTransform="capitalize"
                                px={3}
                                flexShrink={0}
                                whiteSpace="nowrap"
                                borderRadius="6px"
                                _hover={{ color: "var(--ink-primary)" }}
                                transition="none"
                            >
                                {tab}
                            </Tabs.Trigger>
                            );
                        })}
                    </Tabs.List>
                    <Box flexShrink={0}>
                        <DownloadButton runId={run.id} name={run.share_name || run.symbol} />
                    </Box>
                </Flex>

                {/* Failed runs must say why — cause, the fix, and a retry —
                    on every tab, not just the partial report. */}
                {!drafting && (failed || run.error) && (
                    <Box mt={4} mb={2}>
                        <Callout tone="negative" title="Run Error">
                            {run.error ? (
                                <Text
                                    as="span"
                                    fontFamily="var(--font-mono)"
                                    whiteSpace="pre-wrap"
                                    wordBreak="break-word"
                                    fontSize="12.5px"
                                >
                                    {run.error}
                                </Text>
                            ) : (
                                <Text as="span">
                                    The run stopped before it could finish — no cause was recorded.
                                </Text>
                            )}
                        </Callout>
                        <Flex align="center" gap={3} mt={2}>
                            <Text fontSize="12.5px" color="var(--ink-secondary)">
                                Check Settings → API keys, then retry.
                            </Text>
                            {onRetry && (
                                <RetryButton onRetry={onRetry} />
                            )}
                        </Flex>
                    </Box>
                )}

                    {/* ── Report ── */}
                    <Tabs.Content value="report">
                        {drafting && (
                            <Box mt={4}>
                                <Callout tone="info" title="Report is being written">
                                    Sections land on the report as the agent composes them. The remaining sections appear
                                    when they are ready — nothing is lost if the run stops early.
                                </Callout>
                            </Box>
                        )}
                        {failed && (
                            <Text mt={4} fontSize="13px" color="var(--ink-secondary)">
                                The run did not complete — the report below is partial.
                            </Text>
                        )}
                        {/* Stock identity + verdict lead the report: a large logo,
                            name and ticker on one line, then the verdict word. */}
                        {doc && (
                            <Flex align="center" gap={{ base: 5, md: 8 }} mt={6} mb={9}>
                                <TickerLogo symbol={ticker} size={128} />
                                <Box minW={0}>
                                    <Flex align="baseline" gap={3} flexWrap="wrap">
                                        <Text
                                            as="h1"
                                            fontSize={{ base: "18px", md: "20px" }}
                                            fontWeight={500}
                                            lineHeight="shorter"
                                            color="var(--ink-primary)"
                                        >
                                            {stockName}
                                        </Text>
                                        {showTicker && (
                                            <Text fontSize="14px" fontWeight={400} color="var(--ink-tertiary)">
                                                {ticker}
                                            </Text>
                                        )}
                                    </Flex>
                                    <Text
                                        fontFamily="var(--font-display)"
                                        fontWeight={300}
                                        fontSize={{ base: "48px", md: "76px" }}
                                        lineHeight="0.95"
                                        color={verdictInk}
                                        mt={{ base: 2, md: 3 }}
                                    >
                                        {verdictWord}
                                    </Text>
                                </Box>
                            </Flex>
                        )}
                        <Box mt={4}>
                            <ReportDocumentRenderer document={doc} />
                        </Box>
                    </Tabs.Content>

                    {/* ── Agent Workspace ── */}
                    <Tabs.Content value="agent workspace">
                        {drafting && (
                            <Text mt={4} mb={2} fontSize="13px" color="var(--ink-secondary)">
                                Run in progress — reasoning and knowledge base stream in here live.
                            </Text>
                        )}
                        {hasTrace && (
                            <Box mt={4} mb={2}>
                                <AgentActivity
                                    title={`Analyzing ${run.share_name || run.symbol || "…"} with ${run.agent_name || "plugin"}`}
                                    subtitle={drafting ? "gathering data, searching, scoring" : "full tool and thought trace"}
                                    events={run.trace || []}
                                    agent={run.agent_name || undefined}
                                    startedAt={run.started_at || run.created_at ? +new Date(run.started_at || run.created_at) : undefined}
                                    active={drafting}
                                    maxHeight={620}
                                />
                            </Box>
                        )}
                        {workspace && (
                            <Box mt={8} mb={6}>
                                <Text fontSize="13px" fontWeight={600} mb={1}>Knowledge Base</Text>
                                <Text fontSize="12px" color="var(--ink-secondary)" mb={3}>
                                    Evidence the agent gathered and distilled during research — notes cite archived sources.
                                </Text>
                                <WorkspaceExplorer workspace={workspace} live={drafting} />
                            </Box>
                        )}
                        {!drafting && !hasTrace && !workspace && (
                            <Text mt={4} fontSize="13px" color="var(--ink-tertiary)">
                                No workspace data recorded for this run.
                            </Text>
                        )}
                    </Tabs.Content>

                    {/* ── Run info — what the run recorded, one line each ── */}
                    <Tabs.Content value="run info">
                        <RunMetadata run={run} />
                    </Tabs.Content>
            </Container>
            </Tabs.Root>
        </Box>
    );
}