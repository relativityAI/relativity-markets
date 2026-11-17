/**
 * Static catalog of the run toolbox — name + description for consumers that
 * need to know which tools exist without connecting to anything (draft
 * prompts, GET /tool-catalog, the skill-author TOOL_LIST).
 *
 * Hand-maintained: change it when buildRunTools' allow-lists change.
 * Deliberately static — connecting to the MCPs per request would keep four
 * containers warm just to render a reference page.
 */

export const TOOL_CATALOG: { name: string; description: string }[] = [
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

  // SearXNG MCP server (docker: isokoliuk/mcp-searxng in front of searxng)
  { name: "searxng_web_search", description: "Search the open web via the local SearXNG instance (categories=news for news; time_range=day|week|month|year)." },
  { name: "web_url_read", description: "Read one URL's content as markdown/text; supports PDFs and section extraction." },
  { name: "searxng_search_suggestions", description: "Autocomplete a partial query using SearXNG suggestions." },
  { name: "searxng_instance_info", description: "Inspect the SearXNG instance's categories, engines, and defaults." },

  // TradingView MCP server (docker: tradingview-mcp, streamable HTTP)
  { name: "get_technical_analysis", description: "Full TradingView technical analysis: RSI, MACD, Bollinger, 23 indicators with BUY/SELL/HOLD." },
  { name: "get_multi_timeframe_analysis", description: "Weekly→Daily→4H→1H→15m alignment analysis for a symbol." },
  { name: "get_candlestick_patterns", description: "Detect 15 candlestick patterns on a symbol." },
  { name: "get_stock_decision", description: "3-layer decision engine: ranking + trade setup + quality score." },
  { name: "screen_stocks", description: "Multi-exchange TradingView screener with 20+ filter criteria." },
  { name: "scan_by_signal", description: "Scan by signal type (oversold, trending, breakout...)." },
  { name: "stock_screener", description: "List common/preferred stocks for any TradingView country market, ranked by market cap." },
  { name: "stock_prices", description: "Direct price lookup for specific EXCHANGE:SYMBOL pairs." },
  { name: "yahoo_price", description: "Real-time quote: price, change %, 52w high/low, market state." },
  { name: "market_snapshot", description: "Global overview: S&P500, NASDAQ, VIX, BTC, ETH, EUR/USD, SPY, GLD." },
  { name: "financial_news", description: "Live RSS headlines from Yahoo Finance, MarketWatch, CNBC (Marketaux-keyed)."},
  { name: "market_sentiment", description: "Reddit sentiment across finance communities (Marketaux-keyed)." },
  { name: "combined_analysis", description: "TradingView technicals + Reddit sentiment + live news → confluence decision." },

  // Tavily MCP (remote; connected only when the user's key is set)
  { name: "tavily_search", description: "AI web search with depth, time-range, and domain filters (topic=news for news)." },
  { name: "tavily_extract", description: "Extract clean markdown/text content from one or more URLs." },
];

export function getToolCatalog(): { name: string; description: string }[] {
  return TOOL_CATALOG;
}
