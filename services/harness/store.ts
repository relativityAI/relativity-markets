/**
 * Agent definitions — file-backed, deepagents style.
 *
 * An agent is ONE markdown file: `services/data/agents/<userId>/<agentId>.md`.
 * The body follows the agentmd v3 grammar (## Philosophy = soul prompt,
 * ## Skills = skill bullets); every runtime field that isn't part of that
 * grammar (model, budget, allowed_tools, system_prompt, interrupt_on) rides
 * the YAML-ish frontmatter and round-trips through parseAgentMd's
 * extraFrontmatter passthrough. Built-in defaults seed new users from
 * `agents/defaults/*.md`.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseAgentMd, serializeAgentMd, type AgentConfigV3, type AgentSkillRef } from "./agentmd.js";
import { clampBudget, type Budget } from "./types.js";

export const HARNESS_VERSION = 3;

/** HITL approval gates — tool name → interrupt config (true = default decisions). */
export type ReviewDecisionType = "approve" | "edit" | "reject" | "respond";
export type InterruptOn = Record<string, boolean | { allowedDecisions: ReviewDecisionType[] }>;

export interface AgentDefinition {
  id: string;
  userId: string;
  name: string;
  /** The agent's one class/category (services/config/categories.yaml). */
  category: string;
  soulPrompt: string;
  skillIds: string[];
  allowedTools: string[];
  modelId: string | null;
  budget: Budget;
  /** Output template (format) applied as the last step; null = contract only. */
  systemPrompt: string | null;
  /** Human-in-the-loop approval gates per tool name; absent = no gates. */
  interruptOn?: InterruptOn;
  createdAt: string | null;
}

/** One skill per agent — the write-path clamp (reads clamp too). */
const oneSkill = (ids?: string[]): string[] => (ids ?? []).slice(0, 1);

export interface AgentInput {
  name: string;
  category?: string;
  soulPrompt?: string;
  skillIds?: string[];
  allowedTools?: string[];
  modelId?: string | null;
  budget?: Partial<Budget>;
  systemPrompt?: string | null;
  interruptOn?: InterruptOn | null;
}

// ── Paths ───────────────────────────────────────────────────────────────────

export function agentsDir(userId: string): string {
  return join(process.cwd(), "data", "agents", userId);
}
function agentFile(userId: string, id: string): string {
  return join(agentsDir(userId), `${id}.md`);
}

function slugify(name: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "agent";
  let id = base;
  let n = 2;
  while (existsSync(agentFile("", id)) && false) {
    // (per-user collision handled in create; here only for safety)
    id = `${base}-${n++}`;
  }
  return id;
}

// ── File ↔ AgentDefinition ──────────────────────────────────────────────────

function fmList(v: string | undefined): string[] {
  return (v ?? "").split(/[\s,]+/).filter(Boolean);
}

function definitionFromMd(userId: string, id: string, raw: string): AgentDefinition | null {
  const { agent, opaque, extraFrontmatter } = parseAgentMd(raw);
  if (!agent) return null;
  const extra = Object.fromEntries(extraFrontmatter);
  const skills: AgentSkillRef[] = agent.skills;
  const budgetRaw = extra["budget"];
  let budget: Partial<Budget> = {};
  try {
    budget = budgetRaw ? (JSON.parse(budgetRaw) as Partial<Budget>) : {};
  } catch {
    budget = {};
  }
  const interruptRaw = extra["interrupt_on"];
  let interruptOn: InterruptOn | undefined;
  try {
    interruptOn = interruptRaw ? (JSON.parse(interruptRaw) as InterruptOn) : undefined;
  } catch {
    interruptOn = undefined;
  }
  return {
    id,
    userId,
    name: agent.name,
    category: (extra["category"] ?? "").trim(),
    soulPrompt: agent.persona.philosophy,
    // v3 bullets win; a defaults-style `skill:` frontmatter key is the one-skill shorthand.
    skillIds: oneSkill(agent.skills.map((s) => s.skill_id).length ? agent.skills.map((s) => s.skill_id) : fmList(extra["skill"])),
    allowedTools: fmList(extra["allowed_tools"]),
    modelId: extra["model"]?.trim() || null,
    budget: clampBudget(budget),
    systemPrompt: extra["system_prompt"]?.trim() || null,
    interruptOn,
    createdAt: null,
  };
}

function mdFromDefinition(def: AgentDefinition, prevMd?: string): string {
  const agent: AgentConfigV3 = {
    name: def.name,
    persona: { philosophy: def.soulPrompt },
    skills: def.skillIds.map((skill_id) => ({ skill_id, weight: 5 })),
  };
  // Machine fields ride the frontmatter; unknown extras from the previous
  // file survive verbatim, the managed ones are rebuilt from the definition.
  const managed: [string, string][] = [];
  if (def.category) managed.push(["category", def.category]);
  if (def.modelId) managed.push(["model", def.modelId]);
  if (def.allowedTools.length) managed.push(["allowed_tools", def.allowedTools.join(" ")]);
  if (def.systemPrompt) managed.push(["system_prompt", def.systemPrompt]);
  if (def.interruptOn && Object.keys(def.interruptOn).length) managed.push(["interrupt_on", JSON.stringify(def.interruptOn)]);
  managed.push(["budget", JSON.stringify(def.budget)]);
  const kept: [string, string][] = prevMd
    ? parseAgentMd(prevMd).extraFrontmatter.filter(([k]) => !new Set(["category", "model", "allowed_tools", "system_prompt", "interrupt_on", "budget"]).has(k))
    : [];
  const opaque = prevMd ? parseAgentMd(prevMd).opaque : [];
  return serializeAgentMd(agent, prevMd, [...kept, ...managed]);
}

// ── Store ───────────────────────────────────────────────────────────────────

export function listAgentIds(userId: string): string[] {
  const dir = agentsDir(userId);
  try {
    return readdirSync(dir).filter((f) => f.endsWith(".md")).sort();
  } catch {
    return [];
  }
}

export function listAgents(userId: string): AgentDefinition[] {
  const out: AgentDefinition[] = [];
  for (const file of listAgentIds(userId)) {
    const def = definitionFromMd(userId, file.replace(/\.md$/, ""), readFileSync(join(agentsDir(userId), file), "utf8"));
    if (def) out.push(def);
  }
  return out;
}

export function getAgent(userId: string, id: string): AgentDefinition | null {
  const file = agentFile(userId, id);
  if (!existsSync(file)) return null;
  return definitionFromMd(userId, id, readFileSync(file, "utf8"));
}

export function createAgent(userId: string, input: AgentInput): AgentDefinition {
  mkdirSync(agentsDir(userId), { recursive: true });
  const id = slugify(input.name);
  const def: AgentDefinition = {
    id,
    userId,
    name: input.name,
    category: input.category ?? "",
    soulPrompt: input.soulPrompt ?? "",
    skillIds: oneSkill(input.skillIds),
    allowedTools: input.allowedTools ?? [],
    modelId: input.modelId ?? null,
    budget: clampBudget(input.budget),
    systemPrompt: input.systemPrompt ?? null,
    interruptOn: input.interruptOn ?? undefined,
    createdAt: new Date().toISOString(),
  };
  let finalId = id;
  let n = 2;
  while (existsSync(agentFile(userId, finalId))) finalId = `${id}-${n++}`;
  writeFileSync(agentFile(userId, finalId), mdFromDefinition({ ...def, id: finalId }));
  return { ...def, id: finalId };
}

export function updateAgent(userId: string, id: string, input: Partial<AgentInput>): AgentDefinition | null {
  const existing = getAgent(userId, id);
  if (!existing) return null;
  const prevMd = readFileSync(agentFile(userId, id), "utf8");
  const merged: AgentDefinition = {
    ...existing,
    name: input.name ?? existing.name,
    category: input.category !== undefined ? input.category : existing.category,
    soulPrompt: input.soulPrompt ?? existing.soulPrompt,
    skillIds: input.skillIds ? oneSkill(input.skillIds) : existing.skillIds,
    allowedTools: input.allowedTools ?? existing.allowedTools,
    modelId: input.modelId !== undefined ? input.modelId : existing.modelId,
    budget: input.budget ? clampBudget({ ...existing.budget, ...input.budget }) : existing.budget,
    systemPrompt: input.systemPrompt !== undefined ? input.systemPrompt : existing.systemPrompt,
    interruptOn: input.interruptOn !== undefined ? (input.interruptOn ?? undefined) : existing.interruptOn,
  };
  writeFileSync(agentFile(userId, id), mdFromDefinition(merged, prevMd));
  return merged;
}

export function deleteAgent(userId: string, id: string): boolean {
  const file = agentFile(userId, id);
  if (!existsSync(file)) return false;
  rmSync(file);
  return true;
}

// ── Console view mappers (the client's JSON shape — keep stable) ────────────

/** Map a harness definition into the console view the client renders. */
export function harnessToView(d: AgentDefinition) {
  return {
    id: d.id,
    _id: d.id,
    user_id: d.userId,
    name: d.name,
    source: "harness",
    harness: true,
    created_at: d.createdAt,
    persona: { philosophy: d.soulPrompt },
    category: d.category,
    skills: d.skillIds.map((skill_id) => ({ skill_id, weight: 5 })),
    soul_prompt: d.soulPrompt,
    skill_ids: d.skillIds,
    allowed_tools: d.allowedTools,
    model_id: d.modelId,
    budget: d.budget,
    system_prompt: d.systemPrompt,
  };
}

/** Map a console write into a harness patch — only fields actually present,
 *  so a partial update never wipes the rest of the configuration. */
export function viewToHarnessPatch(body: Record<string, any>) {
  const patch: Record<string, any> = {};
  if (body.name !== undefined) patch.name = String(body.name);
  // Truthy only — an absent or empty category means "no change".
  if (body.category) patch.category = String(body.category);
  const phil = body.soulPrompt ?? body.soul_prompt ?? body.philosophy
    ?? body.persona?.philosophy ?? body.persona?.philosophy_and_mindset;
  // A blank soul is never saved — an agent is its prompt; wiping one is almost
  // always an accidental select-all-delete, so the last prompt stays put.
  if (phil !== undefined && String(phil).trim() !== "") patch.soulPrompt = String(phil);
  const raw = Array.isArray(body.skillIds) ? body.skillIds
    : Array.isArray(body.skill_ids) ? body.skill_ids
      : Array.isArray(body.skills) ? body.skills : undefined;
  // One skill per agent.
  if (raw) patch.skillIds = raw.map((s: any) => (typeof s === "string" ? s : s?.skill_id)).filter(Boolean).slice(0, 1);
  const tools = body.allowedTools ?? body.allowed_tools;
  if (Array.isArray(tools)) patch.allowedTools = tools;
  if (body.modelId !== undefined || body.model_id !== undefined) patch.modelId = body.modelId ?? body.model_id;
  if (body.systemPrompt !== undefined || body.system_prompt !== undefined) {
    patch.systemPrompt = body.systemPrompt ?? body.system_prompt ?? null;
  }
  if (body.interruptOn !== undefined || body.interrupt_on !== undefined) {
    patch.interruptOn = body.interruptOn ?? body.interrupt_on ?? null;
  }
  return patch;
}

// ── Defaults (agents/defaults/*.md — same file format, no runtime fields) ───

import { fileURLToPath } from "node:url";
const DEFAULTS_DIR = fileURLToPath(new URL("./agent-defaults/", import.meta.url));

export function loadDefaultAgents(): AgentInput[] {
  const out: AgentInput[] = [];
  let files: string[] = [];
  try {
    files = readdirSync(DEFAULTS_DIR).filter((f) => f.endsWith(".md")).sort();
  } catch {
    return out;
  }
  for (const file of files) {
    const raw = readFileSync(join(DEFAULTS_DIR, file), "utf8");
    // A default's frontmatter is name/skill/category; its BODY is the soul
    // prompt (no ## Philosophy section — keep that byte-for-byte).
    const body = raw.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "").trim();
    const def = definitionFromMd("", file.replace(/\.md$/, ""), raw);
    if (def) {
      out.push({
        name: def.name,
        category: def.category,
        soulPrompt: body || def.soulPrompt,
        skillIds: def.skillIds,
        allowedTools: def.allowedTools,
        modelId: def.modelId,
        budget: def.budget,
        systemPrompt: def.systemPrompt,
        interruptOn: def.interruptOn ?? null,
      });
    }
  }
  return out;
}

export const DEFAULT_AGENTS: AgentInput[] = loadDefaultAgents();
/** Seeded for a user with no agents: the first default (filename order). */
export const DEFAULT_HARNESS_AGENT: AgentInput = DEFAULT_AGENTS[0];
