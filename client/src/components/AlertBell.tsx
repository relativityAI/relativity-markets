import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell } from "lucide-react";
import { AlertService, type AlertRow } from "@/db";
import { TickerLogo } from "@/lib/sourceLogos";
import { cn } from "@/lib/utils";

/** Navbar bell: unread alert count + a dropdown of recent verdicts.
 *  Polls while the tab is visible (same contract as RunWatcher); clicking an
 *  alert marks it read and opens the run it came from. */
export default function AlertBell() {
    const [alerts, setAlerts] = useState<AlertRow[]>([]);
    const [open, setOpen] = useState(false);
    const [fresh, setFresh] = useState(false); // unread arrived since the dropdown closed
    const prevUnreadRef = useRef(0);
    const firstLoadRef = useRef(true);
    const wrapRef = useRef<HTMLDivElement>(null);
    const navigate = useNavigate();

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
            if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener("mousedown", onDown);
        return () => document.removeEventListener("mousedown", onDown);
    }, [open]);

    const unread = alerts.filter((a) => !a.read_at).length;

    const openAlert = (a: AlertRow) => {
        setOpen(false);
        setFresh(false);
        if (!a.read_at) {
            setAlerts((prev) => prev.map((x) => (x.id === a.id ? { ...x, read_at: new Date().toISOString() } : x)));
            prevUnreadRef.current = Math.max(0, prevUnreadRef.current - 1);
            AlertService.markRead(a.id).catch(() => {});
        }
        if (a.run_id) navigate(`/analysis-result/${a.run_id}`);
        else navigate("/analysis-list");
    };

    const markAll = () => {
        setAlerts((prev) => prev.map((a) => ({ ...a, read_at: a.read_at ?? new Date().toISOString() })));
        setFresh(false);
        prevUnreadRef.current = 0;
        AlertService.markAllRead().catch(() => {});
    };

    return (
        <div ref={wrapRef} className="relative">
            <button
                type="button"
                aria-label={unread ? `Alerts, ${unread} unread` : "Alerts"}
                aria-expanded={open}
                aria-haspopup="true"
                onClick={() => {
                    setOpen((o) => !o);
                    setFresh(false);
                }}
                className={cn(
                    "relative cursor-pointer text-[var(--ink-tertiary)] transition-colors hover:text-[var(--ink-primary)]",
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

            {open && (
                <div
                    role="menu"
                    aria-label="Alerts"
                    className="absolute right-0 z-50 mt-2 w-80 overflow-hidden rounded-[10px] border border-[var(--hairline)] bg-[var(--surface-raised)] shadow-lg"
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
                                No alerts yet. An agent's verdict change shows up here.
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
                                        <span className="block truncate font-[family-name:var(--font-body)] text-[13px] text-[var(--ink-primary)]">
                                            {a.share_name || a.symbol}
                                            <span className="text-[var(--ink-tertiary)]"> · {a.verdict}</span>
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
