/**
 * Live probes for MCP servers — the one health source behind the navbar
 * chips and the Settings/Run catalogs. A probe is one honest upstream call
 * (a tools/list; SearXNG gets its own search endpoint so the chip can't
 * disagree with the search tool), never throws: a dead source is just
 * `status:"down"` with the reason. Results cache per server for a minute
 * so a page load can't hammer the MCPs.
 */
import { MultiServerMCPClient, type StreamableHTTPConnection } from "@langchain/mcp-adapters";
import type { McpSourceConfig } from "../harness/tools/sources.js";
import { MCP_LABELS } from "../harness/tools/catalog.js";

export type ProbeStatus = "up" | "down" | "needs-key" | "needs-auth" | "no-url";

export interface ProbeResult {
  status: ProbeStatus;
  error?: string;
  /** Live tool names — set only when the probe reached the server. */
  tools: string[];
  /** Epoch ms of the probe that produced this result. */
  at: number;
}

export interface ProbeOptions {
  /** Run-context keys for `keyFrom` sources, e.g. { mcpkey_notes: "…" }. */
  keys?: Record<string, string | undefined>;
  /** Skip the cache read (Retry / test-connection want a fresh answer). */
  fresh?: boolean;
}

const TIMEOUT_MS = 10_000;
const TTL_MS = 60_000;

const shortErr = (e: unknown): string => String((e as Error)?.message || e).slice(0, 160);

/** SearXNG liveness — the chip must not disagree with the search tool. */
function searxngUrl(): string {
  return `${(process.env.SEARXNG_URL || "http://localhost:8888").replace(/\/+$/, "")}/search?q=news&format=json`;
}

type ProbeBody = Omit<ProbeResult, "at">;

const cache = new Map<string, { at: number; body: ProbeBody }>();

/** One honest round-trip: tools/list proves reachability AND lists tools. */
async function probeOnce(entry: McpSourceConfig, url: string, key?: string): Promise<ProbeBody> {
  // 401/403 = the server is up and demanding credentials (spec: MCP servers
  // answer 401 with WWW-Authenticate) — "needs auth", not "down".
  const classify = (msg: string): ProbeBody =>
    /status 40[13]|unauthorized|authentication failed/i.test(msg)
      ? { status: "needs-auth", error: msg, tools: [] }
      : { status: "down", error: msg, tools: [] };

  if (entry.name === "searxng") {
    // The MCP wrapper can be up while its searxng backend is down — probe
    // the endpoint the search tool actually calls.
    try {
      const r = await fetch(searxngUrl(), { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { accept: "application/json" } });
      if (r.ok) return { status: "up", tools: [] };
      const error = `HTTP ${r.status}`;
      return r.status === 401 || r.status === 403 ? { status: "needs-auth", error, tools: [] } : { status: "down", error, tools: [] };
    } catch (e) {
      return { status: "down", error: shortErr(e), tools: [] };
    }
  }
  try {
    let connection: StreamableHTTPConnection = { url, transport: "http" };
    if (key) connection = { ...connection, headers: { Authorization: `Bearer ${key}` } };
    const client = new MultiServerMCPClient({ throwOnLoadError: true, mcpServers: { [entry.name]: connection } });
    try {
      const tools = await client.getTools();
      if (!tools.length) return { status: "down", error: "MCP server exposed no tools", tools: [] };
      return { status: "up", tools: tools.map((t) => t.name) };
    } finally {
      await client.close();
    }
  } catch (e) {
    return classify(shortErr(e));
  }
}

/** Probe one server (url from the entry or its env var), cached a minute. */
export async function probeEntry(entry: McpSourceConfig, opts: ProbeOptions = {}): Promise<ProbeResult> {
  const now = Date.now();
  const url = entry.url ?? process.env[entry.urlEnv ?? ""] ?? "";
  if (!url) return { status: "no-url", error: `${entry.urlEnv ?? "url"} is not set`, tools: [], at: now };
  if (entry.keyFrom && !opts.keys?.[entry.keyFrom]?.trim())
    return { status: "needs-key", error: `no ${entry.keyFrom} for this user`, tools: [], at: now };

  const key = `${entry.name}|${url}`;
  const hit = cache.get(key);
  if (!opts.fresh && hit && now - hit.at < TTL_MS) return { ...hit.body, at: hit.at };

  const body = await probeOnce(entry, url, entry.keyFrom ? opts.keys?.[entry.keyFrom] : undefined);
  cache.set(key, { at: now, body });
  return { ...body, at: now };
}

/** Every server's health + live tools, probed in parallel. */
export async function probeAll(entries: McpSourceConfig[], opts: ProbeOptions = {}): Promise<Record<string, ProbeResult>> {
  const rows = await Promise.all(entries.map(async (e) => [e.name, await probeEntry(e, opts)] as const));
  return Object.fromEntries(rows);
}

/** Doc links for the navbar chip tooltip (server-name keyed). */
const HREFS: Record<string, string> = {
  searxng: "https://github.com/ihor-sokoliuk/mcp-searxng",
  tradingview: "https://github.com/atilaahmettaner/tradingview-mcp",
  yfinance: "https://github.com/narumiruna/yfinance-mcp",
};

export interface SourceStatus {
  ok: boolean;
  href: string;
  label: string;
  error?: string;
}

/**
 * Navbar chips — one row per configured server, no hardcoded list.
 * `keyFrom` sources are skipped: this public route has no user keys.
 */
export async function healthSources(entries: McpSourceConfig[], opts: ProbeOptions = {}): Promise<Record<string, SourceStatus>> {
  const probeable = entries.filter((e) => !e.keyFrom);
  const probes = await probeAll(probeable, opts);
  return Object.fromEntries(
    probeable.map((e) => {
      const p = probes[e.name];
      return [
        e.name,
        { ok: p.status === "up", href: HREFS[e.name] ?? "", label: MCP_LABELS[e.name] ?? e.name, ...(p.error ? { error: p.error } : {}) },
      ] as const;
    }),
  );
}
