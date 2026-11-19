/**
 * Local-first storage — a single SQLite file (node:sqlite, zero native deps).
 * Mirrors the Supabase/local-Postgres tables the app used; those clients
 * (db.ts) stays untouched for the cloud path.
 */
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { config } from "../api/config.js";
import { log } from "../api/logger.js";

let db: DatabaseSync | null = null;

export function getSqlite(): DatabaseSync {
  if (db) return db;
  const file = resolve(config.sqlitePath);
  mkdirSync(dirname(file), { recursive: true });
  db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA foreign_keys = ON");
  migrateSqlite(db);
  log.info("[sqlite]", `opened ${file}`);
  return db;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS app_meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);
CREATE TABLE IF NOT EXISTS user_settings (
  user_id               TEXT PRIMARY KEY,
  voyager_key_encrypted TEXT,
  llm_keys_encrypted    TEXT NOT NULL DEFAULT '{}',
  key_version           INTEGER,
  defaults_deleted      INTEGER NOT NULL DEFAULT 0,
  deleted_preset_keys   TEXT NOT NULL DEFAULT '[]',
  prefs                 TEXT NOT NULL DEFAULT '{}',
  updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS user_activity (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT NOT NULL,
  method     TEXT NOT NULL,
  path       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS user_activity_user_id_idx ON user_activity (user_id);
CREATE TABLE IF NOT EXISTS agents (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL,
  name              TEXT NOT NULL,
  source            TEXT NOT NULL DEFAULT 'NSE',
  persona           TEXT DEFAULT '{}',
  configuration     TEXT DEFAULT '{}',
  asset_evaluation  TEXT DEFAULT '{"qualitative":[],"quantitative":[]}',
  macro_evaluation  TEXT DEFAULT '{"qualitative":[],"quantitative":[]}',
  md_config         TEXT NOT NULL DEFAULT '',
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_agents_user_id ON agents(user_id);
CREATE TABLE IF NOT EXISTS skills (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  skill_id    TEXT NOT NULL,
  markdown    TEXT NOT NULL,
  files       TEXT NOT NULL DEFAULT '{}',
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (user_id, skill_id)
);
CREATE INDEX IF NOT EXISTS skills_user_idx ON skills (user_id);
CREATE TABLE IF NOT EXISTS alert_rules (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL,
  symbol         TEXT NOT NULL,
  share_name     TEXT NOT NULL,
  source         TEXT NOT NULL,
  agent_id       TEXT,
  model          TEXT,
  system_prompt  TEXT,
  skill_ids      TEXT,
  max_steps      INTEGER,
  max_tokens     INTEGER,
  time           TEXT NOT NULL,
  timezone       TEXT NOT NULL,
  frequency      TEXT NOT NULL DEFAULT 'daily',
  start_date     TEXT,
  last_fired_date TEXT,
  last_run_id    TEXT,
  enabled        INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS alert_rules_user_idx ON alert_rules (user_id);
CREATE TABLE IF NOT EXISTS alerts (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  rule_id     TEXT NOT NULL,
  run_id      TEXT,
  symbol      TEXT NOT NULL,
  share_name  TEXT NOT NULL,
  agent_name  TEXT,
  verdict     TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  read_at     TEXT
);
CREATE INDEX IF NOT EXISTS alerts_user_idx ON alerts (user_id, created_at);
CREATE TABLE IF NOT EXISTS watchlists (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  name        TEXT NOT NULL,
  items       TEXT NOT NULL DEFAULT '[]',
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS watchlists_user_idx ON watchlists (user_id);
CREATE TABLE IF NOT EXISTS analysis_runs (
  id                    TEXT PRIMARY KEY,
  user_id               TEXT NOT NULL,
  status                TEXT DEFAULT 'PENDING',
  symbol                TEXT NOT NULL,
  share_name            TEXT NOT NULL,
  agent_name            TEXT NOT NULL,
  model                 TEXT,
  source                TEXT,
  run_mode              TEXT DEFAULT 'agent',
  skill_id              TEXT,
  skill_ids             TEXT,
  system_prompt         TEXT,
  report                TEXT,
  trace                 TEXT DEFAULT '[]',
  workspace             TEXT,
  skill_outputs         TEXT,
  market_snapshot       TEXT,
  duration              REAL,
  error                 TEXT,
  total_score           REAL,
  quantitative_score    REAL,
  qualitative_score     REAL,
  fit_low               REAL,
  fit_high              REAL,
  coverage              REAL,
  started_at            TEXT,
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_analysis_runs_user_id ON analysis_runs(user_id);
CREATE TABLE IF NOT EXISTS stock_pulls (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL,
  symbol          TEXT NOT NULL,
  country         TEXT,
  source          TEXT NOT NULL,
  job_id          TEXT,
  status          TEXT DEFAULT 'pending',
  last_pulled_at  TEXT,
  data_available  INTEGER DEFAULT 0,
  records         INTEGER DEFAULT 0,
  error           TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_stock_pulls_user_symbol ON stock_pulls(user_id, symbol, source);
CREATE TABLE IF NOT EXISTS api_usage (
  day         TEXT NOT NULL,
  provider    TEXT NOT NULL,
  key_ref     TEXT NOT NULL,
  model_id    TEXT NOT NULL,
  requests    INTEGER NOT NULL DEFAULT 0,
  tokens_in   INTEGER NOT NULL DEFAULT 0,
  tokens_out  INTEGER NOT NULL DEFAULT 0,
  failures    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, provider, key_ref, model_id)
);
CREATE TABLE IF NOT EXISTS builder_sessions (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id            TEXT NOT NULL,
  user_id               TEXT NOT NULL,
  turn_index            INTEGER,
  user_message          TEXT,
  agent_draft_snapshot  TEXT,
  annotations           TEXT,
  sources               TEXT,
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
`;

function ensureSchema(d: DatabaseSync): void {
  d.exec(SCHEMA);
  // First-run stamp — Settings shows it as the local user's start date.
  d.prepare("INSERT OR IGNORE INTO app_meta (key, value) VALUES ('first_run_at', ?)")
    .run(new Date().toISOString());
}

/**
 * Forward-only schema versioning for the local SQLite file.
 *
 * SCHEMA_VERSION is the schema shape this release ships. Fresh databases are
 * created by ensureSchema() at the current version and skip migrations.
 * Existing databases (docker volumes that survive an upgrade) carry
 * user_version from the release that created them; every MIGRATIONS entry
 * with a higher version runs once, transactionally, in order.
 *
 * When the schema changes: append a {version, sql} entry (never edit old
 * ones), bump SCHEMA_VERSION to match, and cover it in db/tests.
 */
export const SCHEMA_VERSION = 5;

// v2: scheduled-run frequencies (daily/weekly/biweekly/monthly) — frequency
// plus the first-run date the recurrence is anchored to. Existing rows keep
// firing daily via the defaults.
export const MIGRATIONS: { version: number; sql: string }[] = [
  {
    version: 2,
    sql: "ALTER TABLE schedules ADD COLUMN frequency TEXT NOT NULL DEFAULT 'daily';\nALTER TABLE schedules ADD COLUMN start_date TEXT;",
  },
  {
    version: 3,
    sql: "ALTER TABLE user_settings ADD COLUMN prefs TEXT NOT NULL DEFAULT '{}';",
  },
  {
    version: 4,
    sql: `CREATE TABLE IF NOT EXISTS watchlists (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  name        TEXT NOT NULL,
  items       TEXT NOT NULL DEFAULT '[]',
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS watchlists_user_idx ON watchlists (user_id);`,
  },
  // v5: schedules -> alert_rules (the feature is alerts: a rule watches a
  // symbol on a cadence, each fired run's verdict becomes an alert row).
  // Renamed in place so existing rows keep firing; enabled defaults to 1.
  {
    version: 5,
    // ponytail: the old schedules_user_idx index keeps its name on migrated
    // DBs (SQLite has no ALTER INDEX IF EXISTS; index names don't matter).
    sql: `ALTER TABLE schedules RENAME TO alert_rules;
ALTER TABLE alert_rules ADD COLUMN last_run_id TEXT;
ALTER TABLE alert_rules ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1;
CREATE TABLE IF NOT EXISTS alerts (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  rule_id     TEXT NOT NULL,
  run_id      TEXT,
  symbol      TEXT NOT NULL,
  share_name  TEXT NOT NULL,
  agent_name  TEXT,
  verdict     TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  read_at     TEXT
);
CREATE INDEX IF NOT EXISTS alerts_user_idx ON alerts (user_id, created_at);`,
  },
];

export function migrateSqlite(
  d: DatabaseSync,
  steps: { version: number; sql: string }[] = MIGRATIONS,
): void {
  const tables = d.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table'").get() as { n: number };
  const userVersion = (d.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;

  // Fresh install: create the current schema and stamp it — no migrations.
  if (tables.n === 0) {
    ensureSchema(d);
    d.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    return;
  }

  for (const m of steps) {
    if (m.version <= userVersion) continue;
    d.exec("BEGIN");
    try {
      d.exec(m.sql);
      d.exec(`PRAGMA user_version = ${m.version}`);
      d.exec("COMMIT");
      log.info("[sqlite]", `applied migration v${m.version}`);
    } catch (e) {
      d.exec("ROLLBACK");
      throw new Error(`sqlite migration v${m.version} failed; rolled back — ${(e as Error).message}`);
    }
  }

  // Legacy database from before versioning existed (tables, user_version 0):
  // stamp the baseline so future migrations trigger on the next upgrade.
  // ponytail: use the highest version actually applied, not the global
  // SCHEMA_VERSION — a caller passing a subset of steps shouldn't jump ahead.
  const maxStep = steps.reduce((m, s) => Math.max(m, s.version), 0);
  const stamped = (d.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
  if (stamped < maxStep) d.exec(`PRAGMA user_version = ${maxStep}`);
}

/** Parse a JSON column that may be a JSON string, already-parsed, or null.
 *  A non-empty string that isn't valid JSON is returned as-is (json_extract
 *  gives bare strings unquoted, e.g. verdict "Fair"). */
export function fromJson<T>(v: unknown, fallback: T): T {
  if (v == null) return fallback;
  if (typeof v !== "string") return v as T;
  try {
    return JSON.parse(v) as T;
  } catch {
    return v ? (v as T) : fallback;
  }
}

export function toJson(v: unknown): string {
  return v == null ? "" : typeof v === "string" ? v : JSON.stringify(v);
}
