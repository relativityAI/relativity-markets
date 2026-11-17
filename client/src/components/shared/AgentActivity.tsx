import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Box, Flex, Text, type BoxProps } from "@chakra-ui/react";
import { API_BASE } from "@/db";
import { supabase } from "@/lib/supabase";
import type { TraceEvent } from "@/pages/shared/TracePanel";
import AgentAvatar from "@/components/shared/AgentAvatar";
import type { AgentSeedLike } from "@/lib/agentIdentity";
import { ToolCall } from "@/components/assistant-ui/elements/tool-call";
import { GenerationLoader } from "@/components/assistant-ui/elements/loading-state";
import { AgentPlan } from "@/components/assistant-ui/elements/agent-plan";
import { WebSearch, type WebSearchResult } from "@/components/assistant-ui/elements/web-search";
import { ToolError } from "@/components/assistant-ui/elements/tool-error";

/* ─── Live SSE hook (generic over any trace stream URL) ────────────────── */

function useSseTrace(url: string | undefined, onEvent: (ev: TraceEvent) => void): boolean {
    const [connected, setConnected] = useState(false);
    const cbRef = useRef(onEvent);
    cbRef.current = onEvent;

    useEffect(() => {
        if (!url) return;
        const controller = new AbortController();
        let cancelled = false;

        const connect = async () => {
            try {
                const { data } = await supabase.auth.getSession();
                const token = data.session?.access_token;
                const res = await fetch(`${API_BASE}${url}`, {
                    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
                    signal: controller.signal,
                });
                if (!res.ok || !res.body) {
                    setConnected(false);
                    return;
                }
                setConnected(true);
                const reader = res.body.getReader();
                const decoder = new TextDecoder();
                let buffer = "";
                for (;;) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    buffer += decoder.decode(value, { stream: true });
                    const frames = buffer.split("\n\n");
                    buffer = frames.pop() || "";
                    for (const frame of frames) {
                        const dataLine = frame.split("\n").find((l) => l.startsWith("data:"));
                        if (!dataLine) continue;
                        try {
                            const payload = JSON.parse(dataLine.slice(5).trim());
                            if (payload?.type === "trace" && payload.event) {
                                cbRef.current(payload.event);
                            }
                            if (payload?.type === "ready") setConnected(true);
                        } catch {
                            // ignore malformed frames
                        }
                    }
                }
            } catch {
                if (!cancelled) setConnected(false);
            }
        };

        connect();
        return () => {
            cancelled = true;
            controller.abort();
            setConnected(false);
        };
    }, [url]);

    return connected;
}

/* ─── Activity rows ────────────────────────────────────────────────────── */

type ActivityRow =
    | { kind: "step"; label: string; status: string; duration_ms?: number }
    | { kind: "thought"; text: string }
    | { kind: "tool"; name: string; toolCallId?: string; args?: unknown; status: "running" | "OK" | "ERR"; duration_ms?: number; result?: string }
    | { kind: "decision"; score?: number; text?: string }
    | { kind: "log"; text: string };

/** Tool result JSON for the disclosure panel — capped so a big table never lands whole. */
function resultForPanel(result: unknown): string {
    if (result == null) return "";
    const s = typeof result === "string" ? result : JSON.stringify(result, null, 2);
    return s.length > 4000 ? `${s.slice(0, 4000)}…` : s;
}

function buildRows(steps: AgentStep[], events: TraceEvent[]): ActivityRow[] {
    const rows: ActivityRow[] = [];
    for (const st of events.length ? [] : steps || []) {
        rows.push({ kind: "step", label: st?.label || st?.key || "step", status: st?.status || "pending", duration_ms: st?.duration_ms });
    }
    for (const ev of [...events].sort((a, b) => a.seq - b.seq)) {
        switch (ev.type) {
            case "thought": {
                const last = rows[rows.length - 1];
                if (last?.kind === "thought") {
                    rows[rows.length - 1] = { kind: "thought", text: last.text + (ev.text || "") };
                } else {
                    rows.push({ kind: "thought", text: ev.text || "" });
                }
                break;
            }
            case "tool_call":
                rows.push({ kind: "tool", name: ev.tool || "tool", toolCallId: ev.tool_call_id, args: ev.args, status: "running" });
                break;
            case "tool_result": {
                // Resolve the most recent still-running call with the same tool name.
                let idx = -1;
                for (let i = rows.length - 1; i >= 0; i--) {
                    const r = rows[i];
                    if (r.kind === "tool" && r.status === "running" && (ev.tool_call_id ? r.toolCallId === ev.tool_call_id : r.name === ev.tool)) {
                        idx = i;
                        break;
                    }
                }
                if (idx >= 0) {
                    rows[idx] = {
                        kind: "tool",
                        name: ev.tool || "tool",
                        toolCallId: (rows[idx] as { toolCallId?: string }).toolCallId,
                        args: (rows[idx] as { args?: unknown }).args,
                        status: ev.status === "ERR" ? "ERR" : "OK",
                        duration_ms: ev.duration_ms,
                        // Raw result — the panel render caps it; the search
                        // parser needs the full JSON to find every source.
                        result: typeof ev.result === "string" ? ev.result : ev.result != null ? JSON.stringify(ev.result) : "",
                    };
                } else {
                    rows.push({ kind: "log", text: `${ev.tool} → ${ev.status}` });
                }
                break;
            }
            case "decision":
                rows.push({ kind: "decision", score: ev.score, text: ev.text });
                break;
            case "log":
                rows.push({ kind: "log", text: ev.text || "" });
                break;
            default:
                break;
        }
    }
    return rows;
}

function mmss(totalSec: number): string {
    const m = Math.floor(totalSec / 60);
    const s = Math.floor(totalSec % 60);
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** Mask applied only once a line actually overruns its box — colour eases out
 *  over the last stretch, right where the text reaches the very end. */
const FADE_STYLE: CSSProperties = {
    maskImage: "linear-gradient(to right, #000 86%, transparent)",
    WebkitMaskImage: "linear-gradient(to right, #000 86%, transparent)",
};

/**
 * A single line of reasoning output. Short lines print normally — no mask, no
 * ellipsis. Only when the text overflows its container does the tail fade, so
 * a line that ends mid-row never gets washed out.
 */
function FadeLine({ children, ...rest }: { children: string } & BoxProps) {
    const ref = useRef<HTMLDivElement>(null);
    const [clipped, setClipped] = useState(false);

    useLayoutEffect(() => {
        const el = ref.current;
        if (!el) return;
        const check = () => setClipped(el.scrollWidth > el.clientWidth + 1);
        check();
        const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(check) : null;
        ro?.observe(el);
        // Font swap can widen the text without resizing the box.
        document.fonts?.ready.then(check).catch(() => {});
        return () => ro?.disconnect();
    }, [children]);

    return (
        <Box
            ref={ref}
            whiteSpace="nowrap"
            overflow="hidden"
            style={clipped ? FADE_STYLE : undefined}
            {...rest}
        >
            {children}
        </Box>
    );
}

/** Cap one arg value so a file body never lands in the DOM whole. */
const ARG_VALUE_MAX = 160;

function toolArgsSummary(args: unknown): string {
    if (args == null) return "";
    try {
        const o = args as Record<string, unknown>;
        if (typeof o === "object" && !Array.isArray(o)) {
            return Object.entries(o)
                .filter(([, v]) => v != null && v !== "" && typeof v !== "object")
                .map(([k, v]) => {
                    const s = String(v);
                    return `${k}=${s.length > ARG_VALUE_MAX ? `${s.slice(0, ARG_VALUE_MAX)}…` : s}`;
                })
                .join("  ");
        }
        const json = JSON.stringify(args);
        return json.length > ARG_VALUE_MAX ? `${json.slice(0, ARG_VALUE_MAX)}…` : json;
    } catch {
        return "";
    }
}

/** Search-flavoured tools whose result can render as the WebSearch element. */
const SEARCHY = /search|news|tavily|web/i;

/**
 * (args, result) → WebSearch element data, or null when it isn't a search payload.
 * The result is parsed whole — capping happens at panel render, not here — so
 * long result lists still show their sources. A search that came back empty
 * carries the tool's own explanation in `emptyMessage`; the caller renders it
 * as a ToolError instead of a bare "no sources found".
 */
function webSearchData(args: unknown, result: unknown): { query: string; results: WebSearchResult[]; emptyMessage?: string } | null {
    const o = (args ?? {}) as Record<string, unknown>;
    // The feed carries results as capped JSON strings — parse before sniffing.
    let res: unknown = result;
    if (typeof res === "string") {
        try {
            res = JSON.parse(res);
        } catch {
            res = null;
        }
    }
    const rs = (res ?? {}) as Record<string, unknown>;
    // Args first, then the result — get_ticker_news carries only {days}.
    let query = [o.query, o.q, o.search, o.search_query, o.keywords, o.symbol, o.ticker, rs.symbol, rs.ticker].find(
        (v) => typeof v === "string" && v.trim(),
    ) as string | undefined;
    const list = Array.isArray(res)
        ? res
        : ((res as Record<string, unknown>)?.results ??
           (res as Record<string, unknown>)?.stories ??
           (res as Record<string, unknown>)?.data);
    if (!Array.isArray(list)) return null;
    // Market-wide news feeds carry no query — name them instead of dropping
    // the row back to a plain tool call.
    if (!query && (rs.country != null || rs.days != null)) {
        query = `Market news${rs.country ? ` · ${String(rs.country).toUpperCase()}` : ""}${rs.days ? ` · ${rs.days}d` : ""}`;
    }
    if (!query) return null;
    const emptyMessage = typeof rs.message === "string" && rs.message.trim() ? rs.message.trim() : undefined;
    const results: WebSearchResult[] = [];
    for (const r of list) {
        const t = (r ?? {}) as Record<string, unknown>;
        const title = String(t.title ?? t.name ?? t.headline ?? "").trim();
        let domain = "";
        try {
            domain = new URL(String(t.url ?? t.link ?? "")).hostname.replace(/^www\./, "");
        } catch {
            // no url — fall back to a placeholder domain
        }
        if (title || domain) results.push({ title: title || domain, domain: domain || "—" });
        if (results.length >= 5) break;
    }
    return { query, results, ...(results.length === 0 && emptyMessage ? { emptyMessage } : {}) };
}

/** One-line statement per row for the plain feed. Tool dumps are skipped. */
function statementFor(row: ActivityRow): string {
    switch (row.kind) {
        case "step":
            return row.label;
        case "thought": {
            // The final message is the report JSON — already rendered as the
            // report; don't dump the whole document into the feed.
            const t = row.text.trim();
            if (t.startsWith("{") && t.includes('"schema"')) return "";
            return t.length > 600 ? `${t.slice(0, 600)}…` : t;
        }
        case "tool": {
            const args = toolArgsSummary(row.args);
            const call = `${row.name}${args ? `  ${args}` : ""}`;
            if (row.status === "running") return `${call} …`;
            const secs = typeof row.duration_ms === "number" ? `  ·  ${(row.duration_ms / 1000).toFixed(1)}s` : "";
            return `${call}${secs}`;
        }
        case "decision":
            return `Decision ${row.score != null ? Number(row.score).toFixed(1) : ""}${row.text ? ` — ${row.text}` : ""}`;
        case "log":
            return row.text;
        default:
            return "";
    }
}

/* ─── Row renderer ─────────────────────────────────────────────────────── */

function Row({
    row,
    index,
    openRows,
    setOpenRows,
}: {
    row: ActivityRow;
    index: number;
    openRows: Record<number, boolean>;
    setOpenRows: (updater: (prev: Record<number, boolean>) => Record<number, boolean>) => void;
}) {
    switch (row.kind) {
        case "step":
            return (
                <Flex align="flex-start" gap={2} py={0.5} minW={0}>
                    <Text fontSize="12px" lineHeight="1.5" color={row.status === "running" ? "var(--ink-primary)" : "var(--ink-secondary)"} minW={0}>
                        {row.label}
                        {typeof row.duration_ms === "number" && row.status !== "running"
                            ? `  ·  ${(row.duration_ms / 1000).toFixed(1)}s`
                            : ""}
                    </Text>
                </Flex>
            );
        case "thought":
            return (
                <Flex align="flex-start" py={0.5} minW={0}>
                    <Text
                        fontSize="11.5px"
                        lineHeight="1.5"
                        color="var(--ink-secondary)"
                        fontStyle="italic"
                        whiteSpace="pre-wrap"
                        wordBreak="break-word"
                        minW={0}
                    >
                        {row.text.length > 900 ? row.text.slice(0, 900) + "…" : row.text}
                    </Text>
                </Flex>
            );
        case "tool": {
            const query = toolArgsSummary(row.args);
            const failed = row.status === "ERR";

            // Tool failure — the assistant-ui tool-error element.
            if (failed) {
                let msg = row.result || "Tool call failed";
                if (msg.startsWith(`"`)) {
                    try {
                        msg = JSON.parse(msg) as string;
                    } catch {
                        // keep the raw text
                    }
                }
                if (msg.startsWith("{")) {
                    try {
                        const e = JSON.parse(msg) as Record<string, unknown>;
                        msg = String(e.error ?? e.message ?? msg);
                    } catch {
                        // keep the raw text
                    }
                }
                return (
                    <Box py={1} minW={0}>
                        <ToolError
                            name={row.name}
                            target={query || "—"}
                            message={msg.length > 300 ? `${msg.slice(0, 300)}…` : msg}
                            attempt={1}
                            maxAttempts={1}
                            retrying={false}
                            className="max-w-none"
                        />
                    </Box>
                );
            }

            const chip = query
                ? `${query}${row.status !== "running" && typeof row.duration_ms === "number" ? `  ·  ${(row.duration_ms / 1000).toFixed(1)}s` : ""}`
                : "";

            // Web search / news — the assistant-ui web-search element.
            // A search that came back empty is a degraded search: the tool's own
            // message (SearXNG down, no stories in window) renders as a ToolError
            // instead of a bare "no sources found".
            const ws = SEARCHY.test(row.name) ? webSearchData(row.args, row.result) : null;
            if (ws) {
                if (ws.emptyMessage) {
                    return (
                        <Box py={1} minW={0}>
                            <ToolError
                                name={row.name}
                                target={ws.query}
                                message={ws.emptyMessage.length > 300 ? `${ws.emptyMessage.slice(0, 300)}…` : ws.emptyMessage}
                                attempt={1}
                                maxAttempts={1}
                                retrying={false}
                                className="max-w-none"
                            />
                        </Box>
                    );
                }
                return (
                    <Box py={1} minW={0}>
                        <WebSearch
                            query={ws.query}
                            results={ws.results}
                            visibleResults={5}
                            searching={row.status === "running"}
                            cycle={index}
                            className="max-w-none"
                        />
                    </Box>
                );
            }

            return (
                <Box py={1} minW={0}>
                    <ToolCall
                        className="max-w-none"
                        label={row.name}
                        activeLabel={row.name}
                        query={chip}
                        request={row.args != null ? JSON.stringify(row.args, null, 2) : ""}
                        result={row.status === "running" ? "" : resultForPanel(row.result)}
                        running={row.status === "running"}
                        failed={failed}
                        open={!!openRows[index]}
                        onOpenChange={(o) => setOpenRows((p) => ({ ...p, [index]: o }))}
                    />
                </Box>
            );
        }
        case "decision":
            return (
                <Flex align="center" gap={2} py={0.5}>
                    <Text fontSize="11px" fontWeight={600} fontFamily="var(--font-mono)" color="var(--ink-primary)">
                        Decision
                    </Text>
                    {row.score != null && (
                        <Text fontSize="11px" fontFamily="var(--font-tabular)" color="var(--ink-primary)">
                            {Number(row.score).toFixed(1)}
                        </Text>
                    )}
                    {row.text && <Text fontSize="11px" color="var(--signal-caution)">{row.text}</Text>}
                </Flex>
            );
        default:
            return (
                <Text fontSize="10.5px" color="var(--ink-tertiary)" py={0.5}>
                    {row.text}
                </Text>
            );
    }
}

/* ─── Component ────────────────────────────────────────────────────────── */

export interface AgentStep {
    key?: string;
    label?: string;
    status?: string;
    duration_ms?: number;
}

interface AgentActivityProps {
    title?: string;
    /** "panel" = boxed header+list (builder). "plain" = avatar-per-statement feed. */
    variant?: "panel" | "plain";
    subtitle?: string;
    /** Agent identity — renders the agent's chip in the header. */
    agent?: AgentSeedLike | string;
    /** SSE endpoint (relative to API_BASE) for live events. */
    streamUrl?: string;
    /** Static trace events (used when not streaming). */
    events?: TraceEvent[];
    steps?: AgentStep[];
    /** Epoch (ms) the work started — drives the running timer. */
    startedAt?: number;
    active?: boolean;
    /** Max height of the scrollable activity list (px). Default 252. */
    maxHeight?: number;
}

export default function AgentActivity({
    title,
    subtitle,
    variant = "panel",
    agent,
    streamUrl,
    events,
    steps = [],
    startedAt,
    active,
    maxHeight = 252,
}: AgentActivityProps) {
    const [live, setLive] = useState<TraceEvent[]>([]);
    const [elapsed, setElapsed] = useState(0);
    const [tick, setTick] = useState(0);
    const [openRows, setOpenRows] = useState<Record<number, boolean>>({});
    const scroller = useRef<HTMLDivElement>(null);
    const startRef = useRef(0);

    const onEvent = useCallback((ev: TraceEvent) => {
        setLive((prev) => [...prev, ev]);
    }, []);
    const connected = useSseTrace(streamUrl, onEvent);
    useEffect(() => {
        if (!active || !startedAt) return;
        // Epoch is the RUN's start, not the moment this component mounted —
        // otherwise a mid-run mount shows a timer stuck at 00:00.
        startRef.current = startedAt;
        const tickTimer = () => setElapsed(Math.max(0, Math.floor((Date.now() - startRef.current) / 1000)));
        tickTimer();
        const interval = setInterval(tickTimer, 1000);
        return () => clearInterval(interval);
    }, [active, startedAt]);

    // Drives the assistant-ui Loader pixel matrix while the run is live.
    useEffect(() => {
        if (!active) return;
        const interval = setInterval(() => setTick((t) => t + 1), 400);
        return () => clearInterval(interval);
    }, [active]);

    const all = useMemo(() => (streamUrl ? live : events ?? []), [streamUrl, live, events]);
    const rows = useMemo(() => buildRows(steps, all), [steps, all]);

    // The agent's plan — the latest write_todos call in the trace, rendered as
    // the assistant-ui agent-plan element (steps + progress, no spinner noise).
    const plan = useMemo<{ steps: string[]; activeIndex: number } | null>(() => {
        for (let i = rows.length - 1; i >= 0; i--) {
            const r = rows[i];
            if (r.kind === "tool" && r.name === "write_todos") {
                const list = (r.args as { todos?: unknown })?.todos;
                if (Array.isArray(list) && list.length) {
                    const steps = list.map((t: any) => String(t?.content ?? "")).filter(Boolean);
                    const firstOpen = list.findIndex((t: any) => t?.status !== "completed");
                    // A finished run can't advance any further — render the last
                    // known plan as done instead of an eternal spinner on the
                    // first open item (models often write the plan once and
                    // never update it).
                    const activeIndex = !active || firstOpen === -1 ? steps.length : Math.max(0, firstOpen);
                    return { steps, activeIndex };
                }
            }
        }
        return null;
    }, [rows, active]);

    useEffect(() => {
        if (active && scroller.current) {
            scroller.current.scrollTop = scroller.current.scrollHeight;
        }
    }, [rows.length, active]);

    // The loader label while live — one assistant-ui Loader, nothing else spins.
    const liveLabel = connected ? "Working…" : "Warming up…";

    if (variant === "plain") {
        const feed = rows.filter((r) => statementFor(r));
        return (
            <Box display="flex" flexDirection="column" gap={2.5} minW={0}>
                {title && (
                    <Text fontSize={{ base: "24px", md: "28px" }} fontWeight={200} color="var(--ink-primary)" letterSpacing="-0.015em" lineHeight={1.15} mb={1.5}>
                        {title}
                    </Text>
                )}
                {feed.map((row, i) => {
                    return (
                        <Flex key={i} align="flex-start" gap={2.5} minW={0}>
                            <Flex flexShrink={0} align="center" mt="2px">
                                <AgentAvatar agent={agent} size={20} />
                            </Flex>
                            <FadeLine fontSize="14px" lineHeight="1.65" color="var(--ink-secondary)" minW={0}>
                                {statementFor(row)}
                            </FadeLine>
                        </Flex>
                    );
                })}
                {feed.length === 0 && (
                    <Flex align="center" gap={2.5}>
                        <AgentAvatar agent={agent} size={20} />
                        <Text fontSize="13px" color="var(--ink-tertiary)">
                            {connected ? "Starting…" : "Connecting…"}
                        </Text>
                    </Flex>
                )}
            </Box>
        );
    }

    // The agent's name — the homepage-card identity line.
    const agentName = typeof agent === "string" ? agent : (agent as { name?: string } | null | undefined)?.name;

    return (
        <Flex
            align="flex-start"
            gap={{ base: 8, md: 16 }}
            minW={0}
            flexDirection={{ base: "column", md: "row" }}
        >
            {/* Left column — the agent identity (homepage-card layout) with the
                plan under it, exactly where they render today. */}
            <Box flexShrink={0} w={{ base: "full", md: "320px" }} minW={0}>
                <Flex align="center" gap={3} minW={0}>
                    <AgentAvatar agent={agent} size={112} label={agentName} />
                    <Flex direction="column" minW={0} gap={1.5}>
                        <Text fontSize="16px" fontWeight={300} lineHeight="1.2" color="var(--ink-primary)" truncate>
                            {agentName || title}
                        </Text>
                        {title && agentName && title !== agentName && (
                            <Text fontSize="12px" color="var(--ink-secondary)" truncate>
                                {title}
                            </Text>
                        )}
                        {subtitle && (
                            <Text fontSize="12px" color="var(--ink-tertiary)" truncate>
                                {subtitle}
                            </Text>
                        )}
                        {active ? (
                            <Flex align="center" gap={2.5} pt={0.5}>
                                <GenerationLoader label={liveLabel} tick={tick} className="flex-row items-center gap-2" />
                                <Text fontSize="12px" fontFamily="var(--font-tabular)" fontVariantNumeric="tabular-nums" color="var(--ink-tertiary)" whiteSpace="nowrap">
                                    {mmss(elapsed)}
                                </Text>
                            </Flex>
                        ) : rows.length > 0 ? (
                            <Text fontSize="12px" color="var(--ink-tertiary)">
                                Finished
                            </Text>
                        ) : null}
                    </Flex>
                </Flex>

                {/* The agent's plan — the assistant-ui agent-plan element */}
                {plan && plan.steps.length > 0 && (
                    <Box pt={4}>
                        <AgentPlan title="Plan" steps={plan.steps} activeIndex={plan.activeIndex} />
                    </Box>
                )}
            </Box>

            {/* Right column — the reasoning feed in the scheduled-runs box
                chrome (transparent panel, light hairline border). */}
            <Box
                flex={1}
                minW={0}
                className="rounded-xl border-[0.5px] border-[color:var(--hairline)] p-5"
            >
                <Flex align="center" gap={3}>
                    <Text className="min-w-0 font-app-body text-[20px] leading-none font-light tracking-tight text-console-ink">
                        Reasoning
                    </Text>
                    {active && (
                        <Text fontSize="12px" fontFamily="var(--font-tabular)" fontVariantNumeric="tabular-nums" color="var(--ink-tertiary)" flexShrink={0} whiteSpace="nowrap">
                            {mmss(elapsed)}
                        </Text>
                    )}
                </Flex>
                <Box ref={scroller} maxH={`${maxHeight}px`} overflowY="auto" className="mt-3">
                    {rows.map((row, i) => (
                        <Row key={`${row.kind}-${i}`} row={row} index={i} openRows={openRows} setOpenRows={setOpenRows} />
                    ))}
                    {rows.length === 0 && !active && (
                        <Text fontSize="12px" color="var(--ink-tertiary)" py={2}>
                            No activity recorded.
                        </Text>
                    )}
                    {rows.length === 0 && active && (
                        <GenerationLoader label={liveLabel} tick={tick} className="py-2" />
                    )}
                </Box>
            </Box>
        </Flex>
    );
}
