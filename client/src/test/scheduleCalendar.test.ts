import { describe, expect, it } from "vitest";
import { buildEvents } from "@/lib/scheduleEvents";
import { timeUntil } from "@/lib/relativeTime";

const rule = {
    id: "r1",
    enabled: 1,
    symbol: "NVDA",
    share_name: "NVIDIA",
    source: "SEC",
    plugin_ids: ["chartist"],
    time: "09:00",
    timezone: "UTC",
    frequency: "daily",
    start_date: "2026-11-16",
    last_run_id: null,
    agent_id: null,
    model: null,
    system_prompt: null,
    skill_ids: null,
    max_steps: null,
    max_tokens: null,
    last_fired_date: null,
    created_at: "2026-11-16T08:00:00Z",
} as any;

const plugins = [{ id: "chartist", display_name: "Chartist" }] as any;

describe("buildEvents", () => {
    it("carries the latest same-day run's verdict and id onto the occurrence", () => {
        const occs = [{ rule_id: "r1", date: "2026-11-16", at: Date.parse("2026-11-16T09:00:00Z") }];
        const runs = [
            { id: "run9", symbol: "NVDA", plugin_ids: ["chartist"], verdict: "Strong", created_at: "2026-11-16T09:20:00Z" },
            { id: "run8", symbol: "NVDA", plugin_ids: ["chartist"], verdict: "Weak", created_at: "2026-11-16T09:05:00Z" },
            { id: "run7", symbol: "NVDA", plugin_ids: ["chartist"], verdict: "Sell", created_at: "2026-11-15T09:05:00Z" },
        ];
        const [ev] = buildEvents([rule], occs, runs, plugins, Date.parse("2026-11-16T12:00:00Z"));
        expect(ev.start).toBe("2026-11-16T09:00:00.000Z"); // timed, so FC renders a time
        expect(ev.allDay).toBe(false);
        expect(ev.title).toBe("Chartist");
        expect(ev.extendedProps!.verdict).toBe("Strong");
        expect(ev.extendedProps!.runId).toBe("run9");
        expect(ev.extendedProps!.past).toBe(true);
    });

    it("leaves an upcoming occurrence bare", () => {
        const occs = [{ rule_id: "r1", date: "2026-11-17", at: Date.parse("2026-11-17T09:00:00Z") }];
        const [ev] = buildEvents([rule], occs, [], plugins, Date.parse("2026-11-16T12:00:00Z"));
        expect(ev.extendedProps!.verdict).toBe("");
        expect(ev.extendedProps!.runId).toBeNull();
        expect(ev.extendedProps!.past).toBe(false);
    });

    it("drops occurrences whose rule is gone", () => {
        expect(buildEvents([], [{ rule_id: "gone", date: "2026-11-16", at: 0 }], [], [])).toHaveLength(0);
    });
});

describe("timeUntil", () => {
    const now = Date.parse("2026-11-16T12:00:00Z");

    it("counts down and back in the smallest honest unit", () => {
        expect(timeUntil(now + 45 * 60000, now)).toBe("in 45m");
        expect(timeUntil(now + 3 * 3600000, now)).toBe("in 3h");
        expect(timeUntil(now + 2 * 86400000, now)).toBe("in 2d");
        expect(timeUntil(now - 90 * 60000, now)).toBe("1h ago");
        expect(timeUntil(now + 20000, now)).toBe("now");
        expect(timeUntil(now - 20000, now)).toBe("now");
        expect(timeUntil("nonsense")).toBe("");
    });
});
