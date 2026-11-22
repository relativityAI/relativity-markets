import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import FullCalendar, { type DatesSetInfo, type EventClickInfo, type EventDisplayInfo } from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/react/daygrid";
import timeGridPlugin from "@fullcalendar/react/timegrid";
import themePlugin from "@fullcalendar/react/themes/pulse";
import "@fullcalendar/react/skeleton.css";
import "@fullcalendar/react/themes/pulse/theme.css";
import "@fullcalendar/react/themes/pulse/palettes/blue.css";
import { AnalysisService, PluginService, type AlertRuleRow, type PluginSummary } from "@/db";
import { buildEvents, type EventProps, type Occurrence, type RunRow } from "@/lib/scheduleEvents";
import { verdictInk } from "@/lib/analysisFormat";
import { timeUntil } from "@/lib/relativeTime";
import { TickerLogo } from "@/lib/sourceLogos";
import PluginAvatar from "@/components/shared/PluginAvatar";
import { useColorMode } from "@/components/ui/color-mode";

/** One event block: the two big symbols (plugin avatar + stock logo), then
 *  the verdict with its colour dot — only once a verdict exists. The time
 *  lives on the calendar's own axis; the plugin name and clock time live in
 *  the tooltip. */
function EventChip({ p, title, when }: { p: EventProps; title: string; when: string }) {
    const ink = verdictInk(p.verdict);
    const bg = ink
        ? `color-mix(in srgb, ${ink} 18%, var(--surface-canvas))`
        : p.past
          ? "var(--surface-recessed)"
          : "var(--surface-raised)";
    const dot = ink || "var(--ink-tertiary)";
    const detail = `${title} · ${p.symbol} · ${p.frequency} ${p.time} (${p.tz}) · ${p.verdict || when}`;
    return (
        <div
            title={detail}
            className="flex w-full flex-col items-start gap-1 overflow-hidden rounded-[6px] px-1.5 py-1"
            style={{ background: bg }}
        >
            <span className="flex items-center gap-1">
                <PluginAvatar plugin={p.plugin} size={20} />
                <span className="-ml-2 inline-flex rounded-full" style={{ boxShadow: `0 0 0 1.5px ${bg}` }}>
                    <TickerLogo symbol={p.symbol} size={20} />
                </span>
            </span>
            {p.verdict && (
                <span
                    className="flex items-center gap-1 font-app-body text-[10px] leading-tight font-light"
                    style={{ color: ink || "var(--ink-primary)" }}
                >
                    <span className="size-[5px] shrink-0 rounded-full" style={{ background: dot }} />
                    {p.verdict}
                </span>
            )}
        </div>
    );
}

/** The schedule calendar: Pulse/blue, week grid for the home rail, month
 *  grid for the new-run page. Fetches its own rules, runs and occurrences. */
export default function ScheduleCalendar({ view }: { view: "week" | "month" }) {
    const { colorMode } = useColorMode();
    const navigate = useNavigate();
    const [rules, setRules] = useState<AlertRuleRow[]>([]);
    const [plugins, setPlugins] = useState<PluginSummary[]>([]);
    const [runs, setRuns] = useState<RunRow[]>([]);
    const [occs, setOccs] = useState<Occurrence[]>([]);
    // "now" for the countdowns and the past/future split — set from an effect
    // (render must stay pure) and refreshed every 30s so labels stay honest.
    const [now, setNow] = useState(() => Date.now());

    // Countdowns go stale — refresh the labels every 30s.
    useEffect(() => {
        const t = setInterval(() => setNow(Date.now()), 30_000);
        return () => clearInterval(t);
    }, []);

    // Rules refetch on their own too: every create/delete/enable pokes this
    // event, so a calendar never sits on a stale schedule after a change.
    const loadRules = useCallback(() => {
        AnalysisService.listAlertRules()
            .then((r) => {
                if (Array.isArray(r)) setRules(r);
            })
            .catch(() => {});
    }, []);

    useEffect(() => {
        loadRules();
        window.addEventListener("alert-rules-changed", loadRules);
        return () => window.removeEventListener("alert-rules-changed", loadRules);
    }, [loadRules]);

    useEffect(() => {
        Promise.allSettled([
            PluginService.list(),
            AnalysisService.listAnalyses(),
        ]).then(([p, a]) => {
            if (p.status === "fulfilled" && Array.isArray(p.value)) setPlugins(p.value);
            if (a.status === "fulfilled" && Array.isArray(a.value)) setRuns(a.value);
        });
    }, []);

    // Occurrences for the visible range; a rule's local date can sit a day off
    // the viewer's, so pad one day either side.
    const loadRange = (from: Date, to: Date) => {
        const fmt = (d: Date) =>
            `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        AnalysisService.listOccurrences(fmt(new Date(from.getTime() - 86_400_000)), fmt(to))
            .then(setOccs)
            .catch(() => setOccs([]));
    };

    const events = buildEvents(rules, occs, runs, plugins, now);

    // Time axis (timeGrid): only draw the hours that actually hold a run,
    // padded either side — a full 24h axis would make the rail endless.
    const [slotMin, slotMax] = (() => {
        const hs = events.map((e) => new Date((e.extendedProps as EventProps).at).getHours());
        if (!hs.length) return ["08:00:00", "18:00:00"];
        const lo = Math.max(0, Math.min(...hs) - 2);
        const hi = Math.min(24, Math.max(...hs) + 3);
        return [`${String(lo).padStart(2, "0")}:00:00`, `${String(hi).padStart(2, "0")}:00:00`];
    })();

    const renderEvent = (arg: EventDisplayInfo) => (
        <EventChip
            p={arg.event.extendedProps as unknown as EventProps}
            title={arg.event.title}
            when={timeUntil((arg.event.extendedProps as unknown as EventProps).at)}
        />
    );

    return (
        <FullCalendar
            plugins={[themePlugin, dayGridPlugin, timeGridPlugin]}
            className="rel-cal"
            initialView={view === "week" ? "timeGridWeek" : "dayGridMonth"}
            firstDay={1}
            fixedWeekCount={false}
            dayMaxEvents={2}
            height="auto"
            slotMinTime={slotMin}
            slotMaxTime={slotMax}
            slotDuration="01:00:00"
            defaultTimedEventDuration="02:00:00"
            headerToolbar={{ left: "prev,next", center: "title", right: "today" }}
            colorScheme={colorMode === "dark" ? "dark" : "light"}
            events={events}
            datesSet={(arg: DatesSetInfo) => loadRange(arg.start, arg.end)}
            eventContent={renderEvent}
            eventClick={(arg: EventClickInfo) => {
                const runId = arg.event.extendedProps.runId as string | null;
                navigate(runId ? `/runs/${runId}` : "/new-run");
            }}
        />
    );
}
