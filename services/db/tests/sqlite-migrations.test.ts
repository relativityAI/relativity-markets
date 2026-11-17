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
    expect(version(d)).toBe(SCHEMA_VERSION);
    expect(d.prepare("SELECT value FROM app_meta WHERE key='first_run_at'").get()).toBeTruthy();
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
    d.prepare("INSERT INTO schedules (id, user_id, symbol, share_name, source, time, timezone) VALUES ('s1','u1','AAPL','Apple','SEC','21:00','UTC')").run();
    migrateSqlite(d);
    expect(version(d)).toBe(SCHEMA_VERSION);
    expect((d.prepare("SELECT x FROM legacy").get() as { x: string }).x).toBe("keep-me");
    // The v2 migration landed: new columns exist, existing rows keep firing daily.
    const freq = d.prepare("SELECT frequency, start_date FROM schedules WHERE id='s1'").get() as { frequency: string; start_date: string | null };
    expect(freq.frequency).toBe("daily");
    expect(freq.start_date).toBeNull();
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
