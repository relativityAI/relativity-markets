import { useEffect, useRef, useState, type ReactNode, type ComponentType } from "react";
import { Link } from "react-router-dom";
import { Clock, Play, ArrowRight } from "lucide-react";
import { AnalysisService, API_BASE, PluginService, AlertService, runPluginLabel, type AlertRuleRow, type AlertRow, type PluginSummary } from "@/db";
import { verdictInk } from "@/lib/analysisFormat";
import { FlagLogo, TickerLogo } from "@/lib/sourceLogos";
import sp500Logo from "@/assets/indices/s-and-p-500.svg";
import nasdaq100Logo from "@/assets/indices/nasdaq-100.svg";
import sensexLogo from "@/assets/indices/bse-sensex.svg";
import PluginAvatar from "@/components/shared/PluginAvatar";
import WatchlistPanel from "@/components/WatchlistPanel";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useColorMode } from "@/components/ui/color-mode";

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

/** TradingView heatmap embed (iframe widget). NIFTY50 is in TradingView's
 *  dataset list but the embed silently falls back to SPX500 for it — verified
 *  by rendering SPX500/NIFTY50/NIFTY/SENSEX side by side — so India is SENSEX. */
const HEATMAP_SOURCES = [
    { id: "SPX500", label: "S&P 500", symbol: "^GSPC", logo: sp500Logo },
    { id: "NASDAQ100", label: "Nasdaq 100", symbol: "^NDX", logo: nasdaq100Logo },
    { id: "SENSEX", label: "Sensex", symbol: "^BSESN", logo: sensexLogo },
] as const;

const HEATMAP_KEY = "relativity.heatmapSource";

/** Heatmap + index toggle. Replaces the hero text at the top of the rail. */
function HeatmapPanel() {
    const { colorMode } = useColorMode();
    const [source, setSource] = useState<string>(() => {
        const saved = localStorage.getItem(HEATMAP_KEY);
        return HEATMAP_SOURCES.some((s) => s.id === saved) ? String(saved) : HEATMAP_SOURCES[0].id;
    });
    const [changes, setChanges] = useState<Record<string, number | null>>({});
    const boxRef = useRef<HTMLDivElement>(null);
    // The embed script is async: React must not detach it before it runs
    // (StrictMode's double effect did exactly that → null parentNode crash).
    const pendingRef = useRef<HTMLScriptElement | null>(null);

    // Last choice survives a reload.
    useEffect(() => { localStorage.setItem(HEATMAP_KEY, source); }, [source]);

    // Day change per index: last intraday close vs the feed's previous close.
    useEffect(() => {
        let alive = true;
        Promise.all(
            HEATMAP_SOURCES.map((s) =>
                fetch(`${API_BASE}/market/chart/${encodeURIComponent(s.symbol)}?range=1d&interval=5m`, { cache: "no-store" })
                    .then((r) => (r.ok ? r.json() : null))
                    .catch(() => null)
                    .then((d: { closes?: number[]; previous_close?: number | null } | null) => {
                        const last = d?.closes?.[d.closes.length - 1];
                        const prev = d?.previous_close;
                        return [s.id, typeof last === "number" && prev ? ((last - prev) / prev) * 100 : null] as const;
                    }),
            ),
        ).then((rows) => { if (alive) setChanges(Object.fromEntries(rows)); });
        return () => { alive = false; };
    }, []);

    // The embed script reads its own text as config, and React never executes
    // injected <script>s — so build it imperatively and re-inject whenever the
    // source or the theme changes.
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
            script.src = "https://s3.tradingview.com/external-embedding/embed-widget-stock-heatmap.js";
            script.textContent = JSON.stringify({
                exchanges: [],
                dataSource: source,
                grouping: "sector",
                blockSize: "market_cap_basic",
                blockColor: "change",
                locale: "en",
                symbolUrl: "",
                colorTheme: colorMode === "dark" ? "dark" : "light",
                hasTopBar: false,
                isDataSetEnabled: false,
                isZoomEnabled: true,
                hasSymbolTooltip: true,
                isMonoSize: false,
                width: "100%",
                height: "100%",
            });
            pendingRef.current = script;
            const settled = () => { if (pendingRef.current === script) pendingRef.current = null; };
            script.addEventListener("load", settled, { once: true });
            script.addEventListener("error", settled, { once: true });
            box.append(holder, script);
        };
        // Swap only after the previous script has executed, else wait for it.
        const pending = pendingRef.current;
        if (pending) {
            pending.addEventListener("load", inject, { once: true });
            pending.addEventListener("error", inject, { once: true });
        } else {
            inject();
        }
        return () => { dead = true; };
    }, [source, colorMode]);

    return (
        <section>
            <h2 className={SECTION_TITLE}>Market heatmap</h2>
            {/* No pill: the shadcn default (bg-muted / border / p-1) is
                overridden so the buttons sit on the canvas, and the selected
                chip uses the watchlist's own bg-console-surface. */}
            <ToggleGroup
                type="single"
                value={source}
                onValueChange={(v) => { if (v) setSource(v); }}
                aria-label="Heatmap index"
                className="mt-4 flex h-auto gap-1 border-0 bg-transparent p-0"
            >
                {HEATMAP_SOURCES.map((s) => {
                    const ch = changes[s.id];
                    return (
                        <ToggleGroupItem
                            key={s.id}
                            value={s.id}
                            aria-label={ch == null ? s.label : `${s.label}, day change ${ch >= 0 ? "plus" : "minus"} ${Math.abs(ch).toFixed(1)} percent`}
                            className="h-8 min-w-0 flex-1 gap-1.5 rounded-[8px] border-0 px-1.5 font-app-body text-[12px] font-normal text-console-ink-3 hover:bg-console-surface/60 hover:text-console-ink data-[state=on]:bg-console-surface data-[state=on]:text-console-ink data-[state=on]:shadow-none"
                        >
                            {/* 26px = the two-line block (11px + 10px at
                                leading-tight), so the circle's top and bottom
                                sit on the label and the change. */}
                            <img src={s.logo} alt="" aria-hidden="true" className="size-[26px] shrink-0 rounded-full" />
                            <span className="flex min-w-0 flex-col items-start leading-tight">
                                <span className="max-w-full truncate text-[11px]">{s.label}</span>
                                <span
                                    className="font-app-tabular text-[10px]"
                                    style={{ color: ch == null ? undefined : ch >= 0 ? "var(--signal-positive-text)" : "var(--signal-negative-text)" }}
                                >
                                    {ch == null ? "—" : `${ch >= 0 ? "+" : "−"}${Math.abs(ch).toFixed(1)}%`}
                                </span>
                            </span>
                        </ToggleGroupItem>
                    );
                })}
            </ToggleGroup>
            {/* Portrait on purpose: the widget's treemap packs sector groups
                along the short edge, so a tall box keeps it to ~2 sectors
                wide instead of 8 unreadable slivers. Height lives on the
                WRAPPER — the embed script overwrites its own container with
                inline height:100%, which would otherwise resolve to auto. */}
            <div className="mt-3 h-[600px] w-full overflow-hidden rounded-xl border border-[var(--hairline)] bg-[var(--surface-canvas)]">
                <div ref={boxRef} className="tradingview-widget-container h-full w-full" />
            </div>
        </section>
    );
}

export default function HomePage() {
    const [alertRules, setAlertRules] = useState<AlertRuleRow[]>([]);
    const [alerts, setAlerts] = useState<AlertRow[]>([]);
    const [runs, setRuns] = useState<any[]>([]);
    const [plugins, setPlugins] = useState<PluginSummary[]>([]);

    useEffect(() => {
        Promise.allSettled([
            AnalysisService.listAlertRules(),
            AnalysisService.listAnalyses(),
            PluginService.list(),
            AlertService.listAlerts(),
        ]).then(([s, r, a, al]) => {
            if (s.status === "fulfilled" && Array.isArray(s.value)) setAlertRules(s.value);
            if (r.status === "fulfilled" && Array.isArray(r.value)) setRuns(r.value);
            if (a.status === "fulfilled" && Array.isArray(a.value)) setPlugins(a.value);
            if (al.status === "fulfilled" && Array.isArray(al.value)) setAlerts(al.value);
        });
    }, []);

    // Scheduled rules: one card per rule. The label is the rule's plugin;
    // the last run matches on symbol + shared plugin.
    const activeCards = alertRules.map((s) => {
        const label = runPluginLabel(s.plugin_ids, plugins, null) || "Scheduled run";
        const last =
            runs
                .filter(
                    (r) =>
                        r.symbol === s.symbol &&
                        (!s.plugin_ids?.length ||
                            (r.plugin_ids || []).some((p: string) => s.plugin_ids?.includes(p))),
                )
                .sort((x, y) => +new Date(y.created_at) - +new Date(x.created_at))[0] || null;
        return { schedule: s, label, last };
    });

    const latest = [...runs]
        .sort((x, y) => +new Date(y.created_at) - +new Date(x.created_at))
        .slice(0, 4)
        .map((r) => ({
            id: r.id || r.analysis_id || "",
            symbol: r.symbol || "",
            share_name: r.share_name || "",
            source: r.source,
            agent: runPluginLabel(r.plugin_ids, plugins, null) || r.agent_name || r.agent || undefined,
            verdict: r.verdict || r.status,
            when: timeAgo(r.created_at),
        }));

    return (
        <div className="min-h-full bg-[var(--surface-canvas)] text-[var(--ink-primary)]">
            <div>
                {/* Two columns: active agents → latest runs on the left,
                    watchlist (min two cards wide) on the right. Below lg
                    they stack in reading order, text first. */}
                <div className="flex flex-wrap items-start gap-x-10 gap-y-10 pt-7">
                    {/* ponytail: fixed left rail — 360px leaves the watchlist
                        600px+ from 1024 up; 440px from 1280. */}
                    <div className="order-1 flex w-full flex-col gap-12 pb-12 lg:w-[360px] lg:shrink-0 xl:w-[440px]">
                        <HeatmapPanel />

                        {/* Alerts — verdicts that changed while you were away */}
                        <HomeSection
                            title="Alerts"
                            empty={alerts.length === 0}
                            emptyTo="/new-run?mode=alert"
                            emptyIcon={Clock}
                            emptyLabel="Set up an alert"
                        >
                            {alerts.length > 0 && (
                                <div className="flex flex-col gap-2.5">
                                    {alerts.slice(0, 5).map((a) => (
                                        <Link
                                            key={a.id}
                                            to={a.run_id ? `/runs/${a.run_id}` : "/runs"}
                                            data-solid=""
                                            className={CARD}
                                            onClick={() => {
                                                if (!a.read_at) AlertService.markRead(a.id).catch(() => {});
                                            }}
                                        >
                                            <div className="glass-hover-body flex w-full items-center gap-3 px-3 py-2.5">
                                                <TickerLogo symbol={a.symbol} size={32} />
                                                <div className="min-w-0 flex-1">
                                                    <div className="flex items-center gap-1.5">
                                                        {!a.read_at && (
                                                            <span
                                                                aria-label="Unread"
                                                                className="h-1.5 w-1.5 shrink-0 rounded-full"
                                                                style={{ background: "var(--signal-negative)" }}
                                                            />
                                                        )}
                                                        <span className="truncate font-app-body text-[14px] font-light text-[var(--ink-primary)]">
                                                            {a.share_name || a.symbol}
                                                        </span>
                                                    </div>
                                                    <div className="truncate font-app-body text-[11px] font-normal text-[var(--ink-tertiary)]">
                                                        {a.agent_name || "Scheduled run"} · {timeAgo(a.created_at)}
                                                    </div>
                                                </div>
                                                <span
                                                    className="shrink-0 rounded-full px-2 py-0.5 font-app-body text-[11px] font-medium"
                                                    style={{
                                                        color: verdictInk(a.verdict) || "var(--ink-secondary)",
                                                        background: `color-mix(in srgb, ${verdictInk(a.verdict) || "var(--ink-secondary)"} 14%, transparent)`,
                                                    }}
                                                >
                                                    {a.verdict}
                                                </span>
                                            </div>
                                        </Link>
                                    ))}
                                </div>
                            )}
                        </HomeSection>

                        {/* Scheduled runs — one card per enabled alert rule */}
                        <HomeSection
                            title="Scheduled runs"
                            empty={activeCards.length === 0}
                            emptyTo="/new-run"
                            emptyIcon={Clock}
                            emptyLabel="Set up an alert"
                        >
                            {activeCards.length > 0 && (
                                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
                                    {activeCards.map(({ schedule: s, label, last }) => {
                                        const verdict = last ? (last.verdict || last.status || "") : "";
                                        const vColor = verdictInk(verdict);
                                        return (
                                        <Link
                                            key={s.id}
                                            to="/new-run"
                                            target="_blank"
                                            rel="noreferrer"
                                            data-solid=""
                                            className={CARD}
                                        >
                                            {/* Header: avatar, who + what it runs on, verdict chip. */}
                                            <div className="glass-hover-body flex w-full flex-col">
                                                <div className="flex items-center gap-3">
                                                    <PluginAvatar
                                                        plugin={s.plugin_ids?.[0] || label}
                                                        size={64}
                                                        label={label}
                                                    />
                                                    <div className="min-w-0 flex-1 py-2.5">
                                                        <div className="truncate font-app-body text-[15px] font-light leading-tight text-[var(--ink-primary)]">
                                                            {label}
                                                        </div>
                                                        <div className="mt-1 flex items-center gap-1.5 font-app-body text-[11px] font-normal text-[var(--ink-tertiary)]">
                                                            {s.symbol ? (
                                                                <>
                                                                    <FlagLogo source={s.source} size={12} />
                                                                    <span className="truncate">
                                                                        Runs on {s.symbol} · {String(s.source).toUpperCase() === "NSE" ? "Indian equities" : "US equities"}
                                                                    </span>
                                                                </>
                                                            ) : (
                                                                "General"
                                                            )}
                                                        </div>
                                                    </div>
                                                    {verdict && (
                                                        <span
                                                            className="mr-3 shrink-0 rounded-full px-2 py-0.5 font-app-body text-[11px] font-medium"
                                                            style={{
                                                                color: vColor || "var(--ink-secondary)",
                                                                background: `color-mix(in srgb, ${vColor || "var(--ink-secondary)"} 14%, transparent)`,
                                                            }}
                                                        >
                                                            {verdict}
                                                        </span>
                                                    )}
                                                </div>
                                                {/* Footer: schedule and last run, split by a full-bleed rule. */}
                                                <div className="flex items-center justify-between gap-3 border-t border-[var(--hairline)] px-3 py-2 font-app-body text-[11px] font-normal text-[var(--ink-tertiary)]">
                                                    <span
                                                        className="flex min-w-0 items-center gap-1.5 truncate"
                                                        title={`Daily ${s.time} (${s.timezone})`}
                                                    >
                                                        <Clock size={12} className="shrink-0" aria-hidden="true" />
                                                        Daily {s.time} ({s.timezone})
                                                    </span>
                                                    <span className="shrink-0">
                                                        {last ? `Last run ${timeAgo(last.created_at)}` : "No runs yet"}
                                                    </span>
                                                </div>
                                            </div>
                                            <OpenCue />
                                        </Link>
                                        );
                                    })}
                                </div>
                            )}
                        </HomeSection>

                    {/* Latest runs — small vertical cards, last one is View all */}
                    <HomeSection
                        title="Latest runs"
                        empty={latest.length === 0}
                        emptyTo="/new-run"
                        emptyIcon={Play}
                        emptyLabel="New run"
                    >
                        {latest.length > 0 && (
                            <div className="flex flex-wrap gap-3">
                                {latest.map((run, i) => {
                                    // ponytail: breakpoints instead of a resize observer —
                                    // 3 cards on phones, 4 on tablets, 5 on desktop.
                                    const hide = i >= 3 ? "hidden lg:block" : i >= 2 ? "hidden sm:block" : "";
                                    return (
                                        <Link
                                            key={run.id}
                                            to={run.id ? `/runs/${run.id}` : "/runs"}
                                            target="_blank"
                                            rel="noreferrer"
                                            data-solid=""
                                            className={`${CARD} w-14 shrink-0 ${hide}`}
                                        >
                                            <div className="glass-hover-body flex flex-col gap-1.5">
                                                <TickerLogo symbol={run.symbol} size={56} />
                                                <div className="flex items-center gap-1">
                                                    <span className="min-w-0 flex-1 truncate font-app-body text-[13px] font-light leading-tight text-[var(--ink-primary)]">
                                                        {run.share_name || run.symbol}
                                                    </span>
                                                    {run.source && <FlagLogo source={run.source} size={12} />}
                                                </div>
                                                <div className="truncate font-app-body text-[11px] font-normal text-[var(--ink-tertiary)]">
                                                    {run.agent}
                                                </div>
                                                <div className="flex flex-col gap-0.5 pt-0.5">
                                                    {run.verdict && (
                                                        <span
                                                            className="font-app-body text-[11px] font-normal leading-tight"
                                                            style={{ color: verdictInk(run.verdict) || "var(--ink-primary)" }}
                                                        >
                                                            {run.verdict}
                                                        </span>
                                                    )}
                                                    <span className="font-app-body text-[10px] font-normal text-[var(--ink-tertiary)]">{run.when}</span>
                                                </div>
                                            </div>
                                            <OpenCue />
                                        </Link>
                                    );
                                })}

                                {/* View all — past runs page */}
                                <Link
                                    to="/runs"
                                    target="_blank"
                                    rel="noreferrer"
                                    data-solid=""
                                    className={`${CARD} w-14 shrink-0`}
                                >
                                    <div className="glass-hover-body flex flex-col gap-1.5">
                                        <span className="flex h-14 w-14 items-center justify-center rounded-[8px] bg-[var(--surface-raised)]">
                                            <ArrowRight size={22} />
                                        </span>
                                        <div className="truncate font-app-body text-[13px] font-light leading-tight text-[var(--ink-primary)]">View all</div>
                                        <div className="truncate font-app-body text-[11px] font-normal text-[var(--ink-tertiary)]">Past runs</div>
                                    </div>
                                    <OpenCue />
                                </Link>
                            </div>
                        )}
                    </HomeSection>
                    </div>

                    {/* Right column — watchlist, always room for two cards. */}
                    <div className="order-2 w-full min-w-0 flex-1 lg:min-w-[464px]">
                        {/* Watchlist — named lists with pill-tab switching */}
                        <WatchlistPanel runs={runs} plugins={plugins} />
                    </div>
                </div>

                {/* Footer */}
                <footer className="py-8 border-t border-[var(--hairline)]">
                    <div className="grid grid-cols-3 gap-6 text-sm">
                        <div>
                            <h3 className="text-xs uppercase tracking-[0.08em] text-[var(--ink-tertiary)] mb-3">Product</h3>
                            <div className="space-y-2 text-[var(--ink-secondary)]">
                                <Link to="/new-run" className="block hover:text-[var(--ink-primary)]">New Run</Link>
                                <Link to="/runs" className="block hover:text-[var(--ink-primary)]">Runs</Link>
                                <Link to="/my-workspace" className="block hover:text-[var(--ink-primary)]">Plugins</Link>
                            </div>
                        </div>
                        <div>
                            <h3 className="text-xs uppercase tracking-[0.08em] text-[var(--ink-tertiary)] mb-3">Company</h3>
                            <div className="space-y-2 text-[var(--ink-secondary)]">
                                <Link to="/privacy" className="block hover:text-[var(--ink-primary)]">Privacy</Link>
                                <Link to="/terms" className="block hover:text-[var(--ink-primary)]">Terms</Link>
                            </div>
                        </div>
                        <div>
                            <h3 className="text-xs uppercase tracking-[0.08em] text-[var(--ink-tertiary)] mb-3">Resources</h3>
                            <div className="space-y-2 text-[var(--ink-secondary)]">
                                <Link to="/my-workspace" className="block hover:text-[var(--ink-primary)]">Workspace</Link>
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
