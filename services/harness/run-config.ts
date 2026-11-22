/**
 * Run configuration layering — flags > HARNESS_* env > harness.config.json >
 * built-ins. One obvious file to edit (harness.config.json at the package
 * root), env overrides for one-offs, code wins for explicit flags.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_BUDGET, type Budget } from "./types.js";
import { ToolSourcesSchema, type ToolSourcesConfig } from "./tools/sources.js";

export const CONFIG_FILENAME = "harness.config.json";

export const DEFAULT_MODEL = "opencode/deepseek-v4.1-flash";
/** Empty = the run picks the agent's own skill; set an id to force one. */
export const DEFAULT_SKILLS: string[] = [];

/** The file's shape. `_help` is a comment field (ignored by resolution). */
export interface RunFileConfig {
  _help?: string;
  model?: string;
  skills?: string[];
  source?: string;
  tools?: ToolSourcesConfig;
  budget?: Partial<Budget>;
}

export interface LoadedRunConfig {
  file: string | null;
  config: RunFileConfig;
}

/** First defined, non-blank candidate — the precedence primitive. */
export function firstValue<T>(...candidates: (T | undefined | null)[]): T | undefined {
  for (const c of candidates) {
    if (c === undefined || c === null) continue;
    if (typeof c === "string" && c.trim() === "") continue;
    return c;
  }
  return undefined;
}

/** Read harness.config.json: cwd first, else the nearest package root. */
export function loadRunFileConfig(cwd: string = process.cwd()): LoadedRunConfig {
  for (const file of candidates(cwd)) {
    if (!existsSync(file)) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(file, "utf8"));
    } catch (e: any) {
      throw new Error(`${CONFIG_FILENAME} at ${file} is not valid JSON: ${e?.message || e}`);
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`${CONFIG_FILENAME} at ${file} must be a JSON object`);
    }
    const config = parsed as RunFileConfig;
    if (config.skills !== undefined && (!Array.isArray(config.skills) || config.skills.some((s) => typeof s !== "string"))) {
      throw new Error(`${CONFIG_FILENAME}: "skills" must be an array of strings`);
    }
    if (config.budget !== undefined && (typeof config.budget !== "object" || config.budget === null || Array.isArray(config.budget))) {
      throw new Error(`${CONFIG_FILENAME}: "budget" must be an object`);
    }
    if (config.tools !== undefined) {
      const parsedTools = ToolSourcesSchema.safeParse(config.tools);
      if (!parsedTools.success) {
        throw new Error(`${CONFIG_FILENAME}: "tools" is invalid — ${parsedTools.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`);
      }
      config.tools = parsedTools.data;
    }
    return { file, config };
  }
  return { file: null, config: {} };
}

function candidates(cwd: string): string[] {
  const out = [join(cwd, CONFIG_FILENAME)];
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
    if (existsSync(join(dir, "package.json"))) {
      out.push(join(dir, CONFIG_FILENAME));
      break;
    }
  }
  return out;
}

export interface ResolvedRunConfig {
  model: string;
  skills: string[];
  source: string;
  budget: Partial<Budget>;
  tools: ToolSourcesConfig | undefined;
}

/**
 * Layer HARNESS_* env vars and the config file into one resolved config.
 * Pure: env and file are inputs, so the precedence is testable.
 */
export function resolveRunConfig(env: NodeJS.ProcessEnv, file: RunFileConfig): ResolvedRunConfig {
  const budget: Partial<Budget> = {
    ...file.budget,
    maxSteps: firstValue(env.HARNESS_MAX_STEPS ? Number(env.HARNESS_MAX_STEPS) : undefined, file.budget?.maxSteps, DEFAULT_BUDGET.maxSteps)!,
    maxTokens: firstValue(env.HARNESS_MAX_TOKENS ? Number(env.HARNESS_MAX_TOKENS) : undefined, file.budget?.maxTokens, DEFAULT_BUDGET.maxTokens)!,
  };
  const skillsRaw = firstValue(env.HARNESS_SKILLS, file.skills?.join(","));
  return {
    model: firstValue(env.HARNESS_MODEL, file.model, DEFAULT_MODEL)!,
    // Skill ids the CLI/config pins — every entry loads (plugins are multi-skill).
    skills: (skillsRaw ?? DEFAULT_SKILLS.join(",")).split(",").map((s) => s.trim()).filter(Boolean),
    source: firstValue(env.HARNESS_SOURCE, file.source, "SEC")!.toUpperCase(),
    budget,
    tools: file.tools,
  };
}
