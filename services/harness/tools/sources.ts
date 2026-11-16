/**
 * Tool sources — declarative config for what the agent's toolbox contains,
 * and the one composition root for a run's full toolset.
 *
 * `sources` names the optional sources (websearch, yahoo builtins, N MCP
 * servers) with the SAME flags semantics as the old harness buildToolRegistry:
 *   websearch: false        → no web_search/search_news
 *   yahoo: false            → no yahoo-finance2 builtins
 *   mcp: [ {name, url|urlEnv, allow, prefix, required} ]
 * The Voyager MCP server is the data path; the REST toolset (buildVoyagerTools)
 * is NOT composed here — duplicate names (web_search, get_price_history…)
 * across sources are rejected by the agent runtime. MCP tool names stay
 * unprefixed unless an entry carries `prefix`. URL secrets stay in env: the
 * config holds the env var NAME (urlEnv), not the url.
 */

import { z } from "zod";
import { MultiServerMCPClient, type StreamableHTTPConnection } from "@langchain/mcp-adapters";
import type { StructuredTool } from "langchain";
import { log } from "../../api/logger.js";
import { webSearchTool } from "./websearch.js";
import { yahooTools } from "./yahoo.js";
import { buildVoyagerTools } from "./voyager.js";
import { VoyagerClient } from "./voyager-client.js";
import { config } from "./appconfig.js";

export const McpSourceSchema = z
  .object({
    /** Label for logs/errors — also the collision-prefix hint. */
    name: z.string().min(1),
    /** Literal url (tests/CLI). Production should use urlEnv. */
    url: z.string().min(1).optional(),
    /** Env var that holds the url (e.g. "MCP_VOYAGER_URL"). */
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
  /** `false` disables the yahoo-finance2 builtins; `{}` (or absent) = on, keyless. */
  yahoo: z.union([z.object({}), z.literal(false)]).optional(),
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

/** Default when the file has no `tools` section (or `mcp` is empty): the
 *  Voyager MCP is optional — the REST toolset is already the base toolbox. */
const DEFAULT_MCP: McpSourceConfig[] = [{ name: "voyager", urlEnv: "MCP_VOYAGER_URL", required: false }];

/**
 * Compose the run's full toolset — the toolbox the deep agent runs with.
 *
 * Base: the Voyager REST toolset (symbol/source bound in the closure; direct
 * to VOYAGER_URL, no external server needed). Then the websearch + yahoo
 * builtins fill only the names the base doesn't already cover (duplicate
 * tool names are rejected by the agent runtime). Finally the configured MCP
 * servers' tools, last-wins on collision (the old registry's semantics —
 * logged loudly). Throws when a `required` source is missing or unreachable;
 * optional sources just warn and the run continues without them.
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
    if (idx >= 0) return; // first source wins: base REST tools beat builtins
    tools.push(tool);
  };

  // Voyager REST tools: the analyzed company is bound in the closure —
  // model-supplied symbol args are ignored. shareName is unknown at this
  // layer, so web_search's company suffix falls back to the symbol, exactly
  // like the old `ctx.shareName || ctx.symbol` path.
  if (config.voyagerApiKey || config.voyagerUrl) {
    const voyagerCtx = {
      voyager: new VoyagerClient(config.voyagerUrl, config.voyagerApiKey, config.voyagerRpm),
      symbol: ctx.symbol,
      country: ctx.source === "sec" ? "us" : "in",
      source: ctx.source,
      shareName: "",
    };
    for (const t of Object.values(buildVoyagerTools(voyagerCtx, { analyst: true }))) push(t);
  }

  if (cfg.websearch !== false) {
    for (const t of webSearchTool({ tavilyKey: ctx.tavilyKey })) push(t);
  }
  if (cfg.yahoo !== false) {
    for (const t of yahooTools(ctx)) push(t);
  }

  const mcp = cfg.mcp && cfg.mcp.length ? cfg.mcp : DEFAULT_MCP;
  for (const entry of mcp) {
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
      // Last-wins on collision (the old registry's name→tool record), logged loudly.
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
