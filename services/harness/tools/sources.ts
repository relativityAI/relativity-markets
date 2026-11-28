/**
 * Tool sources — declarative config for what the agent's toolbox contains,
 * and the one composition root for a run's full toolset.
 *
 * `sources` names the optional MCP servers; all search/market data is MCP:
 *   mcp: [ {name, url|urlEnv, allow, keyFrom, required} ]
 *
 * `keyFrom` binds a per-run credential into the connection's Authorization
 * header (e.g. a custom server's API key) — never into the url or this
 * config file. When keyFrom is set and the run has no such key, the source
 * is skipped instead of connected keyless.
 *
 * URLs stay in env: the config holds the env var NAME (urlEnv), not the url.
 * All transports are streamable HTTP — compose overrides stdio entrypoints
 * to serve HTTP (see docker-compose.yml).
 */

import { z } from "zod";
import { MultiServerMCPClient, type StreamableHTTPConnection } from "@langchain/mcp-adapters";
import type { StructuredTool } from "langchain";
import { log } from "../../api/logger.js";
import { stockTechnicalAnalysisTool } from "./stock-ta.js";
import { resolveGroupTool } from "./taxonomy.js";

export const McpSourceSchema = z
  .object({
    /** Label for logs/errors. */
    name: z.string().min(1),
    /** Literal url (tests/CLI). Production should use urlEnv. */
    url: z.string().min(1).optional(),
    /** Env var that holds the url (e.g. "MCP_YFINANCE_URL"). */
    urlEnv: z.string().min(1).optional(),
    /** Server tool names to expose (null/absent = all). */
    allow: z.array(z.string()).nullable().optional(),
    /** Run-context key → Authorization: Bearer <key> header. */
    keyFrom: z.string().min(1).optional(),
    /** true → logged loudly when unreachable; the run proceeds without it. */
    required: z.boolean().optional(),
  })
  .refine((s) => s.url || s.urlEnv, { message: `needs "url" or "urlEnv"` });

export const ToolSourcesSchema = z.object({
  mcp: z.array(McpSourceSchema).optional(),
});

export type McpSourceConfig = z.infer<typeof McpSourceSchema>;
export type ToolSourcesConfig = z.infer<typeof ToolSourcesSchema>;

/** Per-run context bound into the tools: the analyzed company + credentials. */
export interface RunToolContext {
  symbol: string;
  source: string;
  /** Per-run MCP allowlist (server names). Absent = every configured source
   *  connects (CLI/back-compat); a list = only those names are considered. */
  mcpEnabled?: string[];
  /** keyFrom credentials are spread in as extra fields (e.g. mcpkey_notes). */
  [key: string]: unknown;
}

export interface RunTools {
  tools: StructuredTool[];
  /** Sources that could not connect (unreachable / no url / no key) — the
   *  run continues without them; the caller surfaces these. */
  skipped: string[];
  /** Close every MCP connection opened for this run — call in finally. */
  close: () => Promise<void>;
}

/** A down or absent MCP source degrades the toolbox, never the run: skip it,
 *  log loudly, and let the caller report what was missing (the run's notes
 *  carry it to the result page). */
const failOrSkip = (required: boolean, message: string): void => {
  log.warn("tools", `${required ? "[required] " : ""}skipping — ${message}`);
};

/**
 * Compose the run's full toolset — the toolbox the deep agent runs with.
 *
 * Every configured MCP server's tools, first-wins on name collision (a
 * louder log than the old last-wins silent replacement). No source is fatal:
 * a missing url, missing key or unreachable server is skipped and reported
 * in `skipped`, and the run continues with the toolbox it has.
 *
 * The caller MUST run `close()` when the run ends — MCP connections stay
 * open otherwise (each one is ~1 file descriptor).
 */
export async function buildRunTools(
  sources: ToolSourcesConfig | undefined,
  env: NodeJS.ProcessEnv,
  ctx: RunToolContext,
): Promise<RunTools> {
  const cfg = ToolSourcesSchema.parse(sources ?? {});
  const clients: MultiServerMCPClient[] = [];
  const tools: StructuredTool[] = [];
  const skipped: string[] = [];
  const seen = new Map<string, string>();

  const push = (source: string, tool: StructuredTool): void => {
    if (seen.has(tool.name)) {
      log.warn("tools", `name collision: "${tool.name}" from ${source} skipped — owned by ${seen.get(tool.name)}`);
      return;
    }
    seen.set(tool.name, source);
    tools.push(tool);
  };

  for (const entry of cfg.mcp ?? []) {
    // Per-run toggle: a disabled server never connects — explicitly disabled
    // beats the config's `required` flag (the user chose to turn it off).
    if (ctx.mcpEnabled && !ctx.mcpEnabled.includes(entry.name)) continue;
    const url = entry.url ?? env[entry.urlEnv ?? ""];
    const required = entry.required ?? true;
    if (!url) {
      skipped.push(entry.name);
      failOrSkip(required, `MCP source "${entry.name}" has no url — set ${entry.urlEnv ?? '"url"'} (in harness.config.json or the environment)`);
      continue;
    }

    let connection: StreamableHTTPConnection = { url, transport: "http" };
    if (entry.keyFrom) {
      const key = (ctx as unknown as Record<string, unknown>)[entry.keyFrom];
      if (typeof key !== "string" || !key.trim()) {
        skipped.push(entry.name);
        failOrSkip(false, `MCP source "${entry.name}" skipped — no ${entry.keyFrom} key for this run`);
        continue;
      }
      connection = { ...connection, headers: { Authorization: `Bearer ${key}` } };
    }

    try {
      const client = new MultiServerMCPClient({
        throwOnLoadError: true,
        mcpServers: { [entry.name]: connection },
      });
      clients.push(client);
      const serverTools = await client.getTools();
      const allow = entry.allow?.length ? new Set(entry.allow) : null;
      for (const t of serverTools) {
        if (allow && !allow.has(t.name)) continue;
        push(entry.name, t);
      }
    } catch (e: any) {
      skipped.push(entry.name);
      failOrSkip(required, `MCP source "${entry.name}" unreachable at ${url} — start the server or fix the url\n  ${e?.message || e}`);
    }
  }

  // Stocks-only TA for markets the TradingView MCP can't reach (India
  // NSE/BSE). Local tool, so it stays available even if an MCP source is down.
  push("local", stockTechnicalAnalysisTool());
  // Sector/industry runs: resolve the run's group key to constituents.
  push("local", resolveGroupTool());

  return { tools, skipped, close: () => Promise.allSettled(clients.map((c) => c.close())).then(() => undefined) };
}
