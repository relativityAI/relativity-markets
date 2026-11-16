/**
 * One-time export: legacy SQLite agents/skills rows → the file store.
 *
 * Agents: services/data/agents/<userId>/<agentId>.md (agentmd v3 grammar).
 * Skills: services/data/skills/<userId>/<skillId>/SKILL.md (+ files jsonb).
 *
 * Idempotent: an agent/skill that already exists as a file is skipped, so
 * re-running after a partial export tops up without overwriting edits.
 *
 * Run:  npx tsx scripts/export-legacy-store.ts [--dry]
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { listAllAgentRows, listAllSkillRows } from "../db/repo.js";
import { parseAgentMd, serializeAgentMd, type AgentConfigV3 } from "../harness/agentmd.js";
import { agentsDir, HARNESS_VERSION } from "../harness/store.js";
import { customSkillDir } from "../harness/skills.js";
import { clampBudget } from "../harness/types.js";
import { getSqlite } from "../db/sqlite.js";

const dry = process.argv.includes("--dry");

function agentMdFromRow(row: any): string | null {
  const c = row.configuration ?? {};
  if (c.harness_version !== HARNESS_VERSION) return null;
  // md_config (v3 markdown) wins; configuration jsonb fills the runtime fields.
  let agent: AgentConfigV3;
  let prev: string | undefined;
  if (row.md_config && row.md_config.trim()) {
    const parsed = parseAgentMd(row.md_config);
    if (!parsed.agent) return null;
    agent = parsed.agent;
    prev = row.md_config;
  } else {
    agent = {
      name: row.name,
      persona: { philosophy: c.soul_prompt ?? "" },
      skills: (c.skill_ids ?? []).slice(0, 1).map((skill_id: string) => ({ skill_id, weight: 5 })),
    };
  }
  // Patch the machine fields from configuration jsonb into frontmatter by
  // serializing through the store's round-trip: build a definition-shaped md.
  const extra: [string, string][] = [
    ...(c.category ? [["category", String(c.category)] as [string, string]] : []),
    ...(c.model_id ? [["model", String(c.model_id)] as [string, string]] : []),
    ...((c.allowed_tools ?? []).length ? [["allowed_tools", (c.allowed_tools as string[]).join(" ")] as [string, string]] : []),
    ...(c.system_prompt ? [["system_prompt", String(c.system_prompt)] as [string, string]] : []),
    ["budget", JSON.stringify(clampBudget(c.budget))],
  ];
  const stub = { ...agent, extraFrontmatter: extra, opaque: prev ? parseAgentMd(prev).opaque : [] } as AgentConfigV3 & {
    extraFrontmatter: [string, string][];
    opaque: { heading: string; text: string; order: number }[];
  };
  return serializeAgentMd(stub, prev);
}

async function main(): Promise<void> {
  const sqlitePath = process.env.SQLITE_PATH || join(process.cwd(), "data", "relativity.db");
  if (!existsSync(sqlitePath)) {
    console.error(`no legacy SQLite database at ${sqlitePath} — nothing to export`);
    process.exit(0);
  }
  // Touch the db so getSqlite() opens the same file the app uses.
  getSqlite();

  let agents = 0;
  for (const row of await listAllAgentRows()) {
    const c = row.configuration ?? {};
    if (c.harness_version !== HARNESS_VERSION) continue; // pre-harness row — not portable
    const dir = agentsDir(row.user_id);
    const file = join(dir, `${row.id}.md`);
    if (existsSync(file)) continue;
    const md = agentMdFromRow(row);
    if (!md) continue;
    if (!dry) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(file, md);
    }
    agents++;
  }

  let skills = 0;
  for (const row of await listAllSkillRows()) {
    const dir = customSkillDir(row.user_id, row.skill_id);
    if (existsSync(join(dir, "SKILL.md"))) continue;
    if (!row.markdown?.trim()) continue;
    if (!dry) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "SKILL.md"), row.markdown);
      for (const [path, content] of Object.entries(row.files ?? {})) {
        if (typeof content !== "string" || path.includes("..")) continue;
        const dest = join(dir, path);
        mkdirSync(join(dest, ".."), { recursive: true });
        writeFileSync(dest, content);
      }
    }
    skills++;
  }

  console.log(`${dry ? "[dry] would export" : "exported"} ${agents} agent(s), ${skills} skill(s)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
