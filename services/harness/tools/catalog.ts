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

  // Local stock TA (yahoo OHLCV) — the TradingView MCP has no India NSE/BSE TA.
  { name: "stock_technical_analysis", description: "Full stock TA: EMA10/20/50/200, RSI14, MACD, Bollinger, ATR14, VWAP, 15 candlestick patterns, BUY/SELL/HOLD bias. Use exchange=NSE or BSE for India." },

  // TradingView MCP server (docker: tradingview-mcp, streamable HTTP, v0.8.1)
  // ponytail: real server names only (the get_* docs names don't exist), and
  // stocks-only — the crypto scanners are deliberately not in the allow list.
  { name: "coin_analysis", description: "Full single-symbol stock TA: RSI, MACD, SMA/EMA, Bollinger, ATR, OBV. Pass exchange=NASDAQ/NYSE/NSE etc — the default KUCOIN is crypto." },
  { name: "multi_timeframe_analysis", description: "Weekly→Daily→4H→1H→15m alignment for a stock. Pass a stock exchange, not the KUCOIN default." },
  { name: "combined_analysis", description: "TradingView technicals + sentiment + news → confluence decision. Defaults to NASDAQ." },
  { name: "multi_agent_analysis", description: "Technical/sentiment/risk agent debate ending in a decision. Pass a stock exchange." },
  { name: "stock_screener", description: "Screen stocks by country (incl. india → NSE/BSE), ranked by market cap." },
  { name: "stock_prices", description: "Direct price lookup for EXCHANGE:SYMBOL pairs (e.g. NSE:RELIANCE, BSE:TCS)." },
  { name: "backtest_strategy", description: "Backtest strategies incl. ema_cross and triple_ema." },
  { name: "compare_strategies", description: "Ranked leaderboard across all strategies." },
  { name: "walk_forward_backtest_strategy", description: "Walk-forward validation of a strategy." },
  { name: "yahoo_price", description: "Real-time quote: price, change %, 52w high/low, market state." },
  { name: "financial_news", description: "Live headline financial news (category=stocks)." },
  { name: "market_sentiment", description: "Sentiment across finance communities (Marketaux-keyed)." },
];

/** Server-name → human label for the New Run MCP toggles (GET /mcp-sources). */
export const MCP_LABELS: Record<string, string> = {
  yfinance: "Yahoo Finance data (yfinance)",
  searxng: "Web search (SearXNG)",
  tradingview: "TradingView",
};

export function getToolCatalog(): { name: string; description: string }[] {
  return TOOL_CATALOG;
}
