/**
 * SQLite data access for every Supabase-shaped table the app used (agents,
 * skills, schedules, analysis_runs, stock_pulls, api_usage, builder_sessions).
 * JSON columns are TEXT here and parsed/stringified at this seam so callers
 * see the same shapes the Supabase client returned.
 */
import { randomUUID } from "node:crypto";
import type { SQLInputValue } from "node:sqlite";
import { getSqlite, fromJson, toJson } from "./sqlite.js";
import type { AgentRow } from "../harness/agentstore.js";

const now = () => new Date().toISOString();

/** node:sqlite's prepared-statement param type — object entries go through this. */
const sqlVal = (v: unknown): SQLInputValue => v as SQLInputValue;

// ── Agents ──────────────────────────────────────────────────────────────────

const AGENT_JSON_COLS = ["persona", "configuration", "asset_evaluation", "macro_evaluation"] as const;

function agentRowOut(r: any): AgentRow {
  const row = { ...r } as Record<string, unknown>;
  for (const c of AGENT_JSON_COLS) row[c] = fromJson(row[c], {});
  return row as unknown as AgentRow;
}

function agentRowIn(row: Record<string, any>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (v === undefined) continue;
    out[k] = (AGENT_JSON_COLS as readonly string[]).includes(k) ? toJson(v) : v;
  }
  return out;
}

export async function listAgentRows(userId: string): Promise<AgentRow[]> {
  const rows = getSqlite().prepare("SELECT * FROM agents WHERE user_id = ? ORDER BY created_at ASC").all(userId);
  return rows.map(agentRowOut);
}

export async function getAgentRow(userId: string, id: string): Promise<AgentRow | null> {
  const r = getSqlite().prepare("SELECT * FROM agents WHERE user_id = ? AND id = ?").get(userId, id) as any;
  return r ? agentRowOut(r) : null;
}

/** Name-or-id lookup shared by the analysis orchestrators (agentstore.loadAgent). */
export async function getAgentRowByNameOrId(userId: string, nameOrId: string): Promise<AgentRow | null> {
  const r = getSqlite()
    .prepare("SELECT * FROM agents WHERE user_id = ? AND (name = ? OR id = ?) LIMIT 1")
    .get(userId, nameOrId, nameOrId) as any;
  return r ? agentRowOut(r) : null;
}

export async function searchAgentRows(userId: string, q: string): Promise<AgentRow[]> {
  const rows = getSqlite()
    .prepare("SELECT * FROM agents WHERE user_id = ? AND lower(name) LIKE '%' || lower(?) || '%' LIMIT 25")
    .all(userId, q);
  return rows.map(agentRowOut);
}

export async function insertAgentRow(row: Record<string, any>): Promise<void> {
  const r = agentRowIn(row);
  const cols = Object.keys(r);
  getSqlite()
    .prepare(`INSERT OR REPLACE INTO agents (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`)
    .run(...cols.map((c) => sqlVal(r[c])));
}

export async function updateAgentRow(userId: string, id: string, patch: Record<string, any>): Promise<void> {
  const r = agentRowIn(patch);
  const cols = Object.keys(r);
  if (!cols.length) return;
  const sets = cols.map((c) => (c === "created_at" ? "created_at = created_at" : `${c} = ?`));
  const vals = cols.filter((c) => c !== "created_at").map((c) => sqlVal(r[c]));
  getSqlite()
    .prepare(`UPDATE agents SET ${sets.join(", ")} WHERE id = ? AND user_id = ?`)
    .run(...vals, id, userId);
}

export async function deleteAgentRow(userId: string, id: string): Promise<void> {
  getSqlite().prepare("DELETE FROM agents WHERE id = ? AND user_id = ?").run(id, userId);
}

// ── Skills (custom, per-user) ───────────────────────────────────────────────

export interface SkillRow {
  id: string;
  user_id: string;
  skill_id: string;
  markdown: string;
  files?: Record<string, string> | null;
  created_at?: string;
  updated_at?: string;
}

function skillRowOut(r: any): SkillRow {
  return { ...r, files: fromJson(r.files, {}) as Record<string, string> };
}

export async function listSkillRows(userId: string): Promise<SkillRow[]> {
  return getSqlite().prepare("SELECT * FROM skills WHERE user_id = ? ORDER BY created_at ASC").all(userId).map(skillRowOut);
}

export async function getSkillRow(userId: string, skillId: string): Promise<SkillRow | null> {
  const r = getSqlite().prepare("SELECT * FROM skills WHERE user_id = ? AND skill_id = ?").get(userId, skillId) as any;
  return r ? skillRowOut(r) : null;
}

export async function upsertSkillRow(userId: string, skillId: string, markdown: string, files?: Record<string, string>): Promise<void> {
  const existing = await getSkillRow(userId, skillId);
  const row = {
    id: existing?.id || randomUUID(),
    user_id: userId,
    skill_id: skillId,
    markdown,
    files: files ? toJson({ ...files, "SKILL.md": markdown }) : toJson(existing?.files ?? {}),
    created_at: existing?.created_at || now(),
    updated_at: now(),
  };
  const cols = Object.keys(row);
  getSqlite()
    .prepare(`INSERT OR REPLACE INTO skills (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`)
    .run(...cols.map((c) => (row as Record<string, unknown>)[c] as SQLInputValue));
}

export async function deleteSkillRow(userId: string, skillId: string): Promise<void> {
  getSqlite().prepare("DELETE FROM skills WHERE user_id = ? AND skill_id = ?").run(userId, skillId);
}

// ── Analysis runs ───────────────────────────────────────────────────────────

const RUN_JSON_COLS = ["report", "trace", "workspace", "skill_outputs", "market_snapshot"] as const;

export interface RunRow {
  id: string;
  user_id: string;
  status: string | null;
  symbol: string;
  share_name: string;
  agent_name: string;
  model: string | null;
  source: string | null;
  run_mode?: string | null;
  skill_id?: string | null;
  skill_ids?: string[] | null;
  system_prompt?: string | null;
  report?: Record<string, unknown> | null;
  trace?: unknown[] | null;
  workspace?: Record<string, string> | null;
  skill_outputs?: unknown[] | null;
  market_snapshot?: Record<string, unknown> | null;
  duration?: number | null;
  error?: string | null;
  total_score?: number | null;
  quantitative_score?: number | null;
  qualitative_score?: number | null;
  fit_low?: number | null;
  fit_high?: number | null;
  coverage?: number | null;
  started_at?: string | null;
  created_at?: string;
  updated_at?: string;
  /** List summaries only: the report's verdict extracted via json_extract. */
  verdict?: Record<string, unknown> | null;
  [k: string]: unknown;
}

function runRowOut(r: any): RunRow {
  const row = { ...r } as Record<string, unknown>;
  for (const c of RUN_JSON_COLS) row[c] = fromJson(row[c], null);
  row.skill_ids = fromJson(row.skill_ids, null);
  return row as RunRow;
}

function runRowIn(row: Record<string, any>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (v === undefined) continue;
    out[k] = ((RUN_JSON_COLS as readonly string[]).includes(k) || k === "skill_ids") && v != null ? toJson(v) : v;
  }
  return out;
}

export async function insertRunRow(row: Record<string, any>): Promise<void> {
  const r = runRowIn(row);
  if (!r.created_at) r.created_at = now();
  if (!r.updated_at) r.updated_at = r.created_at as string;
  const cols = Object.keys(r);
  getSqlite()
    .prepare(`INSERT OR REPLACE INTO analysis_runs (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`)
    .run(...cols.map((c) => sqlVal(r[c])));
}

export async function updateRunRow(id: string, patch: Record<string, any>): Promise<void> {
  const r = runRowIn(patch);
  r.updated_at = r.updated_at as string || now();
  const cols = Object.keys(r);
  if (!cols.length) return;
  getSqlite()
    .prepare(`UPDATE analysis_runs SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`)
    .run(...cols.map((c) => sqlVal(r[c])), id);
}

export async function updateRunRowForUser(userId: string, id: string, patch: Record<string, any>): Promise<void> {
  const r = runRowIn(patch);
  r.updated_at = r.updated_at as string || now();
  const cols = Object.keys(r);
  if (!cols.length) return;
  getSqlite()
    .prepare(`UPDATE analysis_runs SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE id = ? AND user_id = ?`)
    .run(...cols.map((c) => sqlVal(r[c])), id, userId);
}

export async function getRunRow(userId: string, id: string): Promise<RunRow | null> {
  const r = getSqlite().prepare("SELECT * FROM analysis_runs WHERE id = ? AND user_id = ?").get(id, userId) as any;
  return r ? runRowOut(r) : null;
}

export async function listRunRows(userId: string): Promise<RunRow[]> {
  return getSqlite().prepare("SELECT * FROM analysis_runs WHERE user_id = ?").all(userId).map(runRowOut);
}

/** List payload: summary columns only, verdict extracted from the report json
 *  (the PostgREST `report->verdict` select flattened it to a `verdict` key). */
export async function listRunSummaries(userId: string): Promise<RunRow[]> {
  const rows = getSqlite()
    .prepare(
      `SELECT id, user_id, symbol, share_name, agent_name, run_mode, skill_id, skill_ids, system_prompt,
              status, total_score, quantitative_score, qualitative_score, coverage, fit_low, fit_high,
              duration, model, source, error, started_at, created_at, updated_at,
              json_extract(report, '$.verdict') AS verdict
       FROM analysis_runs WHERE user_id = ? ORDER BY created_at DESC`,
    )
    .all(userId) as any[];
  return rows.map((r) => ({ ...r, skill_ids: fromJson(r.skill_ids, null), verdict: fromJson(r.verdict, null) }));
}

export async function deleteRunRow(userId: string, id: string): Promise<void> {
  getSqlite().prepare("DELETE FROM analysis_runs WHERE id = ? AND user_id = ?").run(id, userId);
}

/** Fail every PENDING/RUNNING row (in-process runs die with the process). */
export function failStaleRunRows(error: string, olderThanMs: number): void {
  const cutoff = new Date(Date.now() - olderThanMs).toISOString();
  getSqlite()
    .prepare(
      `UPDATE analysis_runs SET status = 'FAILED', error = ?, updated_at = ?
       WHERE status IN ('PENDING','RUNNING') AND (? = 0 OR (started_at IS NOT NULL AND started_at < ?))`,
    )
    .run(error, now(), olderThanMs, cutoff);
}

// ── Schedules ───────────────────────────────────────────────────────────────

export interface ScheduleRow {
  id: string;
  user_id: string;
  symbol: string;
  share_name: string;
  source: string;
  agent_id: string | null;
  model: string | null;
  system_prompt: string | null;
  skill_ids: string[] | null;
  max_steps: number | null;
  max_tokens: number | null;
  time: string;
  timezone: string;
  frequency: string;
  start_date: string | null;
  last_fired_date: string | null;
  created_at: string;
}

function scheduleRowOut(r: any): ScheduleRow {
  return { ...r, skill_ids: fromJson(r.skill_ids, null) };
}

export async function insertScheduleRow(row: Record<string, any>): Promise<ScheduleRow> {
  const r: Record<string, any> = { ...row, skill_ids: toJson(row.skill_ids ?? null) };
  if (!r.id) r.id = randomUUID();
  if (!r.created_at) r.created_at = now();
  const cols = Object.keys(r);
  getSqlite()
    .prepare(`INSERT INTO schedules (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`)
    .run(...cols.map((c) => (r as Record<string, unknown>)[c] as SQLInputValue));
  const out = getSqlite().prepare("SELECT * FROM schedules WHERE id = ?").get(r.id) as any;
  return scheduleRowOut(out);
}

export async function listScheduleRows(userId: string): Promise<ScheduleRow[]> {
  return getSqlite()
    .prepare("SELECT * FROM schedules WHERE user_id = ? ORDER BY created_at DESC")
    .all(userId)
    .map(scheduleRowOut);
}

export async function listAllScheduleRows(): Promise<ScheduleRow[]> {
  return getSqlite().prepare("SELECT * FROM schedules").all().map(scheduleRowOut);
}

export async function deleteScheduleRow(userId: string, id: string): Promise<void> {
  getSqlite().prepare("DELETE FROM schedules WHERE id = ? AND user_id = ?").run(id, userId);
}

/** Atomic per-day claim: true when this tick won the fire for `date`. */
export function claimSchedule(id: string, date: string): boolean {
  const res = getSqlite()
    .prepare(
      "UPDATE schedules SET last_fired_date = ? WHERE id = ? AND (last_fired_date IS NULL OR last_fired_date <> ?)",
    )
    .run(date, id, date);
  return res.changes > 0;
}

// ── api_usage / stock_pulls / builder_sessions / app_meta ───────────────────

export interface UsageRow {
  day: string;
  provider: string;
  key_ref: string;
  model_id: string;
  requests: number;
  tokens_in: number;
  tokens_out: number;
  failures: number;
}

export function flushApiUsage(rows: UsageRow[]): void {
  const stmt = getSqlite().prepare(
    `INSERT INTO api_usage (day, provider, key_ref, model_id, requests, tokens_in, tokens_out, failures)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (day, provider, key_ref, model_id) DO UPDATE SET
       requests = excluded.requests, tokens_in = excluded.tokens_in,
       tokens_out = excluded.tokens_out, failures = excluded.failures`,
  );
  for (const r of rows) stmt.run(r.day, r.provider, r.key_ref, r.model_id, r.requests, r.tokens_in, r.tokens_out, r.failures);
}

export function getStockPull(userId: string, symbol: string, source: string): { status: string | null; last_pulled_at: string | null } | null {
  const r = getSqlite()
    .prepare("SELECT status, last_pulled_at FROM stock_pulls WHERE user_id = ? AND symbol = ? AND source = ? LIMIT 1")
    .get(userId, symbol, source) as any;
  return r ? { status: r.status, last_pulled_at: r.last_pulled_at } : null;
}

export function insertBuilderSessionTurn(sessionId: string, userId: string, turnIndex: number, userMessage: string, draft: unknown, annotations: unknown, sources: unknown): void {
  getSqlite()
    .prepare(
      `INSERT INTO builder_sessions (session_id, user_id, turn_index, user_message, agent_draft_snapshot, annotations, sources)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(sessionId, userId, turnIndex, userMessage, toJson(draft), toJson(annotations), toJson(sources));
}

export function getMeta(key: string): string | null {
  const r = getSqlite().prepare("SELECT value FROM app_meta WHERE key = ?").get(key) as any;
  return r?.value ?? null;
}
