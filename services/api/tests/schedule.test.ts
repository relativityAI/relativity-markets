import { describe, expect, it } from "vitest";
import {
  dateQualifies,
  dueOccurrence,
  isValidFrequency,
  isValidTime,
  occurrence,
  occurrencesBetween,
  todayInTz,
} from "../schedule.js";

const TZ = "UTC";

describe("schedule validation", () => {
  it("accepts the four frequencies and HH:MM times only", () => {
    for (const f of ["daily", "weekly", "biweekly", "monthly"]) expect(isValidFrequency(f)).toBe(true);
    expect(isValidFrequency("yearly")).toBe(false);
    expect(isValidTime("21:00")).toBe(true);
    expect(isValidTime("9:00")).toBe(false);
    expect(isValidTime("24:00")).toBe(false);
  });
});

describe("dateQualifies", () => {
  // 2026-11-16 is a Monday.
  const start = "2026-11-16";

  it("daily: every day from the start date on", () => {
    expect(dateQualifies("daily", start, "2026-11-16")).toBe(true);
    expect(dateQualifies("daily", start, "2026-11-17")).toBe(true);
    expect(dateQualifies("daily", start, "2026-11-15")).toBe(false);
  });

  it("weekly: same weekday as the start date", () => {
    expect(dateQualifies("weekly", start, "2026-11-23")).toBe(true); // Monday
    expect(dateQualifies("weekly", start, "2026-11-24")).toBe(false); // Tuesday
  });

  it("biweekly: every other week from the start date", () => {
    expect(dateQualifies("biweekly", start, "2026-11-16")).toBe(true); // week 0
    expect(dateQualifies("biweekly", start, "2026-11-23")).toBe(false); // week 1
    expect(dateQualifies("biweekly", start, "2026-11-30")).toBe(true); // week 2
  });

  it("monthly: same day-of-month, months without it skipped", () => {
    expect(dateQualifies("monthly", "2026-01-31", "2026-02-28")).toBe(false); // clamped day ≠ 31
    expect(dateQualifies("monthly", "2026-01-31", "2026-03-31")).toBe(true);
    expect(dateQualifies("monthly", start, "2026-12-16")).toBe(true);
    expect(dateQualifies("monthly", start, "2026-12-17")).toBe(false);
  });
});

describe("dueOccurrence", () => {
  const base = { time: "09:00", timezone: TZ, created_at: "2026-11-16T08:00:00Z" };

  it("daily fires once per day, not before the start date", () => {
    // now = Mon 2026-11-16 10:00 UTC → today's 09:00 already passed.
    const now = Date.parse("2026-11-16T10:00:00Z");
    expect(dueOccurrence({ ...base, frequency: "daily", start_date: "2026-11-16" }, now)).toEqual({
      at: Date.parse("2026-11-16T09:00:00Z"),
      date: "2026-11-16",
    });
    // Start date in the future → nothing due yet.
    expect(dueOccurrence({ ...base, frequency: "daily", start_date: "2026-11-20" }, now)).toBeNull();
  });

  it("weekly: fires on the start date's weekday only", () => {
    // now = Tue 2026-11-17 10:00 UTC; start Monday 11-16 → last Monday qualifies.
    const now = Date.parse("2026-11-17T10:00:00Z");
    expect(dueOccurrence({ ...base, frequency: "weekly", start_date: "2026-11-16" }, now)?.date).toBe("2026-11-16");
    // Already fired that date → the caller's last_fired_date check handles it;
    // here the walk-back still finds the same due date.
    // now before any Monday occurrence after start → none.
    const earlyNow = Date.parse("2026-11-16T08:30:00Z"); // before 09:00 on start Monday
    expect(dueOccurrence({ ...base, frequency: "weekly", start_date: "2026-11-16" }, earlyNow)).toBeNull();
  });

  it("biweekly: due on week 0 and week 2, not week 1", () => {
    const week1 = Date.parse("2026-11-23T10:00:00Z");
    expect(dueOccurrence({ ...base, frequency: "biweekly", start_date: "2026-11-16" }, week1)?.date).toBe("2026-11-16");
    const week2 = Date.parse("2026-11-30T10:00:00Z");
    expect(dueOccurrence({ ...base, frequency: "biweekly", start_date: "2026-11-16" }, week2)?.date).toBe("2026-11-30");
  });

  it("monthly: due on the anchor day-of-month", () => {
    const now = Date.parse("2026-12-20T10:00:00Z");
    expect(dueOccurrence({ ...base, frequency: "monthly", start_date: "2026-11-16" }, now)?.date).toBe("2026-12-16");
  });

  it("respects the created_at floor via the caller check and start_date", () => {
    // Start next Monday from a Tuesday now → nothing due this week.
    const now = Date.parse("2026-11-17T10:00:00Z"); // Tuesday
    expect(dueOccurrence({ ...base, frequency: "weekly", start_date: "2026-11-23" }, now)).toBeNull();
  });
});

describe("occurrencesBetween", () => {
  const rule = { time: "09:00", timezone: TZ, frequency: "weekly", start_date: "2026-11-16", created_at: "2026-11-16T08:00:00Z" };

  it("expands only the qualifying dates inside the window", () => {
    expect(occurrencesBetween(rule, "2026-11-16", "2026-11-29")).toEqual([
      { date: "2026-11-16", at: Date.parse("2026-11-16T09:00:00Z") },
      { date: "2026-11-23", at: Date.parse("2026-11-23T09:00:00Z") },
    ]);
    // Daily: one per day, and never before the start date.
    expect(occurrencesBetween({ ...rule, frequency: "daily", start_date: "2026-11-18" }, "2026-11-16", "2026-11-19").map((o) => o.date)).toEqual([
      "2026-11-18",
      "2026-11-19",
    ]);
    // Tue 12-01 → Sun 12-06: no Monday inside, so nothing qualifies.
    expect(occurrencesBetween(rule, "2026-12-01", "2026-12-06")).toEqual([]);
  });

  it("uses the wall-clock time in the rule's zone", () => {
    const ist = occurrencesBetween({ ...rule, frequency: "daily", timezone: "Asia/Kolkata" }, "2026-11-16", "2026-11-16");
    expect(ist[0].at).toBe(Date.parse("2026-11-16T03:30:00Z")); // 09:00 IST
  });
});

describe("occurrence / todayInTz", () => {
  it("maps wall-clock time in a zone to UTC ms", () => {
    expect(occurrence("2026-11-16", "09:00", TZ)).toBe(Date.parse("2026-11-16T09:00:00Z"));
  });

  it("gives today's date in the zone", () => {
    expect(todayInTz(TZ)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
