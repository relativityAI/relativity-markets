/**
 * Tool sources — declarative config for what the agent's toolbox contains,
 * and the one composition root for a run's full toolset.
 *
 * `sources` names the optional sources (websearch, N MCP servers):
 *   websearch: false        → no web_search/search_news
 *   mcp: [ {name, url|urlEnv, allow, prefix, required} ]
 * All market data comes from MCP servers (yfinance now, Voyager later) —
 * there is no built-in data toolset anymore. MCP tool names stay unprefixed
 * unless an entry carries `prefix`. URL secrets stay in env: the config holds
 * the env var NAME (urlEnv), not the url.
 */

import { z } from "zod";
import { MultiServerMCPClient, type StreamableHTTPConnection } from "@langchain/mcp-adapters";
import type { StructuredTool } from "langchain";
import { log } from "../../api/logger.js";
import { webSearchTool } from "./websearch.js";

export const McpSourceSchema = z
  .object({
    /** Label for logs/errors — also the collision-prefix hint. */
    name: z.string().min(1),
    /** Literal url (tests/CLI). Production should use urlEnv. */
    url: z.string().min(1).optional(),
    /** Env var that holds the url (e.g. "MCP_YFINANCE_URL"). */
    urlEnv: z.string().min(1).optional(),
    /** Server tool names to expose (null/absent = all). */
    allow: z.array(z.string()).nullable().optional(),
    /** Prefix for exposed names (calls still use the raw server name). */
    prefix: z.string().optional(),
    /** true (default) → the run fails if this server can't be reached. */
    required: z.boolean().optional(),
  })
  .refine((s) => s.url || s.urlEnv, { message: `needs "url" or "urlEnv"` });

export const ToolSourcesSchema = z.object({
  /** `false` disables websearch; `{}` (or absent) = local SearXNG, free/keyless. */
  websearch: z.union([z.object({}), z.literal(false)]).optional(),
  mcp: z.array(McpSourceSchema).optional(),
});

export type McpSourceConfig = z.infer<typeof McpSourceSchema>;
export type ToolSourcesConfig = z.infer<typeof ToolSourcesSchema>;

/** Per-run context bound into the tools: the analyzed company + the user's Tavily key. */
export interface RunToolContext {
  symbol: string;
  source: string;
  tavilyKey?: string;
}

/**
 * Compose the run's full toolset — the toolbox the deep agent runs with.
 *
 * Base: websearch (SearXNG/Tavily). Then every configured MCP server's tools
 * (yfinance), last-wins on collision with a loud log. Throws when a `required`
 * source has no url or is unreachable; optional sources just warn and the run
 * continues without them.
 */
export async function buildRunTools(
  sources: ToolSourcesConfig | undefined,
  env: NodeJS.ProcessEnv,
  ctx: RunToolContext,
): Promise<StructuredTool[]> {
  const cfg = ToolSourcesSchema.parse(sources ?? {});
  const tools: StructuredTool[] = [];

  const push = (tool: StructuredTool): void => {
    const idx = tools.findIndex((r) => r.name === tool.name);
    if (idx >= 0) return; // first source wins
    tools.push(tool);
  };

  if (cfg.websearch !== false) {
    for (const t of webSearchTool({ tavilyKey: ctx.tavilyKey })) push(t);
  }

  for (const entry of cfg.mcp ?? []) {
    const url = entry.url ?? env[entry.urlEnv ?? ""];
    const required = entry.required ?? true;
    if (!url) {
      failOrSkip(required, `MCP source "${entry.name}" has no url — set ${entry.urlEnv ?? '"url"'} (in harness.config.json or the environment)`);
      continue;
    }
    let serverTools: StructuredTool[];
    try {
      const client = new MultiServerMCPClient({
        throwOnLoadError: true,
        mcpServers: {
          [entry.name]: { url, transport: "http" } satisfies StreamableHTTPConnection,
        },
      });
      serverTools = await client.getTools();
    } catch (e: any) {
      failOrSkip(required, `MCP source "${entry.name}" unreachable at ${url} — start the server or fix the url\n  ${e?.message || e}`);
      continue;
    }
    const allow = entry.allow?.length ? new Set(entry.allow) : null;
    for (const t of serverTools) {
      if (allow && !allow.has(t.name)) continue;
      if (entry.prefix) t.name = `${entry.prefix}${t.name}`;
      // Last-wins on collision, logged loudly.
      const idx = tools.findIndex((r) => r.name === t.name);
      if (idx >= 0) {
        log.warn("tools", `name collision: MCP source "${entry.name}" tool "${t.name}" replaces the existing tool — set a prefix on the entry to keep both`);
        tools[idx] = t;
      } else {
        tools.push(t);
      }
    }
  }
  return tools;
}

function failOrSkip(required: boolean, message: string): void {
  if (required) throw new Error(message);
  log.warn("tools", `skipping — ${message}`);
}
