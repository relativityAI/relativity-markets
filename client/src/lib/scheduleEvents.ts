import type { EventInput } from "@fullcalendar/react";
import { runPluginLabel, type AlertRuleRow, type PluginSummary } from "@/db";

/** One due date of one rule: the rule-local date, and its UTC instant. */
export type Occurrence = { rule_id: string; date: string; at: number };

/** The run fields the calendar matches on. */
export type RunRow = {
    id?: string;
    analysis_id?: string;
    symbol?: string;
    plugin_ids?: string[];
    verdict?: string;
    status?: string;
    created_at: string;
};

/** What each event carries to the chip renderer. */
export type EventProps = {
    at: number;
    past: boolean;
    verdict: string;
    runId: string | null;
    symbol: string;
    plugin: string | null;
    frequency: string;
    time: string;
    tz: string;
};

/** "YYYY-MM-DD" of an instant as seen in `tz` — how a run is matched to the
 *  occurrence it fired from. en-CA formats dates as YYYY-MM-DD. */
function localDate(iso: string, tz: string): string {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(
        new Date(iso),
    );
}

/** Occurrences → calendar events. An occurrence that already ran carries the
 *  verdict of the same-symbol, same-day run on the rule's plugins (the match
 *  the old scheduled-run cards did) plus its id, so a click opens the result. */
export function buildEvents(
    rules: AlertRuleRow[],
    occurrences: Occurrence[],
    runs: RunRow[],
    plugins: PluginSummary[],
    now: number = Date.now(),
): EventInput[] {
    const out: EventInput[] = [];
    for (const o of occurrences) {
        const rule = rules.find((r) => r.id === o.rule_id);
        if (!rule) continue;
        const run =
            runs
                .filter(
                    (r) =>
                        r.symbol === rule.symbol &&
                        (!rule.plugin_ids?.length ||
                            (r.plugin_ids || []).some((p) => rule.plugin_ids?.includes(p))) &&
                        localDate(r.created_at, rule.timezone) === o.date,
                )
                .sort((x, y) => +new Date(y.created_at) - +new Date(x.created_at))[0] || null;
        const verdict = run ? run.verdict || (run.status === "ERROR" ? "Failed" : "") : "";
        const props: EventProps = {
            at: o.at,
            past: o.at < now,
            verdict,
            runId: run ? run.id || run.analysis_id || null : null,
            symbol: rule.symbol,
            plugin: rule.plugin_ids?.[0] || null,
            frequency: rule.frequency,
            time: rule.time,
            tz: rule.timezone,
        };
        out.push({
            id: `${o.rule_id}:${o.date}`,
            // Timed, not all-day: FullCalendar only renders a time for timed
            // events, and this instant is when the rule actually fires.
            start: new Date(o.at).toISOString(),
            allDay: false,
            title: runPluginLabel(rule.plugin_ids, plugins, null) || "Scheduled run",
            extendedProps: props,
        });
    }
    return out;
}
