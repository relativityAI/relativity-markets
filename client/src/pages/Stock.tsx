import { useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useColorMode } from "@/components/ui/color-mode";
import { AnalysisService } from "@/db";
import { verdictInk } from "@/lib/analysisFormat";
import PluginAvatar from "@/components/shared/PluginAvatar";

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

/**
 * One TradingView embed. The script reads its own text as config and React
 * never executes injected <script>s, so build it imperatively — same
 * StrictMode guard as the homepage heatmap (the embed crashes if detached
 * before it runs).
 */
function TvWidget({ src, config, className }: { src: string; config: Record<string, unknown>; className?: string }) {
    const boxRef = useRef<HTMLDivElement>(null);
    const pendingRef = useRef<HTMLScriptElement | null>(null);
    const { colorMode } = useColorMode();
    const cfg = JSON.stringify(config);

    useEffect(() => {
        const box = boxRef.current;
        if (!box) return;
        let dead = false;
        const inject = () => {
            if (dead) return;
            box.replaceChildren();
            const holder = document.createElement("div");
            holder.className = "tradingview-widget-container__widget";
            holder.style.height = "100%";
            const script = document.createElement("script");
            script.type = "text/javascript";
            script.async = true;
            script.src = src;
            script.textContent = JSON.stringify({
                locale: "en",
                colorTheme: colorMode === "dark" ? "dark" : "light",
                isTransparent: false,
                width: "100%",
                height: "100%",
                ...JSON.parse(cfg),
            });
            pendingRef.current = script;
            const settled = () => { if (pendingRef.current === script) pendingRef.current = null; };
            script.addEventListener("load", settled, { once: true });
            script.addEventListener("error", settled, { once: true });
            box.append(holder, script);
        };
        const pending = pendingRef.current;
        if (pending) {
            pending.addEventListener("load", inject, { once: true });
            pending.addEventListener("error", inject, { once: true });
        } else {
            inject();
        }
        return () => { dead = true; };
    }, [src, cfg, colorMode]);

    return (
        <div className={`overflow-hidden bg-[var(--surface-canvas)] ${className ?? ""}`}>
            <div ref={boxRef} className="tradingview-widget-container h-full w-full" />
        </div>
    );
}

const EMBED = (name: string) => `https://s3.tradingview.com/external-embedding/embed-widget-${name}.js`;

export default function Stock() {
    const { symbol = "" } = useParams();
    const [params] = useSearchParams();
    const source = params.get("source") || "";

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

    // Latest real run per agent for this ticker, newest first.
    const agentRuns = (runs?.key === `${symbol}|${source}` ? runs.rows : [])
        .filter((r) => r.symbol === symbol
            && (!source || !r.source || String(r.source).toUpperCase() === source.toUpperCase()))
        .sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));
    const seenAgents = new Set<string>();
    const visibleRuns = agentRuns.filter((r) => {
        const name = r.agent_name || r.agent || "Plugin";
        if (seenAgents.has(name)) return false;
        seenAgents.add(name);
        return true;
    });

    // TradingView symbol. US sources stay bare (no US: prefix exists);
    // NSE/BSE get their exchange prefix.
    const src = source.toUpperCase();
    const detailSym = src === "NSE" || src === "BSE" ? `${src}:${symbol}` : symbol;
    // ponytail: TradingView doesn't license NSE chart data to widgets (the
    // "only available on TradingView" ghost) — BSE mirrors the same companies.
    // Ceiling: NSE-only listings get no chart; flip to NSE if TV opens rights.
    const chartSym = src === "NSE" ? `BSE:${symbol}` : detailSym;
    // The chart paints its own card bg (a navy that shows against the dark
    // canvas); point it at our canvas token so it matches in both themes —
    // same trick the widget docs use (their dark default is #0f0f0f, their
    // page's own color).
    const canvas = getComputedStyle(document.documentElement).getPropertyValue("--surface-canvas").trim();

    return (
        <div className="min-h-full bg-[var(--surface-canvas)] pb-16 text-[var(--ink-primary)]">
            <section className="pt-10">
                <h1 className="sr-only">{symbol}</h1>
                <div className="flex flex-col gap-10 lg:grid lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:gap-12">
                    <div className="flex min-w-0 flex-col gap-3">
                        <TvWidget
                            src={EMBED("symbol-overview")}
                            config={{
                                symbols: [[symbol, `${chartSym}|1D`]],
                                chartOnly: false,
                                autosize: true,
                                // OHLC card follows the cursor — off ("0") by
                                // default in this widget.
                                valuesTracking: "1",
                                // Widget panel = our canvas color in both
                                // themes (docs trick: their dark default is
                                // #0f0f0f, their page's own color). NOT
                                // isTransparent — that flag makes this widget
                                // render light-on-dark broken.
                                backgroundColor: canvas || undefined,
                                // Range buttons: 1D 1W 1M 3M 6M 1Y 5Y All.
                                // Daily pipes so EOD-only symbols (BSE) get
                                // the short ranges too — intraday intervals
                                // (docs' 1m|30) hide them on EOD data.
                                dateRanges: ["1d|1", "1w|1D", "1m|1D", "3m|1D", "6m|1D", "12m|1D", "60m|1W", "all|1M"],
                            }}
                            className="h-[420px]"
                        />
                        <TvWidget
                            src={EMBED("financials")}
                            config={{ symbol: detailSym }}
                            className="h-[440px]"
                        />
                        <TvWidget
                            src={EMBED("symbol-profile")}
                            config={{ symbol: detailSym }}
                            className="h-[340px]"
                        />
                    </div>

                    {/* Right: only real runs from the analysis DB, stacked. */}
                    <aside className="order-first w-full min-w-0 lg:order-none">
                        <div className="flex items-end justify-between gap-4">
                            <div>
                                <h2 className="font-[family-name:var(--font-body)] text-[clamp(1.75rem,3vw,2.5rem)] leading-tight font-light text-[var(--ink-primary)]">
                                    Agent Runs
                                </h2>
                            </div>
                            <Link
                                to={`/runs?q=${encodeURIComponent(symbol)}`}
                                className="font-[family-name:var(--font-body)] text-xs font-normal whitespace-nowrap text-[#4A6E8E] underline-offset-2 transition-colors hover:text-[var(--ink-primary)] hover:underline cursor-pointer"
                            >
                                View all runs
                            </Link>
                        </div>

                        <div className="mt-4 flex flex-col gap-3">
                            {visibleRuns.length === 0 ? (
                                <p className="font-[family-name:var(--font-body)] text-[13px] font-light text-[var(--ink-tertiary)]">
                                    {runs == null ? "" : `No runs for ${symbol} yet.`}
                                </p>
                            ) : visibleRuns.map((r) => {
                                const agent = r.agent_name || r.agent || "Plugin";
                                const verdict = r.verdict || r.status || "Run";
                                const runId = r.id || r.analysis_id;
                                return (
                                    <Link
                                        key={runId || agent}
                                        to={runId ? `/runs/${runId}` : "/runs"}
                                        data-solid=""
                                        className="agent-cell flex items-center gap-3 p-4 focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-primary)]"
                                    >
                                        <span className="agent-cell-body flex min-w-0 flex-1 items-center gap-4">
                                            <PluginAvatar plugin={agent} size={64} />
                                            <span className="min-w-0 flex-1">
                                                <span className="flex items-baseline gap-3">
                                                    <span className="min-w-0 truncate font-[family-name:var(--font-display)] text-[24px] leading-tight font-normal text-[var(--ink-primary)]">{agent}</span>
                                                    <span className="ml-auto shrink-0 font-[family-name:var(--font-display)] text-[34px] leading-none font-medium" style={{ color: verdictInk(verdict) ?? "var(--ink-secondary)" }}>
                                                        {verdict}
                                                    </span>
                                                </span>
                                                <span className="mt-1 block font-[family-name:var(--font-body)] text-[12px] font-normal text-[var(--ink-tertiary)]">{timeAgo(r.created_at)}</span>
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
