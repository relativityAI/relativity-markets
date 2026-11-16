/**
 * Agent config — `agents/config/agent.yaml` maps each role to a plain
 * markdown doc under `config/prompts/` (AGENTS…): drop a file, edit a file,
 * no code change. Extra keys under `prompts:` are named system prompts —
 * choose one by name (CLI --system-prompt, API system_prompt, UI dropdown),
 * absent/unknown → `prompts.agents`. Everything is read per call so an edit
 * is live without a restart. HTML comments stripped, leading frontmatter
 * stripped (AGENTS.md's frontmatter is the format's verify contract — read
 * raw, the model never sees it), first 200 lines load. Missing file = "".
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

export interface AgentConfig {
  /** `agents` is the default system prompt; every OTHER key is a named one. */
  prompts: { agents: string; [name: string]: string };
  limits: {
    spillThresholdChars: number;
    spillHeadChars: number;
  };
  /** Local SearXNG web search — see tools/search.ts (absent keys fall back to defaults). */
  web: {
    baseUrl: string;
    timeoutMs: number;
    maxAttempts: number;
    minIntervalMs: number;
    maxConcurrent: number;
  };
  run: {
    saveWorkspace: boolean;
  };
}

export const AGENT_CONFIG_DEFAULT: AgentConfig = {
  prompts: {
    agents: "prompts/AGENTS.md",
  },
  limits: { spillThresholdChars: 8_000, spillHeadChars: 2_000 },
  web: { baseUrl: "http://localhost:8888", timeoutMs: 15_000, maxAttempts: 2, minIntervalMs: 750, maxConcurrent: 3 },
  run: { saveWorkspace: false },
};

function configDir(): string {
  const beside = fileURLToPath(new URL("./config/", import.meta.url));
  if (existsSync(beside)) return beside;
  // The config assets moved to assets/ (agent.yaml + prompts/) — try there
  // before walking up, otherwise promptDoc() resolves to "" and the system
  // prompt loses its body.
  const assets = fileURLToPath(new URL("./assets/", import.meta.url));
  if (existsSync(assets)) return assets;
  return walkUpToConfig();
}

/** Read agent.yaml (roles, limits, flags) per call so edits are live. */
export function loadAgentConfig(dir?: string): AgentConfig {
  try {
    const file = join(dir ?? configDir(), "agent.yaml");
    if (!existsSync(file)) return AGENT_CONFIG_DEFAULT;
    const y = (parse(readFileSync(file, "utf8")) ?? {}) as Partial<AgentConfig>;
    return {
      prompts: { ...AGENT_CONFIG_DEFAULT.prompts, ...(y.prompts ?? {}) },
      limits: { ...AGENT_CONFIG_DEFAULT.limits, ...(y.limits ?? {}) },
      web: { ...AGENT_CONFIG_DEFAULT.web, ...(y.web ?? {}) },
      run: { ...AGENT_CONFIG_DEFAULT.run, ...(y.run ?? {}) },
    };
  } catch (e: any) {
    console.warn("[config] agent.yaml unreadable — using defaults:", e?.message || e);
    return AGENT_CONFIG_DEFAULT;
  }
}

/** Absolute path of a prompt doc (agent.yaml prompts.*), "" when missing. */
export function promptDocPath(role: keyof AgentConfig["prompts"], dir?: string): string {
  const base = dir ?? configDir();
  const cfg = loadAgentConfig(base);
  const rel = cfg.prompts[role] ?? cfg.prompts.agents;
  const file = join(base, rel);
  return existsSync(file) ? file : "";
}

/** Named system prompts — agent.yaml prompts.* (agents is included). */
export function promptNames(dir?: string): string[] {
  return Object.keys(loadAgentConfig(dir).prompts);
}

/** Whether the COMPLETE filesystem gets persisted — a run flag overrides agent.yaml. */
export function shouldSaveWorkspace(override?: boolean): boolean {
  return override ?? loadAgentConfig().run.saveWorkspace;
}

/** A prompt doc by role: comment-stripped, frontmatter-stripped, 200-line cap. */
export function promptDoc(role: keyof AgentConfig["prompts"], dir?: string): string {
  const path = promptDocPath(role, dir);
  if (!path) return "";
  return readFileSync(path, "utf8")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/^---\n[\s\S]*?\n---\n?/, "")
    .split("\n")
    .slice(0, 200)
    .join("\n")
    .trim();
}

/** dist/ runs: bare tsc leaves .md assets in the source tree — walk up like the rest. */
function walkUpToConfig(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
    if (existsSync(join(dir, "package.json"))) return join(dir, "agents", "config");
  }
  return dir;
}
