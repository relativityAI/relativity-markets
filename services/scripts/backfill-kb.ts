/**
 * One-shot backfill: hydrate the Knowledge Base for runs whose workspace
 * snapshot is empty. Pre-refactor rows carry their tool results in `trace`
 * but no /knowledge_base/ files (the archiver was lost in the deepagents
 * refactor), so the UI showed "No workspace snapshot for this run." — this
 * rebuilds those files from the stored trace and re-saves the snapshot.
 *
 * Run: npx tsx scripts/backfill-kb.ts
 */
import { mkdirSync } from "node:fs";
import { compactWorkspace, hydrateKnowledgeBase, runWorkspaceDir } from "../harness/engine.js";
import { updateRunRow } from "../db/repo.js";
import { getSqlite } from "../db/sqlite.js";

const db = getSqlite();
const rows = db
  .prepare(
    "SELECT id, trace, workspace FROM analysis_runs WHERE trace IS NOT NULL AND trace != '[]'",
  )
  .all() as { id: string; trace: string; workspace: string | null }[];

let patched = 0;
for (const row of rows) {
  const hasWorkspace = row.workspace && row.workspace !== "{}" && row.workspace !== "null";
  if (hasWorkspace) continue;
  let trace;
  try {
    trace = JSON.parse(row.trace);
  } catch {
    continue;
  }
  if (!Array.isArray(trace)) continue;
  const dir = runWorkspaceDir(row.id);
  mkdirSync(dir, { recursive: true });
  hydrateKnowledgeBase(dir, trace);
  const workspace = compactWorkspace(dir);
  if (!Object.keys(workspace).length) continue;
  await updateRunRow(row.id, { workspace });
  patched += 1;
  console.log(`backfilled ${row.id.slice(0, 8)} → ${Object.keys(workspace).length} files`);
}
console.log(`done — ${patched} run(s) patched`);
