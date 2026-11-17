/**
 * Live probes for the navbar's "Data sources" chips. One honest upstream
 * call per source (SearXNG search with format=json; the yfinance MCP server's
 * tool list), never throws — a dead source is just `ok:false` with the reason.
 * The route caches for a minute so a page load can't hammer upstreams.
 */

import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import { webCfg } from "../harness/tools/search.js";

export interface SourceStatus {
  ok: boolean;
  href: string;
  error?: string;
}
export type SourceStatuses = Record<string, SourceStatus>;

/** Test seam — vitest stubs these; production uses the real ones. */
export interface ProbeDeps {
  fetchImpl?: typeof fetch;
  /** MCP tool-list probe for the yfinance source. */
  listMcpTools?: () => Promise<unknown>;
}

// SearXNG's JSON search fans out to upstream engines — a live instance can
// take several seconds, and a false "disconnected" chip is worse than a slow one.
const TIMEOUT_MS = 10_000;
const TTL_MS = 60_000;

const HREFS = {
  searxng: "https://github.com/searxng/searxng",
  yahoo: "https://github.com/narumiruna/yfinance-mcp",
};

const shortErr = (e: unknown): string => String((e as Error)?.message || e).slice(0, 160);

async function probeFetch(fetchImpl: typeof fetch, url: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = await fetchImpl(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { accept: "application/json" },
    });
    return r.ok ? { ok: true } : { ok: false, error: `HTTP ${r.status}` };
  } catch (e) {
    return { ok: false, error: shortErr(e) };
  }
}

/** The agent's market-data source: a real tools/list against the MCP server. */
async function probeMcp(url: string): Promise<{ ok: boolean; error?: string }> {
  if (!url) return { ok: false, error: "MCP_YFINANCE_URL is not set" };
  try {
    const client = new MultiServerMCPClient({
      throwOnLoadError: true,
      mcpServers: { yfinance: { url, transport: "http" as const } },
    });
    const tools = await client.getTools();
    if (!tools.length) return { ok: false, error: "MCP server exposed no tools" };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: shortErr(e) };
  }
}

export async function probeSources(deps: ProbeDeps = {}): Promise<SourceStatuses> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const listTools = deps.listMcpTools ?? (() => probeMcp(process.env.MCP_YFINANCE_URL || ""));

  // Same URL resolution the search tool uses (agent.yaml web.baseUrl,
  // SEARXNG_URL env wins) — a chip must not disagree with the tool.
  const searxngUrl = `${webCfg().baseUrl.replace(/\/+$/, "")}/search?q=news&format=json`;

  const [searxng, yahoo] = await Promise.all([
    probeFetch(fetchImpl, searxngUrl),
    Promise.resolve()
      .then(() => listTools())
      .then(
        (r: any) => ({ ok: r?.ok !== false, ...(r?.ok === false ? { error: r.error } : {}) }),
        (e) => ({ ok: false as const, error: shortErr(e) }),
      ),
  ]);

  return {
    searxng: { ...searxng, href: HREFS.searxng },
    yahoo: { ...yahoo, href: HREFS.yahoo },
  };
}

let cache: { at: number; value: SourceStatuses } | null = null;

/** Cached view for the route — upstreams get probed at most once a minute. */
export async function getSourceStatuses(deps: ProbeDeps = {}): Promise<SourceStatuses> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
  const value = await probeSources(deps);
  cache = { at: Date.now(), value };
  return cache.value;
}
