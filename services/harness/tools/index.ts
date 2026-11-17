/**
 * Barrel for the domain tools folder — everything the agent wiring needs:
 *   - the run composition root (buildRunTools) + its config schemas,
 *   - the web tools (SearXNG/Tavily search + fetch),
 *   - the shared tool guard + helpers other modules import,
 *   - the static tool catalog (drafts / GET /tool-catalog).
 */

// ── Run composition + config ──────────────────────────────────────────────
export { buildRunTools, ToolSourcesSchema, McpSourceSchema } from "./sources.js";
export type { RunToolContext, ToolSourcesConfig, McpSourceConfig } from "./sources.js";

// ── Tool factories ────────────────────────────────────────────────────────
export { webSearchTool } from "./websearch.js";
export { webFetchTool } from "./webfetch.js";

// ── Context ───────────────────────────────────────────────────────────────
export { noResult, NO_RESULT } from "./context.js";

// ── Catalog (drafts, /tool-catalog) ───────────────────────────────────────
export { getToolCatalog, TOOL_CATALOG } from "./catalog.js";

// ── Helpers other modules import ──────────────────────────────────────────
export { wrapUntrusted } from "./untrusted.js";
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

// ── Market data (server-side chart/indicator client) ─────────────────────
export { toYahooSymbol, getPriceHistory, priceHistoryDigest, quoteDigest, getMacroSnapshot } from "../marketdata.js";
export type { PriceHistory, Candle } from "../marketdata.js";

// ── Shared app config + logging ───────────────────────────────────────────
export { config, parseCsv } from "./appconfig.js";
