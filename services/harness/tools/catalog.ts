/**
 * Static catalog of the run toolbox — name + description for consumers that
 * need to know which tools exist without connecting to anything (draft
 * prompts, GET /tool-catalog, the skill-author TOOL_LIST).
 *
 * Hand-maintained: change it when buildRunTools adds/removes a source.
 * Deliberately static — connecting to the MCP per request would spawn a
 * container just to render a reference page.
 */

export const TOOL_CATALOG: { name: string; description: string }[] = [
  // SearXNG / Tavily web tools
  { name: "web_search", description: "Search the open web (SearXNG, keyless; Tavily when a key is set)." },
  { name: "search_news", description: "Search recent news articles on the open web." },
  // yfinance MCP server (docker: narumi/yfinance-mcp)
  { name: "yfinance_search", description: "Search Yahoo Finance for stocks, ETFs, and news." },
  { name: "yfinance_get_ticker_info", description: "Company profile, price, valuation, and trading metrics for a ticker." },
  { name: "yfinance_get_price_history", description: "Historical OHLCV data; optional candlestick/VWAP/volume-profile chart." },
  { name: "yfinance_get_financials", description: "Income statement, balance sheet, and cash flow (annual/quarterly/ttm)." },
  { name: "yfinance_get_ticker_news", description: "Recent news articles and press releases for a ticker." },
  { name: "yfinance_get_analyst_price_targets", description: "Analyst consensus price targets (low/high/mean/median)." },
  { name: "yfinance_get_analyst_estimates", description: "EPS/revenue estimates, revision trends, recommendations." },
  { name: "yfinance_get_upgrades_downgrades", description: "Analyst upgrades, downgrades, initiations, price-target changes." },
  { name: "yfinance_get_holders", description: "Major, institutional, and mutual-fund holders plus insider transactions." },
  { name: "yfinance_get_fund_data", description: "ETF/mutual-fund composition, holdings, exposures, and ratings." },
  { name: "yfinance_get_option_dates", description: "Available option expiration dates for a ticker." },
  { name: "yfinance_get_option_chain", description: "Option chain with strikes, prices, IV, and open interest." },
  { name: "yfinance_get_top", description: "Top ETFs, funds, or companies within a market sector." },
  { name: "yfinance_screen", description: "Run a Yahoo Finance screener (predefined or custom query tree)." },
  { name: "yfinance_screen_gappers", description: "Prebuilt screener for opening-session bullish gap-ups." },
];

export function getToolCatalog(): { name: string; description: string }[] {
  return TOOL_CATALOG;
}
