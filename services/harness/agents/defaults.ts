/**
 * Default agents — file-defined, one Markdown file per agent (same idea as
 * skills' SKILL.md).
 *
 *   services/harness/agents/defaults/<file>.md
 *   ---
 *   name: Display Name        (required)
 *   skill: skill-id           (optional — one skill per agent)
 *   category: equity          (optional — agent class, from categories.yaml)
 *   ---
 *   <Markdown body = the agent's soul prompt>
 *
 * Files load in filename order; the first is the seed for a user with no
 * agents (store.ts re-exports it as DEFAULT_HARNESS_AGENT). To add a default:
 * drop a new .md here — no code change.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import type { AgentInput } from "./store.js";

const DEFAULTS_DIR = fileURLToPath(new URL("./defaults/", import.meta.url));

function loadDefaultAgent(file: string): AgentInput {
  const src = readFileSync(join(DEFAULTS_DIR, file), "utf8");
  const match = src.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/);
  if (!match) throw new Error(`default agent ${file}: missing YAML frontmatter delimited by ---`);
  const fm: unknown = parseYaml(match[1]);
  if (!fm || typeof fm !== "object" || Array.isArray(fm)) {
    throw new Error(`default agent ${file}: frontmatter must be a mapping`);
  }
  const { name, skill, category } = fm as Record<string, unknown>;
  if (typeof name !== "string" || !name.trim()) {
    throw new Error(`default agent ${file}: frontmatter "name" is required`);
  }
  const soulPrompt = (match[2] || "").trim();
  const skillIds = typeof skill === "string" && skill.trim() ? [skill.trim()] : [];
  return {
    name: name.trim(),
    category: typeof category === "string" && category.trim() ? category.trim() : "",
    soulPrompt,
    skillIds,
  };
}

export function loadDefaultAgents(): AgentInput[] {
  const files = readdirSync(DEFAULTS_DIR)
    .filter((f) => f.endsWith(".md"))
    .sort();
  if (!files.length) throw new Error(`no default agents found in ${DEFAULTS_DIR}`);
  return files.map(loadDefaultAgent);
}

export const DEFAULT_AGENTS: AgentInput[] = loadDefaultAgents();

/** Seeded for a user with no harness agents: the first default (filename order). */
export const DEFAULT_HARNESS_AGENT: AgentInput = DEFAULT_AGENTS[0];
