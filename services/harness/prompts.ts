/**
 * System prompts — drop-in markdown presentation specs, selectable per run.
 *
 * Storage: `agents/config/prompts/*.md`, one file per named system prompt,
 * mapped by key in config/agent.yaml `prompts:`. Each file's YAML frontmatter
 * is the machine-enforceable rules; its prose is the agent's system
 * instructions. Report structure is NOT defined here — the active skill's
 * report-structure owns it.
 */

import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { promptDocPath, promptNames } from "./config.js";

export interface SystemPrompt {
  id: string;
  name: string;
  description: string;
  body: string;
  default?: boolean;
  required_sections?: string[];
  min_charts?: number;
  section_order?: string[];
  require_sources?: boolean;
  never_substitute?: string[];
  allowed_primitives?: string[];
}

const DEFAULT_ID = "default";
/** agent.yaml's default system prompt role — its file is the default choice. */
const DEFAULT_ROLE = "agents";

function titleFrom(id: string, body: string): string {
  const heading = body.match(/^#\s+(.+)$/m)?.[1]?.trim();
  return heading || id.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function parsePrompt(id: string, raw: string): SystemPrompt {
  let frontmatter: Record<string, any> = {};
  let body = raw;
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (m) {
    frontmatter = (parseYaml(m[1]) as Record<string, any>) ?? {};
    body = raw.slice(m[0].length);
  }
  return {
    id,
    name: String(frontmatter.name || titleFrom(id, raw)),
    description: String(frontmatter.description || ""),
    body: body.trim(),
    default: frontmatter.default === true || id === DEFAULT_ID,
    required_sections: Array.isArray(frontmatter.required_sections) ? frontmatter.required_sections.map(String) : undefined,
    min_charts: Number.isFinite(frontmatter.min_charts) ? Number(frontmatter.min_charts) : undefined,
    section_order: Array.isArray(frontmatter.section_order) ? frontmatter.section_order.map(String) : undefined,
    require_sources: frontmatter.require_sources === true,
    never_substitute: Array.isArray(frontmatter.never_substitute) ? frontmatter.never_substitute.map(String) : undefined,
    allowed_primitives: Array.isArray(frontmatter.allowed_primitives) ? frontmatter.allowed_primitives.map(String) : undefined,
  };
}

/** Every named system prompt; re-read per call so an edit is live. */
export function loadSystemPrompts(dir?: string): SystemPrompt[] {
  const out: SystemPrompt[] = [];
  for (const name of promptNames(dir)) {
    const path = promptDocPath(name, dir);
    if (!path) continue;
    try {
      const tpl = parsePrompt(name, readFileSync(path, "utf8"));
      out.push({ ...tpl, default: tpl.default || name === DEFAULT_ROLE });
    } catch {
      // unreadable prompt file = skipped; the run falls back to the default
    }
  }
  return out;
}

/** The prompt chosen by name; absent/unknown id → the default (`agents`). */
export function getSystemPrompt(id?: string, dir?: string): SystemPrompt | null {
  const all = loadSystemPrompts(dir);
  return (id ? all.find((t) => t.id === id) : null) ?? all.find((t) => t.default) ?? all[0] ?? null;
}

/** `{{name}}` placeholders → run values (symbol, title, date, source, agent). */
export function applyVariables(text: string, vars: Record<string, string | undefined>): string {
  return text.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (whole, key: string) => vars[key.toLowerCase()] ?? whole);
}

/** Data tools that only return text — nothing for the plot reference to promise. */
export const TEXT_TOOLS = new Set([
  "searxng_web_search", "web_url_read",
  "yfinance_search", "yfinance_get_ticker_news",
]);

/** True when at least one data tool can return series for the plot reference. */
export function hasSeriesTool(toolNames: Iterable<string>): boolean {
  for (const n of toolNames) if (!TEXT_TOOLS.has(n)) return true;
  return false;
}

/** Date lives per-turn (never in the static system prompt — cache killer). */
export function datedPrompt(text: string): string {
  return `Today's date: ${new Date().toISOString().slice(0, 10)}\n\n${text}`;
}
