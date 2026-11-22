import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { SCHEMA_VERSION, migrateSqlite } from "../sqlite.js";

function version(d: DatabaseSync): number {
  return (d.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
}

function tableExists(d: DatabaseSync, name: string): boolean {
  const r = d.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name = ?").get(name) as { n: number };
  return r.n > 0;
}

describe("sqlite migrations", () => {
  it("fresh database: full schema created at the current version", () => {
    const d = new DatabaseSync(":memory:");
    migrateSqlite(d);
    expect(tableExists(d, "agents")).toBe(true);
    expect(tableExists(d, "analysis_runs")).toBe(true);
    expect(tableExists(d, "watchlists")).toBe(true);
    expect(tableExists(d, "alert_rules")).toBe(true);
    expect(tableExists(d, "alerts")).toBe(true);
    expect(tableExists(d, "plugins")).toBe(true);
    expect(tableExists(d, "schedules")).toBe(false);
    const runCols = (d.prepare("SELECT name FROM pragma_table_info('analysis_runs')").all() as { name: string }[]).map((c) => c.name);
    expect(runCols).toContain("plugin_ids");
    expect(runCols).toContain("mcp_enabled");
    expect(version(d)).toBe(SCHEMA_VERSION);
    expect(d.prepare("SELECT value FROM app_meta WHERE key='first_run_at'").get()).toBeTruthy();
  });

  it("v4 adds watchlists to an existing v3 database", () => {
    const d = new DatabaseSync(":memory:");
    d.exec("CREATE TABLE legacy (x TEXT)");
    // A real v3 database carries the v1 schema — including schedules, which
    // v5 renames. Without it the forward migrations can't run.
    d.exec(`CREATE TABLE schedules (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, symbol TEXT NOT NULL, share_name TEXT NOT NULL,
      source TEXT NOT NULL, time TEXT NOT NULL, timezone TEXT NOT NULL, last_fired_date TEXT,
      created_at TEXT NOT NULL DEFAULT 'now'
    )`);
    // v6 ALTERs analysis_runs — a real v3 database carries it (it is v1 schema).
    d.exec("CREATE TABLE analysis_runs (id TEXT PRIMARY KEY, user_id TEXT NOT NULL)");
    d.exec("PRAGMA user_version = 3");
    migrateSqlite(d);
    expect(version(d)).toBe(SCHEMA_VERSION);
    expect(tableExists(d, "watchlists")).toBe(true);
    const cols = d.prepare("SELECT name FROM pragma_table_info('watchlists')").all() as { name: string }[];
    expect(cols.map((c) => c.name)).toEqual(["id", "user_id", "name", "items", "created_at", "updated_at"]);
  });

  it("is idempotent", () => {
    const d = new DatabaseSync(":memory:");
    migrateSqlite(d);
    migrateSqlite(d);
    expect(version(d)).toBe(SCHEMA_VERSION);
  });

  it("legacy database (tables, no version): data preserved, baseline stamped", () => {
    const d = new DatabaseSync(":memory:");
    d.exec("CREATE TABLE legacy (x TEXT)");
    d.prepare("INSERT INTO legacy VALUES ('keep-me')").run();
    // A real pre-versioning database carries the app's own prior schema —
    // give it the v1 schedules shape so the shipped migration has something
    // real to ALTER.
    d.exec(
      `CREATE TABLE schedules (
         id TEXT PRIMARY KEY, user_id TEXT NOT NULL, symbol TEXT NOT NULL,
         share_name TEXT NOT NULL, source TEXT NOT NULL, time TEXT NOT NULL,
         timezone TEXT NOT NULL, last_fired_date TEXT,
         created_at TEXT NOT NULL DEFAULT 'now'
       )`,
    );
    // v3 migration ALTERs user_settings — a real pre-versioning DB has it too.
    d.exec("CREATE TABLE user_settings (user_id TEXT PRIMARY KEY, llm_keys_encrypted TEXT)");
    // v6 ALTERs analysis_runs — present in every real pre-versioning database.
    d.exec("CREATE TABLE analysis_runs (id TEXT PRIMARY KEY, user_id TEXT NOT NULL)");
    d.prepare("INSERT INTO schedules (id, user_id, symbol, share_name, source, time, timezone) VALUES ('s1','u1','AAPL','Apple','SEC','21:00','UTC')").run();
    migrateSqlite(d);
    expect(version(d)).toBe(SCHEMA_VERSION);
    expect((d.prepare("SELECT x FROM legacy").get() as { x: string }).x).toBe("keep-me");
    // The v2 migration landed: new columns exist, existing rows keep firing daily.
    // v5 renamed the table: the same row is now an alert rule, enabled by default.
    const rule = d.prepare("SELECT frequency, start_date, enabled, last_run_id FROM alert_rules WHERE id='s1'").get() as {
      frequency: string;
      start_date: string | null;
      enabled: number;
      last_run_id: string | null;
    };
    expect(rule.frequency).toBe("daily");
    expect(rule.start_date).toBeNull();
    expect(rule.enabled).toBe(1);
    expect(rule.last_run_id).toBeNull();
    expect(tableExists(d, "alerts")).toBe(true);
  });

  it("v5 turns a v4 schedules row into an enabled alert rule, data preserved", () => {
    const d = new DatabaseSync(":memory:");
    d.exec(`CREATE TABLE schedules (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, symbol TEXT NOT NULL, share_name TEXT NOT NULL,
      source TEXT NOT NULL, agent_id TEXT, model TEXT, system_prompt TEXT, skill_ids TEXT,
      max_steps INTEGER, max_tokens INTEGER, time TEXT NOT NULL, timezone TEXT NOT NULL,
      frequency TEXT NOT NULL DEFAULT 'daily', start_date TEXT, last_fired_date TEXT,
      created_at TEXT NOT NULL DEFAULT 'now'
    )`);
    d.exec("CREATE INDEX schedules_user_idx ON schedules (user_id)");
    d.exec(`CREATE TABLE user_settings (user_id TEXT PRIMARY KEY, llm_keys_encrypted TEXT, prefs TEXT NOT NULL DEFAULT '{}')`);
    // v6 ALTERs analysis_runs — a real v4 database carries it (v1 schema).
    d.exec("CREATE TABLE analysis_runs (id TEXT PRIMARY KEY, user_id TEXT NOT NULL)");
    d.exec("PRAGMA user_version = 4");
    d.prepare(
      "INSERT INTO schedules (id, user_id, symbol, share_name, source, time, timezone, frequency, last_fired_date) VALUES ('r1','u1','RELIANCE','Reliance','NSE','09:00','Asia/Kolkata','daily','2026-11-18')",
    ).run();
    migrateSqlite(d);
    expect(version(d)).toBe(SCHEMA_VERSION);
    expect(tableExists(d, "schedules")).toBe(false);
    const row = d.prepare("SELECT symbol, frequency, last_fired_date, enabled FROM alert_rules WHERE id='r1'").get() as {
      symbol: string;
      frequency: string;
      last_fired_date: string;
      enabled: number;
    };
    expect(row).toEqual({ symbol: "RELIANCE", frequency: "daily", last_fired_date: "2026-11-18", enabled: 1 });
    const cols = (d.prepare("SELECT name FROM pragma_table_info('alerts')").all() as { name: string }[]).map((c) => c.name);
    expect(cols).toEqual(["id", "user_id", "rule_id", "run_id", "symbol", "share_name", "agent_name", "verdict", "created_at", "read_at"]);
  });

  it("pending migrations run once, in order", () => {
    const d = new DatabaseSync(":memory:");
    d.exec("CREATE TABLE legacy (x TEXT)");
    migrateSqlite(d, [
      { version: 1, sql: "ALTER TABLE legacy ADD COLUMN note TEXT" },
      { version: 2, sql: "CREATE TABLE added (y TEXT)" },
    ]);
    expect(version(d)).toBe(2);
    const cols = d.prepare("SELECT name FROM pragma_table_info('legacy')").all() as { name: string }[];
    expect(cols.map((c) => c.name)).toContain("note");
    expect(tableExists(d, "added")).toBe(true);
  });

  it("failed migration rolls back fully and keeps the old version", () => {
    const d = new DatabaseSync(":memory:");
    d.exec("CREATE TABLE legacy (x TEXT)");
    expect(() =>
      migrateSqlite(d, [{ version: 1, sql: "CREATE TABLE ok (y TEXT); THIS IS NOT SQL" }]),
    ).toThrow(/v1 failed/);
    expect(version(d)).toBe(0);
    expect(tableExists(d, "ok")).toBe(false);
  });
});
