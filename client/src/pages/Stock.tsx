import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { Center, Spinner } from "@chakra-ui/react";
import { useColorMode } from "@/components/ui/color-mode";
import { API_BASE, AnalysisService } from "@/db";
import { TickerLogo } from "@/lib/sourceLogos";
import Echart from "@/components/shared/Echart";
import { AgentAvatar } from "@/components/shared/AgentCell";
import { resolvedTheme, tooltipStyle } from "@/lib/echarts";

interface Overview {
    symbol: string;
    name: string;
    price: number | null;
    change: number | null;
    change_pct: number | null;
    currency: string;
    market_cap: number | null;
    pe: number | null;
    prev_close: number | null;
    volume: number | null;
    fifty_two_week_high: number | null;
    fifty_two_week_low: number | null;
    exchange: string;
    ltp_time: string | null;
    period: string;
    candles: { date: string; close: number }[];
}

const fmt = (n: number | null | undefined, currency?: string, compact = false) =>
    n == null || !Number.isFinite(n)
        ? "—"
        : new Intl.NumberFormat(
              currency === "INR" ? "en-IN" : "en-US",
              compact ? { notation: "compact", maximumFractionDigits: 2 } : { maximumFractionDigits: 2 },
          ).format(n);

/** Price with its currency symbol (₹1,324 / $342.37). */
const fmtPrice = (n: number | null | undefined, currency?: string) => {
    if (n == null || !Number.isFinite(n)) return "—";
    if (!currency) return fmt(n, currency);
    try {
        return new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", {
            style: "currency",
            currency,
            currencyDisplay: "narrowSymbol",
            minimumFractionDigits: 0,
            maximumFractionDigits: 2,
        }).format(n);
    } catch {
        return fmt(n, currency);
    }
};

function timeAgo(dateStr?: string): string {
    if (!dateStr) return "";
    const mins = Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 30) return `${days}d ago`;
    return new Date(dateStr).toLocaleDateString();
}

/** Verdict word → app signal ink (the same bands the rest of the app uses). */
function verdictColor(verdict?: string): string {
    const v = String(verdict || "").toLowerCase();
    if (["excellent", "good", "strong", "outstanding", "shortlist", "buy"].includes(v)) return "var(--signal-positive)";
    if (["fair", "watch", "hold", "neutral", "underwhelming"].includes(v)) return "var(--signal-caution)";
    if (["very poor", "poor", "subpar", "pass", "error", "sell"].includes(v)) return "var(--signal-negative)";
    return "var(--ink-secondary)";
}

export default function Stock() {
    const { symbol = "" } = useParams();
    const [params] = useSearchParams();
    const source = params.get("source") || "";
    const { colorMode } = useColorMode();
    const t = resolvedTheme(colorMode === "dark");

    const [state, setState] = useState<{ key: string; data: Overview | null; err: string } | null>(null);
    const [runs, setRuns] = useState<{ key: string; rows: any[] } | null>(null);

    // Only saved runs in the analysis DB are shown here — nothing is seeded.
    useEffect(() => {
        let alive = true;
        const key = `${symbol}|${source}`;
        AnalysisService.listAnalyses()
            .then((rows) => { if (alive) setRuns({ key, rows: Array.isArray(rows) ? rows : [] }); })
            .catch(() => { if (alive) setRuns({ key, rows: [] }); });
        return () => { alive = false; };
    }, [symbol, source]);

    useEffect(() => {
        const controller = new AbortController();
        const key = `${symbol}|${source}`;
        const qs = new URLSearchParams({ period: "1y" });
        if (source) qs.set("source", source);
        fetch(`${API_BASE}/stocks/${encodeURIComponent(symbol)}/overview?${qs}`, { signal: controller.signal })
            .then((r) => {
                if (!r.ok) throw new Error("bad status");
                return r.json();
            })
            .then((d: Overview) => {
                if (!controller.signal.aborted) setState({ key, data: d, err: "" });
            })
            .catch((e: unknown) => {
                if (e instanceof DOMException && e.name === "AbortError") return;
                if (!controller.signal.aborted) setState({ key, data: null, err: "Couldn't load this stock." });
            });
        return () => controller.abort();
    }, [symbol, source]);

    // A previous symbol's state must never render under the new URL.
    const view = state && state.key === `${symbol}|${source}` ? state : null;
    if (view?.err) {
        return (
            <div className="min-h-full bg-[var(--surface-canvas)] py-24 text-center font-[family-name:var(--font-body)] text-sm text-[var(--ink-tertiary)]">
                {view.err}
            </div>
        );
    }
    if (!view?.data) {
        return (
            <div className="min-h-full bg-[var(--surface-canvas)]">
                <Center minH="50vh">
                    <Spinner size="lg" />
                </Center>
            </div>
        );
    }

    const d = view.data;
    const up = (d.change ?? 0) >= 0;
    const changeColor = up ? "var(--signal-positive)" : "var(--signal-negative)";
    const sign = up ? "+" : "−";
    const ltp = d.ltp_time ? new Date(d.ltp_time) : null;
    const ltpLabel = ltp
        ? ltp.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
        : "—";

    const stats = [
        { label: "Market cap", value: fmt(d.market_cap, d.currency, true) },
        { label: "P/E", value: fmt(d.pe, d.currency) },
        { label: "Prev close", value: fmt(d.prev_close, d.currency) },
        { label: "52W high", value: fmt(d.fifty_two_week_high, d.currency) },
        { label: "52W low", value: fmt(d.fifty_two_week_low, d.currency) },
        { label: "Volume", value: fmt(d.volume, d.currency, true) },
    ];

    // Latest real run per agent for this ticker, newest first.
    const agentRuns = (runs?.key === `${symbol}|${source}` ? runs.rows : [])
        .filter((r) => r.symbol === symbol
            && (!source || !r.source || String(r.source).toUpperCase() === source.toUpperCase()))
        .sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));
    const seenAgents = new Set<string>();
    const visibleRuns = agentRuns.filter((r) => {
        const name = r.agent_name || r.agent || "Agent";
        if (seenAgents.has(name)) return false;
        seenAgents.add(name);
        return true;
    });

    return (
        <div className="min-h-full bg-[var(--surface-canvas)] pb-16 text-[var(--ink-primary)]">
            <section className="pt-10">
                {/* Desktop: title + price + metadata + chart on the left, real
                    agent runs stacked on the right. Phones: one column. */}
                <div className="flex flex-col gap-10 lg:grid lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:gap-12">
                    <div className="min-w-0">
                        <div className="flex items-center gap-4">
                            <TickerLogo symbol={symbol} size={88} />
                            <div className="min-w-0">
                                <h1 className="font-[family-name:var(--font-body)] text-[clamp(1.75rem,3vw,2.5rem)] leading-tight font-light text-[var(--ink-primary)]">
                                    {d.name || symbol}
                                </h1>
                                <p className="mt-1 font-[family-name:var(--font-body)] text-sm font-light text-[var(--ink-tertiary)]">
                                    {symbol}
                                    {d.exchange ? ` · ${d.exchange}` : ""}
                                </p>
                            </div>
                        </div>

                        <div className="mt-8 flex flex-wrap items-baseline gap-x-4 gap-y-1">
                            <span className="font-[family-name:var(--font-display)] text-[clamp(2rem,4vw,3rem)] leading-none font-normal text-[var(--ink-primary)]">
                                {fmtPrice(d.price, d.currency)}
                            </span>
                            <span className="font-[family-name:var(--font-body)] text-sm font-normal" style={{ color: changeColor }}>
                                {sign}
                                {fmt(Math.abs(d.change ?? 0), d.currency)} ({sign}
                                {Math.abs(d.change_pct ?? 0).toFixed(2)}%)
                            </span>
                            <span className="font-[family-name:var(--font-body)] text-xs font-light text-[var(--ink-tertiary)]">{d.currency}</span>
                        </div>
                        <p className="mt-2 font-[family-name:var(--font-body)] text-xs font-light text-[var(--ink-tertiary)]">
                            LTP · {fmtPrice(d.price, d.currency)} · {ltpLabel}
                        </p>

                        <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
                            {stats.map((s) => (
                                <div key={s.label}>
                                    <dt className="font-[family-name:var(--font-body)] text-[11px] font-light tracking-wide text-[var(--ink-tertiary)] uppercase">
                                        {s.label}
                                    </dt>
                                    <dd className="mt-0.5 font-[family-name:var(--font-body)] text-[15px] font-normal text-[var(--ink-primary)]">
                                        {s.value}
                                    </dd>
                                </div>
                            ))}
                        </dl>

                        {/* Hoverable SVG chart of the last year */}
                        {d.candles.length > 1 && (
                            <div className="mt-8">
                                <p className="mb-2 font-[family-name:var(--font-body)] text-xs font-light tracking-wide text-[var(--ink-tertiary)] uppercase">
                                    Close · last {d.period}
                                </p>
                                <Echart
                                    height={260}
                                    ariaLabel={`Close price for ${symbol} over the last ${d.period}`}
                                    option={{
                                        grid: { left: 8, right: 12, top: 18, bottom: 28 },
                                        xAxis: {
                                            type: "category",
                                            data: d.candles.map((c) => c.date),
                                            boundaryGap: false,
                                            axisLine: { lineStyle: { color: t.hairline } },
                                            axisTick: { show: false },
                                            axisLabel: { color: t.ink.tertiary, fontSize: 11, margin: 10 },
                                        },
                                        yAxis: {
                                            type: "value",
                                            scale: true,
                                            splitLine: { lineStyle: { color: t.hairline, opacity: 0.6 } },
                                            axisLabel: { color: t.ink.tertiary, fontSize: 11 },
                                        },
                                        tooltip: {
                                            ...tooltipStyle(t),
                                            trigger: "axis",
                                            axisPointer: { type: "line", lineStyle: { color: t.hairline } },
                                            formatter: (params: unknown) => {
                                                const p = (
                                                    Array.isArray(params) ? params[0] : params
                                                ) as { axisValue: string; value: number };
                                                return `${p.axisValue} &nbsp; <b>${fmtPrice(p.value, d.currency)}</b>`;
                                            },
                                        },
                                        series: [
                                            {
                                                type: "line",
                                                data: d.candles.map((c) => c.close),
                                                showSymbol: false,
                                                lineStyle: { width: 1.5, color: t.chart[2] },
                                                areaStyle: { color: t.chart[2], opacity: 0.08 },
                                            },
                                        ],
                                    }}
                                />
                            </div>
                        )}
                    </div>

                    {/* Right: only real runs from the analysis DB, stacked. */}
                    <aside className="min-w-0 w-full">
                        <div className="flex items-end justify-between gap-4">
                            <div>
                                <h2 className="font-[family-name:var(--font-display)] text-[clamp(1.5rem,2.5vw,2rem)] leading-tight font-normal text-[var(--ink-primary)]">
                                    Agent Runs
                                </h2>
                                <p className="mt-1 font-[family-name:var(--font-body)] text-xs font-light text-[var(--ink-tertiary)]">
                                    Saved runs for {symbol}.
                                </p>
                            </div>
                            <Link
                                to={`/analysis-list?q=${encodeURIComponent(symbol)}`}
                                className="font-[family-name:var(--font-body)] text-xs font-normal whitespace-nowrap text-[#4A6E8E] underline-offset-2 transition-colors hover:text-[var(--ink-primary)] hover:underline cursor-pointer"
                            >
                                View all runs
                            </Link>
                        </div>

                        <div className="mt-4 flex flex-col gap-3">
                            {visibleRuns.length === 0 ? (
                                <p className="font-[family-name:var(--font-body)] text-[13px] font-light text-[var(--ink-tertiary)]">
                                    No agent runs for {symbol} yet.
                                </p>
                            ) : visibleRuns.map((r) => {
                                const agent = r.agent_name || r.agent || "Agent";
                                const verdict = r.verdict || r.status || "Run";
                                const runId = r.id || r.analysis_id;
                                return (
                                    <Link
                                        key={runId || agent}
                                        to={runId ? `/analysis-result/${runId}` : "/analysis-list"}
                                        data-solid=""
                                        className="agent-cell flex items-center gap-3 p-3 focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-primary)]"
                                    >
                                        <span className="agent-cell-body flex min-w-0 flex-1 items-center gap-3">
                                            <AgentAvatar seed={agent} size={44} />
                                            <span className="min-w-0 flex-1">
                                                <span className="flex items-baseline justify-between gap-2">
                                                    <span className="truncate font-[family-name:var(--font-display)] text-[17px] leading-snug font-normal text-[var(--ink-primary)]">{agent}</span>
                                                    <span className="shrink-0 font-[family-name:var(--font-body)] text-[11px] font-normal text-[var(--ink-tertiary)]">{timeAgo(r.created_at)}</span>
                                                </span>
                                                <span className="mt-1 block font-[family-name:var(--font-body)] text-[12px] font-medium" style={{ color: verdictColor(verdict) }}>
                                                    {verdict}
                                                </span>
                                            </span>
                                        </span>
                                        <span className="agent-cell-cue font-[family-name:var(--font-body)] text-xs font-normal text-[#4A6E8E]">
                                            Open
                                            <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                                <path d="M3 9L9 3" />
                                                <path d="M4.5 3H9v4.5" />
                                            </svg>
                                        </span>
                                    </Link>
                                );
                            })}
                        </div>
                    </aside>
                </div>
            </section>
        </div>
    );
}
