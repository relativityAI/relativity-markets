/**
 * Local-first settings store — same signatures as localdb.ts (the legacy
 * Postgres module), backed by the SQLite file. Keys stay AES-256-GCM
 * encrypted at rest via api/crypto.ts.
 */
import { getSqlite, fromJson, toJson } from "./sqlite.js";
import type { SQLInputValue } from "node:sqlite";

export interface UserSettingsRow {
  user_id: string;
  voyager_key_encrypted: string | null;
  llm_keys_encrypted: Record<string, string>;
  key_version: number | null;
  defaults_deleted: boolean | null;
  deleted_preset_keys: string[] | null;
}

export async function getUserSettings(userId: string): Promise<UserSettingsRow | null> {
  const row = getSqlite().prepare(
    "SELECT user_id, voyager_key_encrypted, llm_keys_encrypted, key_version, defaults_deleted, deleted_preset_keys FROM user_settings WHERE user_id = ?",
  ).get(userId) as any;
  if (!row) return null;
  return {
    user_id: row.user_id,
    voyager_key_encrypted: row.voyager_key_encrypted ?? null,
    llm_keys_encrypted: fromJson(row.llm_keys_encrypted, {}) as Record<string, string>,
    key_version: row.key_version ?? null,
    defaults_deleted: row.defaults_deleted == null ? null : !!row.defaults_deleted,
    deleted_preset_keys: fromJson(row.deleted_preset_keys, []) as string[],
  };
}

/** Insert-or-update the given columns for one user. */
export async function upsertUserSettings(userId: string, patch: Partial<Omit<UserSettingsRow, "user_id">>): Promise<void> {
  const cols: string[] = ["user_id"];
  const vals: unknown[] = [userId];
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    if (k === "llm_keys_encrypted" || k === "deleted_preset_keys") vals.push(toJson(v));
    else if (k === "defaults_deleted") vals.push(v ? 1 : 0);
    else vals.push(v);
    cols.push(k);
  }
  const updates = cols.slice(1).map((c) => `${c} = excluded.${c}`);
  const sql = updates.length
    ? `INSERT INTO user_settings (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})
       ON CONFLICT (user_id) DO UPDATE SET ${updates.join(", ")}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`
    : `INSERT OR IGNORE INTO user_settings (user_id) VALUES (?)`;
  getSqlite().prepare(sql).run(...(vals as SQLInputValue[]));
}

/** Fire-and-forget activity log — never throws into the request path. */
export async function recordActivity(userId: string, method: string, path: string): Promise<void> {
  try {
    getSqlite()
      .prepare("INSERT INTO user_activity (user_id, method, path) VALUES (?, ?, ?)")
      .run(userId, method, path.slice(0, 500));
  } catch (e: any) {
    console.warn("[sqlite]", `activity log failed: ${e?.message || e}`);
  }
}
