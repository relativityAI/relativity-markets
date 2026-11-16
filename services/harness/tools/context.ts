/**
 * Tool context — the per-run bindings the domain tools close over.
 *
 * Two shapes came over from the old harness:
 *   ToolContext          — the builtins' registry context (symbol/source/
 *                          tavilyKey); websearch + yahoo tools close over it.
 *   VoyagerToolContext   — the Voyager REST toolset's context; the voyager
 *                          tools close over it (symbol binding, plan 0.5/C2).
 *
 * LangChain tools only ever see the model's args, so factories in this folder
 * take the relevant context and bind it at build time. `VoyagerClient` is the
 * structural contract the real Voyager client (services/api/voyager.ts) has
 * always satisfied — the tools must never import the client implementation.
 */

export interface ToolContext {
  symbol: string;
  source: string;
  /** Per-run Tavily key (user settings) — web_search uses Tavily when set. */
  tavilyKey?: string;
}

/** Structural contract of VoyagerClient — no implementation, tools stay pure. */
export interface VoyagerClient {
  get(path: string, params?: Record<string, unknown>): Promise<any>;
  post(path: string, params?: Record<string, unknown>, body?: unknown): Promise<any>;
  getPullStatus(symbol: string, country: string, source: string): Promise<any>;
  triggerPull(symbol: string, country: string, source: string, filingType?: string, refresh?: boolean): Promise<any>;
  getPullJobStatus(jobId: string): Promise<any>;
  listPullJobs(limit?: number): Promise<any>;
  searchSymbols(q: string, opts?: { source?: string; limit?: number }): Promise<any>;
  getTechnicals(symbol: string, opts?: { source?: string; timeframes?: string[] }): Promise<any>;
  getMetricsBatch(
    symbols: string[],
    opts?: { source?: string; consolidated?: boolean; filing_type?: string; fields?: string },
  ): Promise<any>;
  getMarketNews(params?: { country?: string; days?: number; limit?: number }): Promise<any>;
  getTickerNews(symbol: string, params?: { country?: string; days?: number; limit?: number }): Promise<any>;
  searchReddit(query: string, limit?: number): Promise<any>;
  searchYouTube(query: string, limit?: number): Promise<any>;
  getYouTubeTranscript(videoId: string): Promise<any>;
}

export interface VoyagerToolContext {
  voyager: VoyagerClient;
  symbol: string;
  country: string;
  source: string;
  shareName: string;
  /** Macro/market evaluation: web_search must NOT append the company name (B6). */
  macro?: boolean;
}

/**
 * LangChain calls tool functions directly — there is no outer loop wrapper to
 * police them. A tool that "succeeds" with nothing (undefined/null) must not
 * reach the model as OK — OK-with-nothing invites fabrication — so every tool
 * body in this folder funnels through this guard (the old loop wrapper threw
 * "tool returned no data"; these tools return the error string instead).
 */
export const NO_RESULT = "tool returned no result";

export async function noResult<T>(run: () => Promise<T>): Promise<T | string> {
  const out = await run();
  if (out == null) return NO_RESULT;
  return out;
}
