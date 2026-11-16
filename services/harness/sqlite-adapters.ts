/**
 * SQLite adapters for the harness persistence ports (AgentRepository /
 * SkillRepository) — the local-first data path. installHarnessAdapters()
 * here replaces the Supabase install in index.ts; the Supabase adapters in
 * harness-adapters.ts are kept untouched for the legacy cloud path.
 *
 * Harness fields live in the agents row's `configuration` jsonb (same layout
 * the Supabase adapter used): soul_prompt, skill_ids, allowed_tools, model_id,
 * budget, system_prompt, marked configuration.harness_version = 2.
 */
import { randomUUID } from "node:crypto";
import {
  HARNESS_VERSION,
  clampBudget,
  setAgentRepository,
  setSkillRepository,
  type AgentDefinition,
  type AgentInput,
  type AgentRepository,
  type CustomSkillRecord,
  type SkillRepository,
} from "./index.js";
import { getAgentRow, insertAgentRow, updateAgentRow, deleteAgentRow, getSkillRow, upsertSkillRow, deleteSkillRow, listSkillRows, listAgentRows } from "../db/repo.js";

function isHarness(c: any): boolean {
  return c?.harness_version === HARNESS_VERSION;
}

function rowToDefinition(row: any): AgentDefinition | null {
  const c = row.configuration ?? {};
  if (!isHarness(c)) return null;
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    category: c.category ?? "",
    soulPrompt: c.soul_prompt ?? "",
    skillIds: (c.skill_ids ?? []).slice(0, 1),
    allowedTools: c.allowed_tools ?? [],
    modelId: c.model_id ?? null,
    budget: clampBudget(c.budget ?? undefined),
    systemPrompt: c.system_prompt ?? null,
    createdAt: row.created_at ?? null,
  };
}

function toConfig(input: AgentInput, base?: Record<string, unknown>): Record<string, unknown> {
  return {
    ...(base ?? {}),
    harness_version: HARNESS_VERSION,
    category: input.category ?? "",
    soul_prompt: input.soulPrompt ?? "",
    skill_ids: (input.skillIds ?? []).slice(0, 1),
    allowed_tools: input.allowedTools ?? [],
    model_id: input.modelId ?? null,
    budget: clampBudget(input.budget),
    system_prompt: input.systemPrompt ?? null,
  };
}

export const sqliteAgentRepository: AgentRepository = {
  async list(userId) {
    const rows = await listAgentRows(userId);
    return rows.map(rowToDefinition).filter((d): d is AgentDefinition => !!d);
  },

  async get(userId, id) {
    const row = await getAgentRow(userId, id);
    return row ? rowToDefinition(row) : null;
  },

  async create(userId, input) {
    const row = {
      id: randomUUID(),
      user_id: userId,
      name: input.name,
      source: "harness",
      configuration: toConfig(input),
      created_at: new Date().toISOString(),
    };
    await insertAgentRow(row);
    const saved = await getAgentRow(userId, row.id);
    return rowToDefinition(saved)!;
  },

  async update(userId, id, input) {
    const existing = await getAgentRow(userId, id);
    if (!existing || !isHarness(existing.configuration)) return null;
    const c = existing.configuration ?? {};
    const merged: AgentInput = {
      name: input.name ?? existing.name,
      category: input.category !== undefined ? input.category : c.category ?? "",
      soulPrompt: input.soulPrompt ?? c.soul_prompt ?? "",
      skillIds: input.skillIds ?? c.skill_ids ?? [],
      allowedTools: input.allowedTools ?? c.allowed_tools ?? [],
      modelId: input.modelId !== undefined ? input.modelId : c.model_id ?? null,
      budget: input.budget ?? c.budget,
      systemPrompt: input.systemPrompt !== undefined ? input.systemPrompt : c.system_prompt ?? null,
    };
    await updateAgentRow(userId, id, {
      name: input.name !== undefined ? input.name : existing.name,
      configuration: toConfig(merged, c),
    });
    const saved = await getAgentRow(userId, id);
    return saved ? rowToDefinition(saved) : null;
  },

  async delete(userId, id) {
    await deleteAgentRow(userId, id);
    return true;
  },
};

export const sqliteSkillRepository: SkillRepository = {
  async list(userId) {
    const rows = await listSkillRows(userId);
    return rows.map((r) => ({
      skillId: r.skill_id,
      markdown: r.markdown,
      updatedAt: r.updated_at ?? r.created_at,
    }));
  },

  async get(userId, skillId) {
    const r = await getSkillRow(userId, skillId);
    return r ? { skillId: r.skill_id, markdown: r.markdown, updatedAt: r.updated_at ?? r.created_at } : null;
  },

  async upsert(userId, skillId, markdown) {
    await upsertSkillRow(userId, skillId, markdown);
  },

  async delete(userId, skillId) {
    await deleteSkillRow(userId, skillId);
    return true;
  },
};

/** Install both SQLite adapters into the harness (once, at server boot). */
export function installHarnessAdapters(): void {
  setAgentRepository(sqliteAgentRepository);
  setSkillRepository(sqliteSkillRepository);
}

// Re-export the console view mappers so index.ts keeps its imports stable —
// they are view concerns, not persistence ones.
export { harnessToView, viewToHarnessPatch } from "./harness-adapters.js";
