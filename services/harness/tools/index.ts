/**
 * Barrel for the domain tools folder — everything the agent wiring needs:
 *   - the run composition root (buildRunTools) + its config schemas,
 *   - the shared tool guard + helpers other modules import,
 *   - the static tool catalog (drafts / GET /tool-catalog).
 *
 * All web search / market data is MCP now (sources.ts) — no built-in
 * SearXNG fetchers, no per-tool factories here.
 */

// ── Run composition + config ──────────────────────────────────────────────
export { buildRunTools, ToolSourcesSchema, McpSourceSchema } from "./sources.js";
export type { RunTools, RunToolContext, ToolSourcesConfig, McpSourceConfig } from "./sources.js";

// ── Context ───────────────────────────────────────────────────────────────
export { noResult, NO_RESULT } from "./context.js";

// ── Catalog (drafts, /tool-catalog) ───────────────────────────────────────
export { getToolCatalog, TOOL_CATALOG } from "./catalog.js";

// ── Helpers other modules import ──────────────────────────────────────────
export { wrapUntrusted } from "./untrusted.js";
export { describeToolCall } from "./describe.js";

// ── Market data (server-side chart/indicator client) ─────────────────────
export { toYahooSymbol, getPriceHistory, priceHistoryDigest, quoteDigest, getMacroSnapshot } from "../marketdata.js";
export type { PriceHistory, Candle } from "../marketdata.js";

// ── Shared app config + logging ───────────────────────────────────────────
export { parseCsv } from "./appconfig.js";
