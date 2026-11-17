/**
 * Live probes for the navbar's "Data sources" chips. One honest upstream
 * call per source (an MCP tools/list), never throws — a dead source is just
 * `ok:false` with the reason. The route caches for a minute so a page load
 * can't hammer the MCPs.
 */

import { MultiServerMCPClient } from "@langchain/mcp-adapters";

export interface SourceStatus {
  ok: boolean;
  href: string;
  error?: string;
}
export type SourceStatuses = Record<string, SourceStatus>;

/** Test seam — vitest stubs these; production uses the real ones. */
export interface ProbeDeps {
  /** MCP tool-list probe for a named source. */
  listMcpTools?: (name: string) => Promise<unknown>;
}

// A tools/list round-trip fans out over HTTP — a false "disconnected" chip is
// worse than a slow one.
const TIMEOUT_MS = 10_000;
const TTL_MS = 60_000;

const HREFS: Record<string, string> = {
  searxng: "https://github.com/ihor-sokoliuk/mcp-searxng",
  tradingview: "https://github.com/atilaahmettaner/tradingview-mcp",
  yahoo: "https://github.com/narumiruna/yfinance-mcp",
};

/** SearXNG liveness — the chip must not disagree with the search tool. */
function searxngUrl(): string {
  return `${(process.env.SEARXNG_URL || "http://localhost:8888").replace(/\/+$/, "")}/search?q=news&format=json`;
}

const shortErr = (e: unknown): string => String((e as Error)?.message || e).slice(0, 160);

/** The agent's data source: a real tools/list against its MCP server. */
async function probeMcp(name: string, urlEnv: string): Promise<{ ok: boolean; error?: string }> {
  const url = process.env[urlEnv] || "";
  if (!url) return { ok: false, error: `${urlEnv} is not set` };
  try {
    const client = new MultiServerMCPClient({
      throwOnLoadError: true,
      mcpServers: { [name]: { url, transport: "http" as const } },
    });
    const tools = await client.getTools();
    if (!tools.length) return { ok: false, error: "MCP server exposed no tools" };
    await client.close();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: shortErr(e) };
  }
}

export async function probeSources(deps: ProbeDeps = {}): Promise<SourceStatuses> {
  const listTools = deps.listMcpTools ?? (async (name: string) => {
    const map: Record<string, Promise<unknown>> = {
      searxng: fetch(searxngUrl(), { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { accept: "application/json" } })
        .then((r) => ({ ok: r.ok, error: r.ok ? undefined : `HTTP ${r.status}` }))
        .catch((e) => ({ ok: false, error: shortErr(e) })),
      yahoo: probeMcp("yfinance", "MCP_YFINANCE_URL"),
      tradingview: probeMcp("tradingview", "MCP_TRADINGVIEW_URL"),
    };
    return map[name] ?? Promise.resolve({ ok: false, error: `unknown source ${name}` });
  });

  const entries = await Promise.all(
    ["searxng", "yahoo", "tradingview"].map(async (name) => {
      const r = await listTools(name).then(
        (v: any) => ({ ok: v?.ok !== false, ...(v?.ok === false ? { error: v.error } : {}) }),
        (e) => ({ ok: false, error: shortErr(e) }),
      );
      return [name, { ...r, href: HREFS[name] }] as const;
    }),
  );

  return Object.fromEntries(entries);
}

let cache: { at: number; value: SourceStatuses } | null = null;

/** Cached view for the route — upstreams get probed at most once a minute. */
export async function getSourceStatuses(deps: ProbeDeps = {}): Promise<SourceStatuses> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
  const value = await probeSources(deps);
  cache = { at: Date.now(), value };
  return cache.value;
}
