/**
 * Compile a run profile into a runnable context: the skills, the tool
 * allowlist, the budget, and the selected system prompt.
 *
 * MULTI-SKILL (plugins): every requested skill resolves — a run carries all
 * skills of every selected plugin, pinned into the run (deepagents
 * pinnedSkills) and discovered from the mounted plugin sources. A profile
 * with no (resolvable) skills runs on the instructions doc alone.
 */

import { resolveSkill } from "./skills.js";
import type { HarnessSkill } from "./skills.js";
import type { Budget } from "./types.js";
import type { AgentDefinition } from "./store.js";
import { applyVariables, type SystemPrompt } from "./prompts.js";

export interface CompiledAgent {
  allowedTools: string[];
  budget: Budget;
  skills: HarnessSkill[];
  template: SystemPrompt | null;
}

/** The fields a compile needs from a profile (run builds one from plugins). */
export type CompileProfile = Pick<AgentDefinition, "name" | "skillIds" | "allowedTools" | "budget">;

export interface CompileOptions {
  template?: SystemPrompt | null;
  /** `{{placeholders}}` substituted into the prompt body. */
  vars?: Record<string, string | undefined>;
  /** Explicit skill ids (request override); omitted/empty = the profile's own pick. */
  skillIds?: string[];
}

export function compileAgent(userId: string, def: CompileProfile, opts: CompileOptions = {}): CompiledAgent {
  const ids = opts.skillIds?.length ? opts.skillIds : def.skillIds;
  const skills = ids.map((id) => resolveSkill(userId, id)).filter((s): s is HarnessSkill => s !== null);
  if (ids.length && skills.length < ids.length) {
    const missing = ids.filter((id) => !skills.some((s) => s.id === id));
    console.warn(`[run] skills "${missing.join(", ")}" did not resolve for "${def.name}" — running without them`);
  }
  const skillTools = new Set(skills.flatMap((s) => s.allowedTools));
  const allowedTools = def.allowedTools.length ? def.allowedTools : [...skillTools];
  const template = opts.template
    ? { ...opts.template, body: applyVariables(opts.template.body, opts.vars ?? {}) }
    : null;
  return { allowedTools, budget: def.budget, skills, template };
}
