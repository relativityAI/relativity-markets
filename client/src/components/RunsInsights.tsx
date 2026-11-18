import { useMemo, useState, type ReactNode } from "react";
import { Activity, ChevronDown } from "lucide-react";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuLabel,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TickerLogo } from "@/lib/sourceLogos";
import { ModelLogo } from "@/lib/modelLogos";
import AgentAvatar from "@/components/shared/AgentAvatar";
import { runVerdict } from "@/lib/analysisFormat";
import { cn } from "@/lib/utils";

/**
 * Runs insights — GitHub Insights' information layout (title → number →
 * hand-rolled SVG chart) flattened to the house style: no card boxes, no
 * borders, no bold — whitespace and type size do the separating.
 * Scoped by Period; the runs table keeps its own filters.
 */

const PERIODS = [
    { key: "7", label: "1 week" },
    { key: "14", label: "2 weeks" },
    { key: "30", label: "1 month" },
    { key: "all", label: "All time" },
];

const dayFmt = (d: Date) => d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
const dayKey = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const fmtDur = (s: number) => (s >= 60 ? `${Math.floor(s / 60)}m ${Math.round(s % 60)}s` : `${Math.round(s)}s`);
const isDone = (s: string) => s === "complete" || s === "completed" || s === "success";
const isFailed = (s: string) => s === "failed" || s === "error";
/** Same 70/40 bands the runs table uses. */
const tone = (score: number) => (score >= 70 ? "var(--gh-green)" : score >= 40 ? "var(--gh-amber)" : "var(--gh-red)");

export default function RunsInsights({
    runs,
    labelAgent,
}: {
    runs: any[];
    /** Resolve a run's raw agent id to a display name (page owns the lookup). */
    labelAgent: (a: any) => string;
}) {
    const [period, setPeriod] = useState("7");

    const inPeriod = useMemo(() => {
        if (period === "all") return runs;
        const cutoff = Date.now() - Number(period) * 86400000;
        return runs.filter((a) => a.created_at && +new Date(a.created_at) >= cutoff);
    }, [runs, period]);

    // Calendar days covered by the selection, oldest → newest (capped so an
    // all-time span with an ancient row can't build a huge axis).
    const days = useMemo(() => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        let start: Date;
        if (period === "all") {
            const ts = inPeriod.map((a) => +new Date(a.created_at || 0)).filter((t) => t > 0);
            start = ts.length ? new Date(Math.min(...ts)) : new Date(today);
            start.setHours(0, 0, 0, 0);
        } else {
            start = new Date(today.getTime() - (Number(period) - 1) * 86400000);
        }
        const out: Date[] = [];
        for (let d = start; d <= today && out.length < 366; d = new Date(d.getTime() + 86400000)) {
            out.push(new Date(d));
        }
        return out;
    }, [inPeriod, period]);

    const total = inPeriod.length;
    const failed = inPeriod.filter((a) => isFailed(String(a.status || "").toLowerCase())).length;
    const done = inPeriod.filter((a) => isDone(String(a.status || "").toLowerCase())).length;
    const running = total - done - failed;

    const verdictCounts = useMemo(() => {
        const c = { good: 0, caution: 0, bad: 0 };
        inPeriod.forEach((a) => {
            const v = runVerdict(a);
            if (v && v.tone !== "neutral") c[v.tone] += 1;
        });
        return c;
    }, [inPeriod]);

    const scores = useMemo(
        () => inPeriod.map((a) => a.total_score).filter((s: any) => typeof s === "number" && Number.isFinite(s)),
        [inPeriod]
    );
    const avgScore = scores.length ? Math.round(scores.reduce((s: number, x: number) => s + x, 0) / scores.length) : null;

    const medianDur = useMemo(() => {
        const ds = inPeriod
            .map((a) => a.duration)
            .filter((d: any) => typeof d === "number" && d >= 0)
            .sort((x: number, y: number) => x - y);
        if (!ds.length) return null;
        const m = Math.floor(ds.length / 2);
        return ds.length % 2 ? ds[m] : Math.round((ds[m - 1] + ds[m]) / 2);
    }, [inPeriod]);

    const stockCount = useMemo(
        () => new Set(inPeriod.map((a) => a.symbol || a.share_name).filter(Boolean)).size,
        [inPeriod]
    );

    // Runs per calendar day for the column chart.
    const perDay = useMemo(() => {
        const m = new Map<string, number>();
        inPeriod.forEach((a) => {
            if (!a.created_at) return;
            const k = dayKey(new Date(a.created_at));
            m.set(k, (m.get(k) || 0) + 1);
        });
        return m;
    }, [inPeriod]);

    const topStocks = useMemo(() => {
        const m = new Map<string, { label: string; symbol: string; count: number; scores: number[] }>();
        inPeriod.forEach((a) => {
            const label = String(a.share_name || a.symbol || "").trim();
            if (!label) return;
            const e = m.get(label) ?? { label, symbol: "", count: 0, scores: [] };
            e.count += 1;
            if (!e.symbol) e.symbol = String(a.symbol || "").trim();
            if (typeof a.total_score === "number") e.scores.push(a.total_score);
            m.set(label, e);
        });
        return Array.from(m.values()).sort((a, b) => b.count - a.count).slice(0, 5);
    }, [inPeriod]);

    const topAgents = useMemo(() => {
        const m = new Map<string, { name: string; seed: any; count: number; scores: number[]; last: number }>();
        inPeriod.forEach((a) => {
            const name = labelAgent(a);
            if (!name || name === "—") return;
            const e =
                m.get(name) ?? { name, seed: a.agent_name || a.agent || a.system_prompt, count: 0, scores: [], last: 0 };
            e.count += 1;
            if (typeof a.total_score === "number") e.scores.push(a.total_score);
            e.last = Math.max(e.last, a.created_at ? +new Date(a.created_at) : 0);
            m.set(name, e);
        });
        return Array.from(m.values()).sort((a, b) => b.count - a.count).slice(0, 5);
    }, [inPeriod, labelAgent]);

    const topModels = useMemo(() => {
        const m = new Map<string, number>();
        inPeriod.forEach((a) => m.set(a.model || "unknown", (m.get(a.model || "unknown") || 0) + 1));
        return Array.from(m.entries())
            .map(([model, count]) => ({ model, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 5);
    }, [inPeriod]);

    const range = days.length > 0 ? `${dayFmt(days[0])} – ${dayFmt(days[days.length - 1])}` : "";
    const empty = total === 0;

    return (
        <section className="flex flex-col gap-5">
            <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
                <div className="flex min-w-0 flex-wrap items-baseline gap-x-3">
                    <h2 className="text-[22px] leading-tight font-light text-[var(--gh-fg)]">Runs insights</h2>
                    {range && <span className="text-[14px] text-[var(--gh-muted)]">{range}</span>}
                </div>
                <PeriodMenu value={period} onChange={setPeriod} />
            </div>

            {/* Overview — two count-strips + one summary line, no stat boxes */}
            <div className="flex flex-col gap-3">
                <h3 className="text-[17px] leading-none font-light text-[var(--gh-fg)]">Overview</h3>
                {empty ? (
                    <InsightEmpty />
                ) : (
                    <div className="flex flex-col gap-2.5">
                        <BarLine
                            parts={[
                                { name: "Completed", value: done, color: "var(--gh-green)" },
                                { name: "Failed", value: failed, color: "var(--gh-red)" },
                                { name: "Running", value: running, color: "var(--gh-amber)" },
                            ]}
                            label={
                                <>
                                    <span className="text-[16px] font-light text-[var(--gh-fg)]">{total}</span> runs ·{" "}
                                    {failed} failed
                                </>
                            }
                        />
                        <BarLine
                            parts={[
                                { name: "Good", value: verdictCounts.good, color: "var(--gh-green)" },
                                { name: "Fair", value: verdictCounts.caution, color: "var(--gh-amber)" },
                                { name: "Poor", value: verdictCounts.bad, color: "var(--gh-red)" },
                            ]}
                            label={
                                <>
                                    <span className="text-[16px] font-light text-[var(--gh-fg)]">
                                        {verdictCounts.good}
                                    </span>{" "}
                                    good · {verdictCounts.caution} fair · {verdictCounts.bad} poor
                                </>
                            }
                        />
                        <p className="flex flex-wrap items-baseline gap-x-4 gap-y-1 pt-1 text-[14px] text-[var(--gh-muted)]">
                            <span>
                                <span className="text-[16px] font-light text-[var(--gh-fg)]">{total}</span> runs
                            </span>
                            <span>
                                <span className="text-[16px] font-light text-[var(--gh-fg)]">
                                    {medianDur != null ? fmtDur(medianDur) : "—"}
                                </span>{" "}
                                median run
                            </span>
                            <span>
                                <span className="text-[16px] font-light text-[var(--gh-fg)]">
                                    {avgScore != null ? String(avgScore) : "—"}
                                </span>{" "}
                                avg score
                            </span>
                            <span>
                                <span className="text-[16px] font-light text-[var(--gh-fg)]">{stockCount}</span> stocks
                            </span>
                        </p>
                    </div>
                )}
            </div>

            {/* All insights stacked — same width, one below the other */}
            <div className="flex flex-col gap-6">
                {/* Runs over time — column chart */}
                <div className="flex min-w-0 flex-col gap-2">
                    <h3 className="text-[17px] leading-none font-light text-[var(--gh-fg)]">Runs over time</h3>
                    {empty ? (
                        <InsightEmpty />
                    ) : (
                        <>
                            <p className="text-[14px] text-[var(--gh-muted)]">
                                <span className="text-[22px] font-light text-[var(--gh-fg)]">{total}</span> runs ·{" "}
                                {failed} failed
                            </p>
                            <ColumnChart
                                data={days.map((d) => ({ label: dayFmt(d), value: perDay.get(dayKey(d)) || 0 }))}
                                yTitle="Runs"
                            />
                        </>
                    )}
                </div>

                {/* Top stocks */}
                <div className="flex min-w-0 flex-col gap-2">
                    <h3 className="text-[17px] leading-none font-light text-[var(--gh-fg)]">Top stocks</h3>
                    {topStocks.length === 0 ? (
                        <InsightEmpty />
                    ) : (
                        <div className="flex flex-col gap-1.5">
                            {topStocks.map((s) => {
                                const avg = s.scores.length
                                    ? Math.round(s.scores.reduce((a, b) => a + b, 0) / s.scores.length)
                                    : null;
                                return (
                                    <TopRow
                                        key={s.label}
                                        logo={<TickerLogo symbol={s.symbol} size={18} />}
                                        name={s.symbol || s.label}
                                        title={s.label}
                                        meta={`${s.count} run${s.count === 1 ? "" : "s"}${avg != null ? ` · avg ${avg}` : ""}`}
                                        pct={topStocks[0].count ? (s.count / topStocks[0].count) * 100 : 0}
                                    />
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* Top agents */}
                <div className="flex min-w-0 flex-col gap-2">
                    <h3 className="text-[17px] leading-none font-light text-[var(--gh-fg)]">Top agents</h3>
                    {topAgents.length === 0 ? (
                        <InsightEmpty />
                    ) : (
                        <div className="flex flex-col gap-1">
                            {topAgents.map((a) => {
                                const avg = a.scores.length
                                    ? Math.round(a.scores.reduce((x, y) => x + y, 0) / a.scores.length)
                                    : null;
                                return (
                                    <div key={a.name} className="flex items-center gap-3 py-1">
                                        <AgentAvatar agent={a.seed} size={18} />
                                        <div className="min-w-0 flex-1">
                                            <div className="truncate text-[14px] text-[var(--gh-fg)]">{a.name}</div>
                                            <div className="text-[13px] text-[var(--gh-muted)]">
                                                {a.count} run{a.count === 1 ? "" : "s"}
                                                {avg != null ? ` · avg ${avg}` : ""}
                                            </div>
                                        </div>
                                        {a.scores.length > 0 && <Sparkbars scores={a.scores} />}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* Most used models */}
                <div className="flex min-w-0 flex-col gap-2">
                    <h3 className="text-[17px] leading-none font-light text-[var(--gh-fg)]">Most used models</h3>
                    {topModels.length === 0 ? (
                        <InsightEmpty />
                    ) : (
                        <div className="flex flex-col gap-1.5">
                            {topModels.map((m) => (
                                <TopRow
                                    key={m.model}
                                    logo={<ModelLogo model={m.model} size={15} />}
                                    name={m.model}
                                    meta={`${m.count} run${m.count === 1 ? "" : "s"}`}
                                    pct={topModels[0].count ? (m.count / topModels[0].count) * 100 : 0}
                                />
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </section>
    );
}

/* ── Period control ─────────────────────────────────────────────────────── */

function PeriodMenu({ value, onChange }: { value: string; onChange: (v: string) => void }) {
    const label = PERIODS.find((p) => p.key === value)?.label ?? PERIODS[0].label;
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <button
                    type="button"
                    className="inline-flex shrink-0 items-center gap-1.5 text-[14px] font-light text-[var(--gh-fg)] hover:text-[var(--gh-blue)] focus-visible:outline-none"
                >
                    <span className="text-[var(--gh-muted)]">Period:</span> {label}
                    <ChevronDown className="size-3.5 text-[var(--gh-muted)]" aria-hidden />
                </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[150px]">
                <DropdownMenuLabel className="text-[13px] font-light text-[var(--gh-muted)]">
                    Period
                </DropdownMenuLabel>
                <DropdownMenuRadioGroup value={value} onValueChange={onChange}>
                    {PERIODS.map((p) => (
                        <DropdownMenuRadioItem key={p.key} value={p.key} className="text-[13px]">
                            {p.label}
                        </DropdownMenuRadioItem>
                    ))}
                </DropdownMenuRadioGroup>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

function InsightEmpty() {
    return (
        <div className="flex flex-col items-start gap-1 py-3">
            <Activity className="size-5 text-[var(--gh-muted)]" aria-hidden />
            <p className="text-[15px] font-light text-[var(--gh-fg)]">Not enough data yet.</p>
            <p className="text-[13px] text-[var(--gh-muted)]">Runs in this period will show up here.</p>
        </div>
    );
}

/* ── Chart primitives (hand-rolled SVG, Primer colours) ─────────────────── */

/** Segmented strip + inline count label — GitHub Pulse's overview bars. */
function BarLine({ parts, label }: { parts: { name: string; value: number; color: string }[]; label: ReactNode }) {
    const total = parts.reduce((s, p) => s + p.value, 0) || 1;
    return (
        <div className="flex flex-col gap-1.5">
            <svg
                className="h-2 w-full overflow-hidden rounded-full"
                viewBox={`0 0 ${total} 8`}
                preserveAspectRatio="none"
                role="img"
                aria-label={parts.map((p) => `${p.name} ${p.value}`).join(", ")}
            >
                {parts.map((p, i) =>
                    p.value > 0 ? (
                        <rect
                            key={p.name}
                            x={parts.slice(0, i).reduce((s, q) => s + q.value, 0)}
                            width={p.value}
                            height={8}
                            fill={p.color}
                        >
                            <title>{`${p.name} · ${p.value}`}</title>
                        </rect>
                    ) : null
                )}
            </svg>
            <span className="text-[14px] font-light whitespace-nowrap text-[var(--gh-muted)]">{label}</span>
        </div>
    );
}

/** Column chart with dashed gridlines, tick labels and a rotated y-axis title. */
function ColumnChart({ data, yTitle }: { data: { label: string; value: number }[]; yTitle: string }) {
    const W = 380;
    const H = 120;
    const padL = 44;
    const padR = 6;
    const padT = 4;
    const padB = 22;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;
    const max = Math.max(1, ...data.map((d) => d.value));
    const step = Math.max(1, Math.ceil(max / 3));
    const top = step * 3;
    const ticks = [0, step, step * 2, step * 3];
    const n = Math.max(1, data.length);
    const slot = plotW / n;
    const bw = Math.max(3, Math.min(22, slot * 0.6));
    const labelEvery = Math.max(1, Math.ceil(n / 5));

    return (
        <svg
            viewBox={`0 0 ${W} ${H}`}
            className="w-full"
            role="img"
            aria-label={`${yTitle} per day: ${data.map((d) => `${d.label} ${d.value}`).join(", ")}`}
        >
            {ticks.map((t) => {
                const y = padT + plotH - (t / top) * plotH;
                return (
                    <g key={t}>
                        <line
                            x1={padL}
                            x2={W - padR}
                            y1={y}
                            y2={y}
                            stroke="var(--gh-muted)"
                            strokeOpacity="0.35"
                            strokeWidth="1"
                            strokeDasharray={t === 0 ? undefined : "3 3"}
                        />
                        <text x={padL - 6} y={y + 3} textAnchor="end" fontSize="11" fill="var(--gh-muted)">
                            {t}
                        </text>
                    </g>
                );
            })}
            <text
                transform={`translate(12 ${padT + plotH / 2}) rotate(-90)`}
                textAnchor="middle"
                fontSize="11"
                fill="var(--gh-muted)"
            >
                {yTitle}
            </text>
            {data.map((d, i) => {
                if (d.value <= 0) return null;
                const h = (d.value / top) * plotH;
                return (
                    <rect
                        key={`${d.label}-${i}`}
                        x={padL + i * slot + (slot - bw) / 2}
                        y={padT + plotH - h}
                        width={bw}
                        height={h}
                        fill="var(--gh-blue)"
                    >
                        <title>{`${d.label} · ${d.value} run${d.value === 1 ? "" : "s"}`}</title>
                    </rect>
                );
            })}
            {data.map((d, i) =>
                i % labelEvery === 0 ? (
                    <text
                        key={`x-${d.label}-${i}`}
                        x={padL + i * slot + slot / 2}
                        y={H - 6}
                        textAnchor="middle"
                        fontSize="11"
                        fill="var(--gh-muted)"
                    >
                        {d.label}
                    </text>
                ) : null
            )}
        </svg>
    );
}

/** Recent run scores, oldest → newest, tinted by the 70/40 bands. */
function Sparkbars({ scores }: { scores: number[] }) {
    const pts = scores.slice(-8);
    const w = 5;
    const gap = 2;
    const H = 16;
    return (
        <svg viewBox={`0 0 ${pts.length * (w + gap) - gap} ${H}`} className="h-4 shrink-0" aria-hidden="true">
            {pts.map((s, i) => {
                const h = Math.max(2, Math.min(H, Math.round((s / 100) * H)));
                return <rect key={i} x={i * (w + gap)} y={H - h} width={w} height={h} rx="1" fill={tone(s)} />;
            })}
        </svg>
    );
}

/** One ranked row: mark, name, count, share bar (SVG). */
function TopRow({
    logo,
    name,
    title,
    meta,
    pct,
}: {
    logo: ReactNode;
    name: string;
    title?: string;
    meta: string;
    pct: number;
}) {
    return (
        <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
                {logo}
                <span
                    className={cn("min-w-0 flex-1 truncate text-[14px] text-[var(--gh-fg)]")}
                    title={title || name}
                >
                    {name}
                </span>
                <span className="shrink-0 text-[13px] font-light text-[var(--gh-muted)] tabular-nums">{meta}</span>
            </div>
            <svg viewBox="0 0 100 4" preserveAspectRatio="none" className="mt-1 h-[3px] w-full" aria-hidden="true">
                <rect width="100" height="4" fill="var(--gh-muted)" fillOpacity="0.25" />
                <rect width={Math.max(pct, 0)} height="4" fill="var(--gh-blue)" />
            </svg>
        </div>
    );
}
