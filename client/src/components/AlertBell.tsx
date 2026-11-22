import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { useNavigate } from "react-router-dom";
import { Bell } from "lucide-react";
import { AlertService, type AlertRow } from "@/db";
import { verdictInk } from "@/lib/analysisFormat";
import { TickerLogo } from "@/lib/sourceLogos";
import { cn } from "@/lib/utils";

/** Verdict badge — the tinted pill the homepage alert cards use; the word
 *  carries the outcome, the wash only hints at it. */
function badgeStyle(verdict: string): CSSProperties {
    const ink = verdictInk(verdict) ?? "var(--ink-secondary)";
    return { color: ink, background: `color-mix(in srgb, ${ink} 14%, transparent)` };
}

/** Enter/exit timing of the dropdown (matches the pop-down-in keyframe). */
const ANIM_MS = 160;
/** How long the list outstays the pointer. */
const LINGER_MS = 2000;

/** Navbar bell: unread alert count + a dropdown of recent verdicts.
 *  Polls while the tab is visible (same contract as RunWatcher); clicking an
 *  alert marks it read and opens the run it came from. */
export default function AlertBell() {
    const [alerts, setAlerts] = useState<AlertRow[]>([]);
    const [open, setOpen] = useState(false); // logical state — drives aria-expanded
    const [shown, setShown] = useState(false); // panel in the DOM; outlives `open` for the exit fade
    const [closing, setClosing] = useState(false);
    const [fresh, setFresh] = useState(false); // unread arrived since the dropdown closed
    const prevUnreadRef = useRef(0);
    const firstLoadRef = useRef(true);
    const wrapRef = useRef<HTMLDivElement>(null);
    const lingerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const unmountRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const navigate = useNavigate();

    const clearTimers = () => {
        if (lingerRef.current) clearTimeout(lingerRef.current);
        if (unmountRef.current) clearTimeout(unmountRef.current);
        lingerRef.current = null;
        unmountRef.current = null;
    };

    const openPanel = () => {
        clearTimers();
        setClosing(false);
        setShown(true);
        setOpen(true);
    };

    const closePanel = () => {
        clearTimers();
        if (!open) return;
        setOpen(false);
        setClosing(true);
        unmountRef.current = setTimeout(() => {
            setShown(false);
            setClosing(false);
            unmountRef.current = null;
        }, ANIM_MS);
    };

    // The list lingers a couple of seconds after the pointer wanders off —
    // long enough to notice it going, short enough not to nag. Re-entering
    // the bell or the list cancels the countdown.
    const onLeave = () => {
        if (!open) return;
        lingerRef.current = setTimeout(closePanel, LINGER_MS);
    };
    const onEnter = () => {
        if (lingerRef.current) clearTimeout(lingerRef.current);
        lingerRef.current = null;
    };

    useEffect(() => clearTimers, []);

    const load = useCallback(() => {
        AlertService.listAlerts()
            .then((rows) => {
                const unread = rows.filter((a) => !a.read_at).length;
                // Pulse only for arrivals after the first load (mount isn't news).
                if (!firstLoadRef.current && unread > prevUnreadRef.current) setFresh(true);
                firstLoadRef.current = false;
                prevUnreadRef.current = unread;
                setAlerts(rows);
            })
            .catch(() => {});
    }, []);

    useEffect(() => {
        load();
        const id = setInterval(() => {
            if (!document.hidden) load();
        }, 30_000);
        return () => clearInterval(id);
    }, [load]);

    useEffect(() => {
        if (!open) return;
        const onDown = (e: MouseEvent) => {
            if (!wrapRef.current?.contains(e.target as Node)) closePanel();
        };
        document.addEventListener("mousedown", onDown);
        return () => document.removeEventListener("mousedown", onDown);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    const unread = alerts.filter((a) => !a.read_at).length;

    const openAlert = (a: AlertRow) => {
        closePanel();
        setFresh(false);
        if (!a.read_at) {
            setAlerts((prev) => prev.map((x) => (x.id === a.id ? { ...x, read_at: new Date().toISOString() } : x)));
            prevUnreadRef.current = Math.max(0, prevUnreadRef.current - 1);
            AlertService.markRead(a.id).catch(() => {});
        }
        if (a.run_id) navigate(`/runs/${a.run_id}`);
        else navigate("/runs");
    };

    const markAll = () => {
        setAlerts((prev) => prev.map((a) => ({ ...a, read_at: a.read_at ?? new Date().toISOString() })));
        setFresh(false);
        prevUnreadRef.current = 0;
        AlertService.markAllRead().catch(() => {});
    };

    return (
        // `relative` (not flex): an absolutely positioned child of a flex box
        // centres itself on the box instead of hanging below it — which is
        // what put the list off the top of the screen. The button is `block`
        // for the same reason a lone inline icon drifts up on its baseline.
        <div ref={wrapRef} className="relative" onMouseEnter={onEnter} onMouseLeave={onLeave}>
            <button
                type="button"
                aria-label={unread ? `Alerts, ${unread} unread` : "Alerts"}
                aria-expanded={open}
                aria-haspopup="true"
                onClick={() => {
                    if (open) closePanel();
                    else openPanel();
                    setFresh(false);
                }}
                className={cn(
                    "relative block cursor-pointer text-[var(--ink-tertiary)] transition-colors hover:text-[var(--ink-primary)]",
                    fresh && !open && "text-[var(--ink-primary)]",
                )}
            >
                <Bell size={18} />
                {unread > 0 && (
                    <span
                        aria-hidden
                        className="absolute -top-1 -right-1.5 grid h-4 min-w-4 place-items-center rounded-full px-1 font-[family-name:var(--font-body)] text-[10px] leading-none font-medium text-white"
                        style={{ background: "var(--signal-negative)" }}
                    >
                        {unread > 9 ? "9+" : unread}
                    </span>
                )}
            </button>

            {shown && (
                <div
                    role="menu"
                    aria-label="Alerts"
                    className={cn(
                        // Fluid width: full 320px where it fits, and pulled in
                        // before the bell's left edge on a phone, where the
                        // list would otherwise hang off the left of the screen.
                        // 10rem = the bell's offset from the screen edge on a
                        // phone (row padding + the two touch-sized icons + gaps)
                        // plus a 16px margin, so the list never clips.
                        "absolute right-0 z-50 mt-2 w-[min(20rem,calc(100vw_-_10rem))] overflow-hidden rounded-[10px] border border-[var(--hairline)] bg-[var(--surface-raised)] shadow-lg",
                        "animate-[pop-down-in_160ms_ease-out] transition-[opacity,transform] duration-150 ease-out",
                        closing ? "pointer-events-none opacity-0 -translate-y-1 scale-[0.98]" : "opacity-100",
                    )}
                >
                    <div className="flex items-center justify-between border-b border-[var(--hairline)] px-3.5 py-2.5">
                        <span className="font-[family-name:var(--font-body)] text-[13px] font-medium text-[var(--ink-primary)]">
                            Alerts
                        </span>
                        {unread > 0 && (
                            <button
                                type="button"
                                onClick={markAll}
                                className="cursor-pointer font-[family-name:var(--font-body)] text-[12px] text-[var(--ink-tertiary)] transition-colors hover:text-[var(--ink-primary)]"
                            >
                                Mark all read
                            </button>
                        )}
                    </div>
                    <div className="max-h-80 overflow-y-auto">
                        {alerts.length === 0 ? (
                            <p className="px-3.5 py-6 text-center font-[family-name:var(--font-body)] text-[13px] text-[var(--ink-tertiary)]">
                                No alerts yet. A verdict change or a failed run shows up here.
                            </p>
                        ) : (
                            alerts.slice(0, 20).map((a) => (
                                <button
                                    key={a.id}
                                    type="button"
                                    role="menuitem"
                                    onClick={() => openAlert(a)}
                                    className="flex w-full cursor-pointer items-center gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-[var(--surface-recessed)]"
                                >
                                    <span
                                        aria-hidden
                                        className={cn(
                                            "h-1.5 w-1.5 shrink-0 rounded-full",
                                            a.read_at ? "bg-transparent" : "bg-[var(--signal-negative)]",
                                        )}
                                    />
                                    <TickerLogo symbol={a.symbol} size={26} />
                                    <span className="min-w-0 flex-1">
                                        <span className="flex items-center gap-1.5">
                                            <span className="truncate font-[family-name:var(--font-body)] text-[13px] text-[var(--ink-primary)]">
                                                {a.share_name || a.symbol}
                                            </span>
                                            <span
                                                className="shrink-0 rounded-full px-1.5 py-px font-[family-name:var(--font-body)] text-[11px] font-medium"
                                                style={badgeStyle(a.verdict)}
                                            >
                                                {a.verdict}
                                            </span>
                                        </span>
                                        <span className="block truncate font-[family-name:var(--font-body)] text-[11px] text-[var(--ink-tertiary)]">
                                            {a.agent_name || "Agent"} · {timeAgo(a.created_at)}
                                        </span>
                                    </span>
                                </button>
                            ))
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

function timeAgo(dateStr: string): string {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60_000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return new Date(dateStr).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
