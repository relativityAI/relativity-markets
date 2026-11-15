import { useEffect, useState, type ReactNode, type ComponentType } from "react";
import { Link } from "react-router-dom";
import { Clock, Play } from "lucide-react";
import { AnalysisService, AgentService, type ScheduleRow } from "@/db";
import { TickerLogo } from "@/lib/sourceLogos";
import AgentAvatar from "@/components/shared/AgentAvatar";

/** Page-title combo: light, large Anek Latin (same as the workspace pages). */
const SECTION_TITLE = "font-app-body text-[30px] leading-none font-light tracking-tight text-console-ink";
const CARD = "flex items-center gap-3 rounded-[10px] border border-[color:var(--hairline)] bg-[var(--surface-raised)] px-3 py-2.5 transition-colors hover:bg-[var(--surface-raised-hover)]";

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

/** Watchlist card: stock header on top, then the agents that ran on it —
 *  avatar + name on the left, verdict and a light last-run time on the right. */
const WATCH_CARD = "flex flex-col items-stretch gap-3 rounded-[10px] border border-[color:var(--hairline)] bg-[var(--surface-raised)] px-3 py-2.5 transition-colors hover:bg-[var(--surface-raised-hover)]";

function RunCard({ run }: { run: RunCardData }) {
    return (
        <div className={WATCH_CARD}>
            <div className="flex items-center gap-3">
                <TickerLogo symbol={run.symbol} size={44} />
                <div className="min-w-0 flex-1">
                    <div className="truncate font-app-body text-[16px] font-light leading-tight text-[var(--ink-primary)]">
                        {run.share_name || run.symbol}
                    </div>
                    <div className="mt-1 flex items-center gap-1.5 truncate font-app-body text-[12px] font-normal text-[var(--ink-tertiary)]">
                        <span className="text-[15px] leading-none">{flag(run.source)}</span>
                        <span className="truncate">{run.symbol}</span>
                    </div>
                </div>
            </div>
            <div className="flex flex-col gap-1.5">
                {run.agents.map((a, i) => (
                    <div key={i} className="flex items-center gap-2.5">
                        <AgentAvatar agent={a.agent || "Agent"} size={26} />
                        <span className="min-w-0 flex-1 truncate font-app-body text-[13px] font-normal text-[var(--ink-secondary)]">
                            {a.agent}
                        </span>
                        {a.verdict && (
                            <span className="shrink-0 font-app-body text-[13px] font-normal text-[var(--ink-primary)]">
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
    );
}

export default function HomePage() {
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

    const schedule = schedules[0];
    const scheduledAgent = schedule
        ? agents.find((a) => (a._id || a.id) === schedule.agent_id) || null
        : null;

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
        return { symbol, share_name: rs[0].share_name || "", source: rs[0].source, agents };
    });
    const shown = watchCards.length ? watchCards : FAKE_WATCH;

    return (
        <div className="min-h-full bg-[var(--surface-canvas)] text-[var(--ink-primary)]">
            <div>
                {/* Hero — tagline left, run sections right */}
                <div className="grid gap-x-16 gap-y-12 pt-14 pb-12 lg:grid-cols-[minmax(0,1fr)_minmax(300px,380px)]">
                    <div className="max-w-3xl">
                        <h1 className="font-[family-name:var(--font-display)] text-[clamp(2.5rem,4.5vw,4.5rem)] leading-[1.05] font-light tracking-[-0.02em] text-[var(--ink-primary)]">
                            Agents watch the market, you watch the agents.
                        </h1>
                        <p className="mt-6 text-lg font-[family-name:var(--font-body)] font-[200] text-[var(--ink-secondary)] leading-relaxed">
                            <span className="font-[family-name:var(--font-display)] font-normal text-[var(--ink-primary)]">Relativity</span> agents evaluate stocks and markets against a specific investment thesis. Every agent's reasoning and verdict is supported by citations to official data sources.
                        </p>
                    </div>

                    <div className="flex flex-col gap-10 lg:pt-2">
                        {/* Scheduled runs */}
                        <HomeSection
                            title="Scheduled runs"
                            empty={!schedule}
                            emptyTo="/new-analysis"
                            emptyIcon={Clock}
                            emptyLabel="Schedule an agent run"
                        >
                            {schedule && (
                                <Link to="/new-analysis" className={CARD}>
                                    <AgentAvatar
                                        agent={scheduledAgent?.name || schedule.agent_id || "Agent"}
                                        size={44}
                                        label={scheduledAgent?.name}
                                    />
                                    <div className="min-w-0 flex-1">
                                        <div className="truncate font-app-body text-[16px] font-light leading-tight text-[var(--ink-primary)]">
                                            {scheduledAgent?.name || schedule.agent_id || "Scheduled agent"}
                                        </div>
                                        <div className="mt-1 truncate font-app-body text-[12px] font-normal text-[var(--ink-tertiary)]">
                                            Daily {schedule.time} · {schedule.share_name || schedule.symbol}
                                        </div>
                                    </div>
                                </Link>
                            )}
                        </HomeSection>

                        {/* Latest runs */}
                        <HomeSection
                            title="Latest runs"
                            empty={latest.length === 0}
                            emptyTo="/new-analysis"
                            emptyIcon={Play}
                            emptyLabel="New agent run"
                        >
                            {latest.map((run) => (
                                <Link
                                    key={run.id}
                                    to={run.id ? `/analysis-result/${run.id}` : "/analysis-list"}
                                    className={CARD}
                                >
                                    <TickerLogo symbol={run.symbol} size={44} />
                                    <div className="min-w-0 flex-1">
                                        <div className="truncate font-app-body text-[16px] font-light leading-tight text-[var(--ink-primary)]">
                                            {run.share_name || run.symbol}
                                        </div>
                                        <div className="mt-1 flex items-center gap-1.5 truncate font-app-body text-[12px] font-normal text-[var(--ink-tertiary)]">
                                            <span className="text-[15px] leading-none">{flag(run.source)}</span>
                                            <span className="truncate">{run.symbol}</span>
                                        </div>
                                    </div>
                                    <div className="shrink-0 text-right">
                                        {run.verdict && (
                                            <div className="font-app-body text-[13px] font-normal text-[var(--ink-primary)]">{run.verdict}</div>
                                        )}
                                        <div className="mt-0.5 font-app-body text-[12px] font-normal text-[var(--ink-tertiary)]">{run.when}</div>
                                    </div>
                                </Link>
                            ))}
                        </HomeSection>
                    </div>
                </div>

                {/* Watchlist — stocks under watch with agent runs (demo cards by default) */}
                <section className="pb-12">
                    <h2 className={SECTION_TITLE}>Watchlist</h2>
                    <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
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
