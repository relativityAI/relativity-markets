/**
 * Alert ticker: computes when a wall-clock time in an IANA timezone last
 * occurred (DST-safe, stdlib Intl only) and fires due alert rules once per
 * local day, then turns completed runs into alerts.
 *
 * Frequencies: daily fires every day; weekly / biweekly fire on the start
 * date's weekday (biweekly on alternating weeks from the start date); monthly
 * on the start date's day-of-month (months without that day are skipped).
 * The per-local-date claim (last_fired_date) dedupes all of them — every due
 * date is a distinct calendar day, so one fire per date is one fire per due
 * occurrence.
 *
 * Alerts: after a fire, the rule remembers its run id; each tick checks that
 * run and, once it COMPLETED with a verdict, records an alert — but only when
 * the verdict differs from the rule's last alert (dedupe: no ping for an
 * unchanged verdict). A run that ERRORs records a "Failed" alert instead
 * (deduped on the run id) — see alertRunFailure, which the run writer also
 * calls directly so manual runs reach the bell too.
 *
 * The ticker runs in-process like the stale-run sweeper — nothing survives a
 * restart beyond `last_fired_date` (one catch-up fire on boot). ponytail:
 * whole missed occurrences are skipped; if that ever matters, drive `tick()`
 * from an external cron hitting an internal HTTP trigger.
 */

import {
  listAllAlertRuleRows,
  claimAlertRule,
  setAlertRuleRun,
  insertAlertRow,
  lastAlertVerdict,
  getRunRow,
  type AlertRuleRow,
} from "../db/repo.js";
import { alertRunFailure } from "./alerts.js";
import { log } from "./logger.js";
import { startAnalysisRun } from "./runs.js";

const TICK_MS = 60_000;

export const FREQUENCIES = ["daily", "weekly", "biweekly", "monthly"] as const;
export type Frequency = (typeof FREQUENCIES)[number];

export function isValidFrequency(f: string): boolean {
  return (FREQUENCIES as readonly string[]).includes(f);
}

export function isValidTime(t: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const dtfCache = new Map<string, Intl.DateTimeFormat>();

function partsInTz(utcMs: number, tz: string): Record<string, number> {
  let f = dtfCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    dtfCache.set(tz, f);
  }
  const out: Record<string, number> = {};
  for (const p of f.formatToParts(new Date(utcMs))) {
    if (p.type !== "literal") out[p.type] = Number(p.value);
  }
  return out;
}

/** UTC ms for `localDate` ("YYYY-MM-DD") at wall-clock `hh:mm` in `tz`.
 *  Two offset passes: guess as UTC, measure the real offset, correct — keeps
 *  21:00 local at 21:00 across DST transitions. */
export function occurrence(localDate: string, hhmm: string, tz: string): number {
  const [y, m, d] = localDate.split("-").map(Number);
  const [hh, mm] = hhmm.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const p1 = partsInTz(guess, tz);
  const off1 = Date.UTC(p1.year, p1.month - 1, p1.day, p1.hour, p1.minute, p1.second) - guess;
  const t1 = guess - off1;
  const p2 = partsInTz(t1, tz);
  const off2 = Date.UTC(p2.year, p2.month - 1, p2.day, p2.hour, p2.minute, p2.second) - t1;
  return guess - off2;
}

function dateInTz(utcMs: number, tz: string): string {
  const p = partsInTz(utcMs, tz);
  return `${String(p.year).padStart(4, "0")}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** Today's local date ("YYYY-MM-DD") in `tz` — the default schedule start. */
export function todayInTz(tz: string): string {
  return dateInTz(Date.now(), tz);
}

function prevDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) - 86_400_000).toISOString().slice(0, 10);
}

/** Parse "YYYY-MM-DD" → UTC-midnight Date (weekday/month math only). */
function parseDate(date: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** Does `date` qualify for this schedule's recurrence anchored at `start`? */
export function dateQualifies(frequency: string, start: string, date: string): boolean {
  if (date < start) return false;
  if (frequency === "daily") return true;
  const s = parseDate(start);
  const d = parseDate(date);
  if (frequency === "weekly") return d.getUTCDay() === s.getUTCDay();
  if (frequency === "biweekly") {
    const weeks = Math.floor((d.getTime() - s.getTime()) / (7 * 86_400_000));
    return d.getUTCDay() === s.getUTCDay() && weeks % 2 === 0;
  }
  // monthly: same day-of-month; months without it (e.g. Feb 31) are skipped.
  return d.getUTCDate() === s.getUTCDate();
}

/** Every qualifying occurrence whose local date falls in `[from, to]`
 *  (YYYY-MM-DD, inclusive) — the calendar views expand a rule themselves
 *  instead of re-implementing the recurrence rules client-side. */
export function occurrencesBetween(
  s: Pick<AlertRuleRow, "time" | "timezone" | "frequency" | "start_date" | "created_at">,
  from: string,
  to: string,
): { date: string; at: number }[] {
  const start = s.start_date || dateInTz(+new Date(s.created_at || 0) || Date.now(), s.timezone);
  const out: { date: string; at: number }[] = [];
  const last = +new Date(`${to}T00:00:00Z`);
  for (let t = +new Date(`${from}T00:00:00Z`); t <= last; t += 86_400_000) {
    const date = new Date(t).toISOString().slice(0, 10);
    if (dateQualifies(s.frequency || "daily", start, date)) {
      out.push({ date, at: occurrence(date, s.time, s.timezone) });
    }
  }
  return out;
}

/** Most recent qualifying occurrence at or before `now`, or null when none of
 *  the candidates (walk-back capped at ~11 weeks, the monthly worst case) is
 *  on or after the start date. */
export function dueOccurrence(
  s: Pick<AlertRuleRow, "time" | "timezone" | "frequency" | "start_date" | "created_at">,
  now: number,
): { at: number; date: string } | null {
  const start = s.start_date || dateInTz(+new Date(s.created_at || 0) || now, s.timezone);
  const latest = latestOccurrence(s.time, s.timezone, now);
  let date = latest.date;
  for (let i = 0; i < 80; i++) {
    if (date < start) return null;
    if (dateQualifies(s.frequency || "daily", start, date)) {
      const at = occurrence(date, s.time, s.timezone);
      return at <= now ? { at, date } : null;
    }
    date = prevDate(date);
  }
  return null;
}

/** Most recent occurrence of `hhmm` in `tz` at or before `now`, with its
 *  local date (the dedupe key). Candidates: today's and yesterday's wall day. */
export function latestOccurrence(
  hhmm: string,
  tz: string,
  now: number,
): { at: number; date: string } {
  const today = dateInTz(now, tz);
  const yest = prevDate(today);
  const todayAt = occurrence(today, hhmm, tz);
  return todayAt <= now
    ? { at: todayAt, date: today }
    : { at: occurrence(yest, hhmm, tz), date: yest };
}

/** The run a rule fired → an alert once its verdict lands and changes.
 *  Re-checked every tick until the verdict arrives; after an alert it
 *  short-circuits on the unchanged-verdict dedupe. ponytail: a run whose
 *  background grade never lands is re-looked-up once a minute forever —
 *  one indexed row read, cheaper than tracking give-up state. */
export async function evaluateAlert(s: AlertRuleRow): Promise<void> {
  if (!s.last_run_id) return;
  const run = await getRunRow(s.user_id, s.last_run_id);
  if (!run) return; // run purged; the next fire overwrites last_run_id
  // A dead run has no verdict coming, but it is still news — one "Failed"
  // alert, so the bell counts it instead of silently dropping it.
  if (run.status === "ERROR") {
    await alertRunFailure(s.user_id, run.id, s.id);
    return;
  }
  if (run.status !== "COMPLETED") return; // running or paused — no verdict coming
  const verdict = typeof (run.report as any)?.verdict === "string" ? ((run.report as any).verdict as string) : null;
  if (!verdict) return; // background grade hasn't landed yet
  if (lastAlertVerdict(s.id) === verdict) return; // unchanged — no new development
  await insertAlertRow({
    user_id: s.user_id,
    rule_id: s.id,
    run_id: run.id,
    symbol: run.symbol,
    share_name: run.share_name || s.share_name,
    agent_name: run.agent_name,
    verdict,
  });
  log.info("[alerts]", `${s.symbol}: ${verdict} (${run.agent_name})`);
}

async function tick(): Promise<void> {
  try {
    const rules = await listAllAlertRuleRows();
    const now = Date.now();
    for (const s of rules) {
      // Alerts only for enabled rules — paused rules neither fire nor alert.
      if (!s.enabled) continue;
      const due = dueOccurrence(s, now);
      if (due && due.at >= +new Date(s.created_at) && !(s.last_fired_date && s.last_fired_date >= due.date)) {
        // Atomic claim: only one tick may win a given local day.
        if (claimAlertRule(s.id, due.date)) {
          log.info("[alerts]", `firing ${s.symbol} @ ${s.time} ${s.timezone}`);
          startAnalysisRun({
            userId: s.user_id,
            symbol: s.symbol,
            source: s.source,
            pluginIds: s.plugin_ids?.length ? s.plugin_ids : undefined,
            skillIds: s.skill_ids?.length ? s.skill_ids : undefined,
            model: s.model || undefined,
            systemPrompt: s.system_prompt || undefined,
            budget: {
              ...(s.max_steps ? { maxSteps: s.max_steps } : {}),
              ...(s.max_tokens ? { maxTokens: s.max_tokens } : {}),
            },
          })
            .then((runId) => setAlertRuleRun(s.id, runId))
            .catch((e: any) => log.warn("[alerts]", `fire failed: ${e?.message || e}`));
        }
      }
      await evaluateAlert(s).catch((e: any) => log.warn("[alerts]", `evaluate failed: ${e?.message || e}`));
    }
  } catch (e: any) {
    log.warn("[alerts]", `tick error: ${e?.message || e}`);
  }
}

/** Boot + periodic calls used by the server's listen callback. */
export function startAlertTicker(): void {
  void tick();
  setInterval(() => void tick(), TICK_MS).unref?.();
}
