/**
 * Barrel for the domain tools folder — everything the agent wiring (and the
 * modules the old harness exposed) needs:
 *   - the run composition root (buildRunTools) + its config schemas,
 *   - the per-source tool factories,
 *   - the shared engine pieces (search, untrusted wrapper, helper fns),
 *   - the Voyager client + tool catalogs.
 */

// ── Run composition + config ──────────────────────────────────────────────
export { buildRunTools, ToolSourcesSchema, McpSourceSchema } from "./sources.js";
export type { RunToolContext, ToolSourcesConfig, McpSourceConfig } from "./sources.js";

// ── Tool factories ────────────────────────────────────────────────────────
export { buildVoyagerTools, buildWebSearchTool } from "./voyager.js";
export { webSearchTool } from "./websearch.js";
export { yahooTools, yf } from "./yahoo.js";
export { webFetchTool } from "./webfetch.js";

// ── Context ───────────────────────────────────────────────────────────────
export { noResult, NO_RESULT } from "./context.js";
export type { ToolContext, VoyagerToolContext } from "./context.js";

// ── Helpers other modules import ──────────────────────────────────────────
export { wrapUntrusted } from "./untrusted.js";
export {
  renderToolResults,
  rawToolResult,
  extractToolCalls,
  cleanToolData,
  projectSections,
  assertSafePdfUrl,
  getToolCatalog,
  getAnalystToolCatalog,
} from "./voyager.js";
export { describeToolCall, kbTaskFromPath } from "./describe.js";

// ── Search engine (SearXNG/Tavily) ────────────────────────────────────────
export {
  webSearch,
  newsSearch,
  searxSearch,
  searxNewsSearch,
  toToolResult,
  newsToToolResult,
  webCfg,
  stripTags,
  USER_AGENT,
  disableSearchPacingForTests,
  configureSearchForTests,
  searchPacedForTests,
} from "./search.js";
export type {
  WebSearchResult,
  WebSearchOutcome,
  NewsSearchResult,
  NewsSearchOutcome,
  SearchOpts,
  WebCfg,
} from "./search.js";

// ── Voyager client + market data (old api/marketdata imports) ─────────────
export { VoyagerClient, VoyagerError, voyagerCircuitBreaker, toCountrySource, pullRecordCount, pullLastPulled } from "./voyager-client.js";
export type { PullStatus, PullJobStatus } from "./voyager-client.js";
export { toYahooSymbol, getPriceHistory, priceHistoryDigest, quoteDigest, getMacroSnapshot } from "../marketdata.js";
export type { PriceHistory, Candle } from "../marketdata.js";

// ── Shared app config + logging ───────────────────────────────────────────
export { config, parseCsv } from "./appconfig.js";
