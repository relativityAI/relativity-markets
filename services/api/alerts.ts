/**
 * Failure alerts: a run that died is news even though it has no verdict.
 *
 * Kept in its own module (rather than beside evaluateAlert in schedule.ts)
 * because the run writer calls it too, and schedule.ts already imports from
 * runs.ts — one import direction is enough.
 */

import { alertExistsForRun, getRunRow, insertAlertRow } from "../db/repo.js";
import { log } from "./logger.js";

/**
 * A run that ended in ERROR becomes one alert for its owner — scheduled or
 * manual. Deduped on the run id, so the minute-by-minute re-check of the same
 * dead run (and a rule run already reported by schedule.ts) can't stack
 * copies.
 *
 * `ruleId` is absent for manual runs: the column is NOT NULL, so it takes the
 * empty string — nothing joins alerts back to rules.
 */
export async function alertRunFailure(userId: string, runId: string, ruleId?: string): Promise<void> {
  try {
    if (alertExistsForRun(runId)) return;
    const run = await getRunRow(userId, runId);
    if (!run || run.status !== "ERROR") return;
    await insertAlertRow({
      user_id: userId,
      rule_id: ruleId ?? "",
      run_id: runId,
      symbol: run.symbol,
      share_name: run.share_name || run.symbol,
      agent_name: run.agent_name,
      verdict: "Failed",
    });
    log.info("[alerts]", `${run.symbol}: run failed (${run.agent_name || "run"})`);
  } catch (e: any) {
    log.warn("[alerts]", `failure alert failed: ${e?.message || e}`);
  }
}
