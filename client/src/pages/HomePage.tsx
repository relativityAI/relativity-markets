import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type ComponentType } from "react";
import { Link } from "react-router-dom";
import { Clock, Play, ArrowRight } from "lucide-react";
import { AnalysisService, AgentService, API_BASE, type ScheduleRow } from "@/db";
import { TickerLogo } from "@/lib/sourceLogos";
import AgentAvatar from "@/components/shared/AgentAvatar";

/** Page-title combo: light, large Anek Latin (same as the workspace pages). */
const SECTION_TITLE = "font-app-body text-[30px] leading-none font-light tracking-tight text-console-ink";
const CARD = "glass-hover";

/** Hover cue floated over the blurred card body — same pattern as AgentCell. */
function OpenCue() {
    return (
        <span className="glass-hover-cue font-app-body text-xs font-normal text-[#4A6E8E]">
            Open
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M3 9L9 3" />
                <path d="M4.5 3H9v4.5" />
            </svg>
        </span>
    );
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

function flag(source?: string | null): string {
    return String(source || "").toUpperCase() === "NSE" ? "🇮🇳" : "🇺🇸";
}

/** Verdict word → signal color (green strong, amber mid, red negative),
 *  matching verdictForScore's banding in lib/analysisFormat. */
function verdictColor(verdict?: string | null): string | undefined {
    if (!verdict) return undefined;
    const v = verdict.toLowerCase();
    if (["outstanding", "strong", "shortlist", "buy"].includes(v)) return "var(--signal-positive)";
    if (["fair", "watch", "hold", "underwhelming", "neutral"].includes(v)) return "var(--signal-caution)";
    if (["subpar", "pass", "error", "sell"].includes(v)) return "var(--signal-negative)";
    return undefined;
}

/** Bright 1-day intraday sparkline for a market index (^NSEI, ^NDX), served
 *  by the public /market/chart endpoint. Day change is measured against the
 *  feed's previous close (what the exchanges publish), not the session's
 *  first tick. Renders nothing when the feed is down — decoration must
 *  never block the page. */
function IndexSpark({ name, symbol }: { name: string; symbol: string }) {
    const [data, setData] = useState<{ closes: number[]; changePct: number | null } | null>(null);
    const [ok, setOk] = useState(true);

    useEffect(() => {
        let alive = true;
        fetch(`${API_BASE}/market/chart/${encodeURIComponent(symbol)}?range=1d&interval=5m`, { cache: "no-store" })
            .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
            .then((d) => {
                if (!alive) return;
                const closes: number[] = d.closes || [];
                const prevClose: number | null = d.previous_close ?? null;
                const last = closes[closes.length - 1] ?? null;
                if (closes.length < 2 || !prevClose || !last) { setOk(false); return; }
                setData({ closes, changePct: ((last - prevClose) / prevClose) * 100 });
            })
            .catch(() => { if (alive) setOk(false); });
        return () => { alive = false; };
    }, [symbol]);

    if (!ok || !data) return null;
    const { closes, changePct } = data;
    const min = Math.min(...closes);
    const max = Math.max(...closes);
    const span = max - min || 1;
    const W = 200;
    const H = 48;
    const pts = closes
        .map((c, i) => `${((i / (closes.length - 1)) * W).toFixed(1)},${(H - 4 - ((c - min) / span) * (H - 8)).toFixed(1)}`)
        .join(" ");
    const up = (changePct ?? 0) >= 0;
    const color = up ? "#22C55E" : "#EF4444";

    return (
        <div className="w-52">
            <div className="flex items-baseline justify-between gap-2">
                <span className="font-app-body text-[12px] font-normal text-[var(--ink-secondary)]">{name}</span>
                <span className="font-app-tabular text-[12px] font-medium" style={{ color }}>
                    {changePct == null ? "" : `${changePct > 0 ? "+" : ""}${changePct.toFixed(2)}%`}
                </span>
            </div>
            <svg viewBox={`0 0 ${W} ${H}`} className="mt-1.5 h-12 w-full" aria-hidden="true">
                <polygon points={`0,${H} ${pts} ${W},${H}`} fill={color} opacity="0.12" />
                <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
            </svg>
        </div>
    );
}

/** Bare sparkline + day change for the watchlist cards: sits beside the
 *  stock logo, no name label (the card names the stock below). */
function MiniSpark({ symbol, source }: { symbol: string; source?: string | null }) {
    const [spark, setSpark] = useState<{ pts: string; color: string; pct: number | null } | null>(null);

    useEffect(() => {
        let alive = true;
        fetch(`${API_BASE}/market/chart/${encodeURIComponent(symbol)}?range=1d&interval=5m&source=${encodeURIComponent(source || "")}`, { cache: "no-store" })
            .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
            .then((d) => {
                if (!alive) return;
                const closes: number[] = d.closes || [];
                if (closes.length < 2) { setSpark(null); return; }
                const min = Math.min(...closes);
                const max = Math.max(...closes);
                const span = max - min || 1;
                const W = 100;
                const H = 40;
                const pts = closes
                    .map((c, i) => `${((i / (closes.length - 1)) * W).toFixed(1)},${(H - 3 - ((c - min) / span) * (H - 6)).toFixed(1)}`)
                    .join(" ");
                const last = closes[closes.length - 1];
                const prev: number | null = d.previous_close ?? null;
                const pct = prev ? ((last - prev) / prev) * 100 : null;
                const up = prev ? last >= prev : last >= closes[0];
                setSpark({ pts, color: up ? "#22C55E" : "#EF4444", pct });
            })
            .catch(() => { if (alive) setSpark(null); });
        return () => { alive = false; };
    }, [symbol, source]);

    if (!spark) return null;
    return (
        <div className="flex min-w-0 flex-1 flex-col items-end gap-0.5">
            <svg viewBox="0 0 100 40" className="h-10 w-full" aria-hidden="true">
                <polygon points={`0,40 ${spark.pts} 100,40`} fill={spark.color} opacity="0.12" />
                <polyline points={spark.pts} fill="none" stroke={spark.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
            </svg>
            {spark.pct != null && (
                <span className="font-app-tabular text-[11px] font-medium" style={{ color: spark.color }}>
                    {spark.pct > 0 ? "+" : ""}{spark.pct.toFixed(2)}%
                </span>
            )}
        </div>
    );
}

/** Big borderless pill shown under an empty section. */
function BigGhost({ to, icon: Icon, children }: { to: string; icon: ComponentType<{ size?: number }>; children: ReactNode }) {
    return (
        <Link
            to={to}
            className="mt-3 flex h-14 w-full items-center justify-center gap-2.5 rounded-[12px] border-0 bg-[var(--surface-raised)] font-app-body text-[15px] font-normal text-[var(--ink-secondary)] transition-colors hover:bg-[var(--surface-raised-hover)] hover:text-[var(--ink-primary)]"
        >
            <Icon size={18} />
            {children}
        </Link>
    );
}

function HomeSection({ title, children, empty, emptyTo, emptyIcon, emptyLabel }: {
    title: string; children: ReactNode; empty: boolean; emptyTo: string; emptyIcon: ComponentType<{ size?: number }>; emptyLabel: string;
}) {
    return (
        <section>
            <h2 className={SECTION_TITLE}>{title}</h2>
            <div className="mt-4 flex flex-col gap-2.5">{children}</div>
            {empty && <BigGhost to={emptyTo} icon={emptyIcon}>{emptyLabel}</BigGhost>}
        </section>
    );
}

interface RunCardAgent {
    agent?: string;
    verdict?: string;
    when: string;
}

interface RunCardData {
    symbol: string;
    share_name: string;
    source?: string;
    agents: RunCardAgent[];
    /** Latest run for the symbol — the card links to its result. */
    id?: string;
}

/** Watchlist defaults: two demo run cards until real watchlist runs exist. */
const FAKE_WATCH: RunCardData[] = [
    {
        symbol: "AAPL", share_name: "Apple Inc.", source: "SEC",
        agents: [
            { agent: "Momentum Agent", verdict: "Strong", when: "2h ago" },
            { agent: "Chartist Agent", verdict: "Hold", when: "6h ago" },
            { agent: "Sentiment Agent", verdict: "Neutral", when: "1d ago" },
        ],
    },
    {
        symbol: "ACMESOLAR", share_name: "Acme Solar Holdings", source: "NSE",
        agents: [
            { agent: "Value Agent", verdict: "Hold", when: "1d ago" },
            { agent: "Momentum Agent", verdict: "Strong", when: "2d ago" },
        ],
    },
];

const WATCH_KEY = "relativity.watchlist";

function loadWatchlist(): string[] {
    try {
        const raw = localStorage.getItem(WATCH_KEY);
        const v = raw ? JSON.parse(raw) : [];
        return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
    } catch { return []; }
}

/** Watchlist card: same visual language as the Latest-runs cards — stock
 *  logo on top, name + flag, then the agents that ran on it (compact rows:
 *  small avatar, name, colored verdict, light last-run time). Opens the
 *  symbol's latest run result in a new tab. */
const WATCH_CARD = "glass-hover w-full max-w-56";

function RunCard({ run }: { run: RunCardData }) {
    return (
        <Link
            to={run.id ? `/analysis-result/${run.id}` : "/analysis-list"}
            target="_blank"
            rel="noreferrer"
            data-solid=""
            className={WATCH_CARD}
        >
            <div className="glass-hover-body flex w-full flex-col gap-2">
                <div className="flex items-center gap-2">
                    <TickerLogo symbol={run.symbol} size={72} />
                    <MiniSpark symbol={run.symbol} source={run.source} />
                </div>
                <div className="flex items-center gap-1.5">
                    <span className="min-w-0 flex-1 truncate font-app-body text-[16px] font-light leading-tight text-[var(--ink-primary)]">
                        {run.share_name || run.symbol}
                    </span>
                    {run.source && <span className="shrink-0 text-[14px] leading-none">{flag(run.source)}</span>}
                </div>
                <div className="flex flex-col gap-1.5 pt-1">
                    {run.agents.map((a, i) => (
                        <div key={i} className="flex items-center gap-2.5">
                            <AgentAvatar agent={a.agent || "Agent"} size={28} />
                            <span className="min-w-0 flex-1 truncate font-app-body text-[13px] font-normal text-[var(--ink-secondary)]">
                                {a.agent}
                            </span>
                            {a.verdict && (
                                <span
                                    className="shrink-0 font-app-body text-[13px] font-normal"
                                    style={{ color: verdictColor(a.verdict) || "var(--ink-primary)" }}
                                >
                                    {a.verdict}
                                </span>
                            )}
                            <span className="w-16 shrink-0 text-right font-app-body text-[11px] font-normal text-[var(--ink-tertiary)]">
                                {a.when}
                            </span>
                        </div>
                    ))}
                </div>
            </div>
            <OpenCue />
        </Link>
    );
}

export default function HomePage() {
    // Hero: cap the paragraph to the tagline's rendered width so both
    // blocks share the same right edge at every viewport. The tagline is
    // w-fit, so its border box IS its text width; a ResizeObserver tracks it.
    const titleRef = useRef<HTMLHeadingElement>(null);
    const [titleWidth, setTitleWidth] = useState<number | undefined>();
    useLayoutEffect(() => {
        const el = titleRef.current;
        if (!el) return;
        const ro = new ResizeObserver(() => setTitleWidth(el.getBoundingClientRect().width));
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    const [schedules, setSchedules] = useState<ScheduleRow[]>([]);
    const [runs, setRuns] = useState<any[]>([]);
    const [agents, setAgents] = useState<any[]>([]);

    useEffect(() => {
        Promise.allSettled([AnalysisService.listSchedules(), AnalysisService.listAnalyses(), AgentService.listAgents()])
            .then(([s, r, a]) => {
                if (s.status === "fulfilled" && Array.isArray(s.value)) setSchedules(s.value);
                if (r.status === "fulfilled" && Array.isArray(r.value)) setRuns(r.value);
                if (a.status === "fulfilled" && Array.isArray(a.value)) setAgents(a.value);
            });
    }, []);

    // Active agents: one card per schedule, shown in two columns. Last run is
    // matched by agent name (run rows carry no agent_id).
    const activeCards = schedules.map((s) => {
        const agent = agents.find((a) => (a._id || a.id) === s.agent_id) || null;
        const name = agent?.name;
        const last = name
            ? runs
                  .filter((r) => (r.agent_name || r.agent) === name)
                  .sort((x, y) => +new Date(y.created_at) - +new Date(x.created_at))[0] || null
            : null;
        return { schedule: s, agent, last };
    });

    const latest = [...runs]
        .sort((x, y) => +new Date(y.created_at) - +new Date(x.created_at))
        .slice(0, 2)
        .map((r) => ({
            id: r.id || r.analysis_id || "",
            symbol: r.symbol || "",
            share_name: r.share_name || "",
            source: r.source,
            agent: r.agent_name || r.agent || undefined,
            verdict: r.verdict || r.status,
            when: timeAgo(r.created_at),
        }));

    // Watchlist: group watched symbols' runs per agent (latest first, up to 3
    // agents per card); the two demo cards until any exist.
    const watchlist = loadWatchlist();
    const bySymbol = new Map<string, any[]>();
    for (const r of runs) {
        if (!watchlist.includes(r.symbol)) continue;
        const list = bySymbol.get(r.symbol) || [];
        list.push(r);
        bySymbol.set(r.symbol, list);
    }
    const watchCards: RunCardData[] = [...bySymbol.entries()].map(([symbol, rs]) => {
        rs.sort((x, y) => +new Date(y.created_at) - +new Date(x.created_at));
        const agents: RunCardAgent[] = [];
        const seen = new Set<string>();
        for (const r of rs) {
            const a = r.agent_name || r.agent || "Agent";
            if (seen.has(a)) continue;
            seen.add(a);
            agents.push({ agent: a, verdict: r.verdict || r.status, when: timeAgo(r.created_at) });
            if (agents.length >= 3) break;
        }
        return { symbol, share_name: rs[0].share_name || "", source: rs[0].source, agents, id: rs[0].id || rs[0].analysis_id };
    });
    const shown = watchCards.length ? watchCards : FAKE_WATCH;

    return (
        <div className="min-h-full bg-[var(--surface-canvas)] text-[var(--ink-primary)]">
            <div>
                {/* Hero — tagline left, bright index charts right */}
                <div className="flex flex-wrap items-center justify-between gap-x-16 gap-y-8 pt-7">
                    <div>
                        <h1 ref={titleRef} className="w-fit max-w-full font-[family-name:var(--font-display)] text-[clamp(1.5rem,3vw,2rem)] leading-[1.1] font-light tracking-[-0.02em] text-[var(--ink-primary)]">
                            Agents watch the market, you watch the agents.
                        </h1>
                        <p style={{ maxWidth: titleWidth }} className="mt-3 text-sm font-[family-name:var(--font-body)] font-[200] text-[var(--ink-secondary)] leading-relaxed">
                            Relativity agents evaluate stocks and markets against a specific investment thesis. Every agent's reasoning and verdict is supported by citations to official data sources.
                        </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-10">
                        <IndexSpark name="NIFTY 50" symbol="^NSEI" />
                        <IndexSpark name="NASDAQ 100" symbol="^NDX" />
                    </div>
                </div>

                <div className="mt-12 grid gap-x-16 gap-y-10 pb-12 md:grid-cols-2">
                        {/* Active Agents */}
                        <HomeSection
                            title="Active Agents"
                            empty={activeCards.length === 0}
                            emptyTo="/new-analysis"
                            emptyIcon={Clock}
                            emptyLabel="Schedule an agent run"
                        >
                            {activeCards.length > 0 && (
                                <div className="grid gap-4 md:grid-cols-2">
                                    {activeCards.map(({ schedule: s, agent, last }) => (
                                        <Link
                                            key={s.id}
                                            to="/new-analysis"
                                            target="_blank"
                                            rel="noreferrer"
                                            data-solid=""
                                            className={CARD}
                                        >
                                            <div className="glass-hover-body flex w-full items-center gap-3">
                                                <AgentAvatar
                                                    agent={agent?.name || s.agent_id || "Agent"}
                                                    size={112}
                                                    label={agent?.name}
                                                />
                                                <div className="min-w-0 flex-1">
                                                    <div className="truncate font-app-body text-[16px] font-light leading-tight text-[var(--ink-primary)]">
                                                        {agent?.name || s.agent_id || "Scheduled agent"}
                                                    </div>
                                                    <div className="mt-1.5 flex flex-col gap-1 font-app-body text-[12px] font-normal text-[var(--ink-tertiary)]">
                                                        {s.symbol ? (
                                                            <span className="truncate">
                                                                Runs on {flag(s.source)} {s.symbol} · {String(s.source).toUpperCase() === "NSE" ? "Indian equities" : "US equities"}
                                                            </span>
                                                        ) : (
                                                            <span>General</span>
                                                        )}
                                                        <span className="flex items-center gap-1.5">
                                                            <Clock size={13} /> Daily {s.time} ({s.timezone})
                                                        </span>
                                                        <span>Last run {last ? timeAgo(last.created_at) : "no runs yet"}</span>
                                                        <span>Verdict {last ? (last.verdict || last.status || "no verdict yet") : "no verdict yet"}</span>
                                                    </div>
                                                </div>
                                            </div>
                                            <OpenCue />
                                        </Link>
                                    ))}
                                </div>
                            )}
                        </HomeSection>

                        {/* Latest runs — vertical cards: big logo on top, metadata below */}
                        <HomeSection
                            title="Latest runs"
                            empty={latest.length === 0}
                            emptyTo="/new-analysis"
                            emptyIcon={Play}
                            emptyLabel="New agent run"
                        >
                            {latest.length > 0 && (
                                <div className="flex flex-wrap gap-4">
                                    {latest.map((run) => (
                                        <Link
                                            key={run.id}
                                            to={run.id ? `/analysis-result/${run.id}` : "/analysis-list"}
                                            target="_blank"
                                            rel="noreferrer"
                                            data-solid=""
                                            className={`${CARD} w-[72px] shrink-0`}
                                        >
                                            <div className="glass-hover-body flex flex-col gap-2">
                                                <TickerLogo symbol={run.symbol} size={72} />
                                                <div className="flex items-center gap-1.5">
                                                    <span className="min-w-0 flex-1 truncate font-app-body text-[16px] font-light leading-tight text-[var(--ink-primary)]">
                                                        {run.share_name || run.symbol}
                                                    </span>
                                                    {run.source && <span className="shrink-0 text-[14px] leading-none">{flag(run.source)}</span>}
                                                </div>
                                                <div className="truncate font-app-body text-[12px] font-normal text-[var(--ink-tertiary)]">
                                                    {run.agent}
                                                </div>
                                                <div className="flex flex-col gap-0.5 pt-1">
                                                    {run.verdict && (
                                                        <span
                                                            className="font-app-body text-[13px] font-normal leading-tight"
                                                            style={{ color: verdictColor(run.verdict) || "var(--ink-primary)" }}
                                                        >
                                                            {run.verdict}
                                                        </span>
                                                    )}
                                                    <span className="font-app-body text-[12px] font-normal text-[var(--ink-tertiary)]">{run.when}</span>
                                                </div>
                                            </div>
                                            <OpenCue />
                                        </Link>
                                    ))}

                                    {/* View all — past runs page */}
                                    <Link
                                        to="/analysis-list"
                                        target="_blank"
                                        rel="noreferrer"
                                        data-solid=""
                                        className={`${CARD} w-[72px] shrink-0`}
                                    >
                                        <div className="glass-hover-body flex flex-col gap-2">
                                            <span className="flex h-[72px] w-[72px] items-center justify-center rounded-[10px] bg-[var(--surface-raised)]">
                                                <ArrowRight size={28} />
                                            </span>
                                            <div className="truncate font-app-body text-[16px] font-light leading-tight text-[var(--ink-primary)]">View all</div>
                                            <div className="truncate font-app-body text-[12px] font-normal text-[var(--ink-tertiary)]">Past runs</div>
                                        </div>
                                        <OpenCue />
                                    </Link>
                                </div>
                            )}
                        </HomeSection>
                </div>

                {/* Watchlist — stocks under watch with agent runs (demo cards by default) */}
                <section className="pb-12">
                    <h2 className={SECTION_TITLE}>Watchlist</h2>
                    <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
                        {shown.map((run, i) => (
                            <RunCard key={`${run.symbol}-${i}`} run={run} />
                        ))}
                    </div>
                </section>

                {/* Footer */}
                <footer className="py-8 border-t border-[var(--hairline)]">
                    <div className="grid grid-cols-3 gap-6 text-sm">
                        <div>
                            <h4 className="text-xs uppercase tracking-[0.08em] text-[var(--ink-tertiary)] mb-3">Product</h4>
                            <div className="space-y-2 text-[var(--ink-secondary)]">
                                <Link to="/new-analysis" className="block hover:text-[var(--ink-primary)]">New Analysis</Link>
                                <Link to="/analysis-list" className="block hover:text-[var(--ink-primary)]">Runs</Link>
                                <Link to="/agents" className="block hover:text-[var(--ink-primary)]">Agents</Link>
                            </div>
                        </div>
                        <div>
                            <h4 className="text-xs uppercase tracking-[0.08em] text-[var(--ink-tertiary)] mb-3">Company</h4>
                            <div className="space-y-2 text-[var(--ink-secondary)]">
                                <Link to="/privacy" className="block hover:text-[var(--ink-primary)]">Privacy</Link>
                                <Link to="/terms" className="block hover:text-[var(--ink-primary)]">Terms</Link>
                            </div>
                        </div>
                        <div>
                            <h4 className="text-xs uppercase tracking-[0.08em] text-[var(--ink-tertiary)] mb-3">Resources</h4>
                            <div className="space-y-2 text-[var(--ink-secondary)]">
                                <Link to="/analysis-list" className="block hover:text-[var(--ink-primary)]">My Workspace</Link>
                                <Link to="/settings" className="block hover:text-[var(--ink-primary)]">Settings</Link>
                            </div>
                        </div>
                    </div>
                    <p className="text-xs text-[var(--ink-tertiary)] text-center mt-8">
                        Not investment advice or no trade calls. Relativity is a research tool.
                    </p>
                </footer>
            </div>
        </div>
    );
}
