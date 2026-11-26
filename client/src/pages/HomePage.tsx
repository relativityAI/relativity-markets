import { useEffect, useRef, useState, type ReactNode, type ComponentType } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Clock, Play, ArrowRight } from "lucide-react";
import { AnalysisService, API_BASE, PluginService, type AlertRuleRow, type PluginSummary } from "@/db";
import sp500Logo from "@/assets/indices/s-and-p-500.svg";
import nasdaq100Logo from "@/assets/indices/nasdaq-100.svg";
import sensexLogo from "@/assets/indices/bse-sensex.svg";
import ScheduleCalendar from "@/components/ScheduleCalendar";
import WatchlistPanel from "@/components/WatchlistPanel";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useColorMode } from "@/components/ui/color-mode";

/** Page-title combo: light, large Anek Latin (same as the workspace pages). */
const SECTION_TITLE = "font-app-body text-[20px] leading-none font-light tracking-tight text-console-ink";

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

function HomeSection({ title, sub, children, empty, emptyTo, emptyIcon, emptyLabel }: {
    title: string; sub?: string; children: ReactNode; empty: boolean; emptyTo: string; emptyIcon: ComponentType<{ size?: number }>; emptyLabel: string;
}) {
    return (
        <section>
            <h2 className={SECTION_TITLE}>{title}</h2>
            {sub && <p className="mt-1.5 font-app-body text-[12px] font-light text-console-ink-3">{sub}</p>}
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
            {/* No pill: the shadcn default (bg-muted / border / p-1) is
                overridden so the buttons sit on the canvas, and the selected
                chip uses the watchlist's own bg-console-surface. */}
            <ToggleGroup
                type="single"
                value={source}
                onValueChange={(v) => { if (v) setSource(v); }}
                aria-label="Heatmap index"
                className="flex h-auto gap-1 border-0 bg-transparent p-0"
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
    const [runs, setRuns] = useState<any[]>([]);
    const [plugins, setPlugins] = useState<PluginSummary[]>([]);
    const navigate = useNavigate();

    // The CTA's "N" hint has to be true: press N anywhere outside a field.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key.toLowerCase() !== "n" || e.metaKey || e.ctrlKey || e.altKey) return;
            const t = e.target as HTMLElement | null;
            if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
            navigate("/new-run");
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [navigate]);

    useEffect(() => {
        Promise.allSettled([
            AnalysisService.listAlertRules(),
            AnalysisService.listAnalyses(),
            PluginService.list(),
        ]).then(([s, r, a]) => {
            if (s.status === "fulfilled" && Array.isArray(s.value)) setAlertRules(s.value);
            if (r.status === "fulfilled" && Array.isArray(r.value)) setRuns(r.value);
            if (a.status === "fulfilled" && Array.isArray(a.value)) setPlugins(a.value);
        });
    }, []);

    return (
        <div className="min-h-full bg-[var(--surface-canvas)] text-[var(--ink-primary)]">
            <div>
                {/* Two columns: the market heatmap on the left, watchlist
                    (min two cards wide) + the week's schedule below it on
                    the right. Below lg they stack in reading order. */}
                <div className="flex flex-wrap items-start gap-x-10 gap-y-10 pt-7">
                    {/* ponytail: fixed left rail — the heatmap's width;
                        the watchlist is the main item, so the rail gives up
                        width to the right column. */}
                    <div className="order-1 flex w-full flex-col gap-12 pb-12 lg:w-[360px] lg:shrink-0 xl:w-[380px]">
                        <HeatmapPanel />
                    </div>

                    {/* Right column — watchlist, always room for two cards,
                        with the week's schedule beneath it. */}
                    <div className="order-2 flex w-full min-w-0 flex-col gap-12 pb-12 lg:min-w-[464px] lg:flex-1">
                        {/* The one thing to do on landing: start a run. Big,
                            glowing, first in the reading path. */}
                        <Link
                            to="/new-run"
                            className="rel-run-cta group flex h-24 w-full items-center gap-4 rounded-[14px] border border-[var(--hairline)] bg-[var(--surface-raised)] px-6 text-[var(--ink-primary)] transition-colors hover:bg-[var(--surface-raised-hover)]"
                        >
                            <span className="rel-cta-chip flex size-12 shrink-0 items-center justify-center rounded-full bg-[var(--signal-live)] text-white">
                                <Play size={22} fill="currentColor" />
                            </span>
                            <span className="flex min-w-0 flex-col">
                                <span className="font-app-body text-[24px] leading-none font-light tracking-tight">
                                    New run
                                </span>
                                <span className="mt-1.5 font-app-body text-[13px] font-light text-[var(--ink-secondary)]">
                                    Put an agent on a ticker — scan, analyze, decide.
                                </span>
                            </span>
                            <ArrowRight
                                size={22}
                                aria-hidden="true"
                                className="ml-auto shrink-0 text-[var(--ink-tertiary)] transition-transform duration-200 group-hover:translate-x-1 group-hover:text-[var(--ink-primary)]"
                            />
                        </Link>

                        {/* Watchlist — named lists with pill-tab switching */}
                        <WatchlistPanel runs={runs} plugins={plugins} />

                        {/* Scheduled runs — the week's occurrences on a grid */}
                        <HomeSection
                            title="This week"
                            sub="Every scheduled check due in the next seven days."
                            empty={alertRules.length === 0}
                            emptyTo="/new-run"
                            emptyIcon={Clock}
                            emptyLabel="Set up an alert"
                        >
                            <ScheduleCalendar view="week" />
                        </HomeSection>
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
