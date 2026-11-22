/**
 * Per-user MCP preferences (Settings → MCP). The harness config file stays
 * the source of truth for the preconfigured servers; prefs carry only two
 * things: `enabled: false` for a server the user switched off, and
 * user-added remote servers (`custom: true` + url) the config never knew.
 */
import type { McpSourceConfig } from "../harness/tools/sources.js";

export interface McpServerPref {
  name: string;
  /** Only set for user-added servers. */
  url?: string;
  /** Absent = enabled (the preconfigured default). */
  enabled?: boolean;
  custom?: boolean;
}

/** prefs.mcp_servers → entries; a malformed value is "no preferences". */
export function parseMcpPrefs(prefs: Record<string, string> | null | undefined): McpServerPref[] {
  try {
    const list = JSON.parse(prefs?.mcp_servers || "[]");
    if (!Array.isArray(list)) return [];
    return list.filter((e) => e && typeof e.name === "string" && e.name.trim());
  } catch {
    return [];
  }
}

/** User-added servers as run config; a custom name never shadows a
 *  configured one (the configured entry wins). */
export function runMcpEntries(configured: McpSourceConfig[], prefs: Record<string, string> | null | undefined): McpSourceConfig[] {
  const names = new Set(configured.map((c) => c.name));
  const custom: McpSourceConfig[] = [];
  const seen = new Set<string>();
  for (const e of parseMcpPrefs(prefs)) {
    const name = e.name.trim();
    if (!e.custom || !e.url?.trim() || names.has(name) || seen.has(name)) continue;
    seen.add(name);
    custom.push({ name, url: e.url.trim(), required: false });
  }
  return [...configured, ...custom];
}

/** Server names the user switched off in Settings. */
export function disabledMcpNames(prefs: Record<string, string> | null | undefined): Set<string> {
  return new Set(parseMcpPrefs(prefs).filter((e) => e.enabled === false).map((e) => e.name.trim()));
}

/** The allowlist for callers that send no per-run choice (alerts, retries):
 *  everything minus what the user disabled. undefined = nothing disabled, so
 *  "connect every configured server" stays the default. */
export function defaultMcpEnabled(
  entries: McpSourceConfig[],
  prefs: Record<string, string> | null | undefined,
): string[] | undefined {
  const off = disabledMcpNames(prefs);
  if (!off.size) return undefined;
  return entries.filter((e) => !off.has(e.name)).map((e) => e.name);
}
