/**
 * Agent class/category list — file-defined (services/config/categories.yaml),
 * same idea as models.yaml. One category per agent; the creation popup's
 * Category dropdown and the POST/PUT /agents validation both read this list.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const CATEGORIES_FILE = fileURLToPath(new URL("../config/categories.yaml", import.meta.url));

let cache: string[] | null = null;

export function getAgentCategories(): string[] {
  if (!cache) {
    const raw = readFileSync(CATEGORIES_FILE, "utf8");
    const parsed = YAML.parse(raw) as { agent_categories?: string[] };
    cache = (parsed.agent_categories ?? []).map(String);
  }
  return cache;
}

export function isValidAgentCategory(category: unknown): boolean {
  return typeof category === "string" && getAgentCategories().includes(category);
}
