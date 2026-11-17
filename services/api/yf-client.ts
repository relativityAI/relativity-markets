/**
 * Yahoo Finance client (yahoo-finance2) — shared by the UI-facing routes
 * (stock page overview). The agent's market data comes from the yfinance MCP
 * server instead; this is kept only for direct server-side quotes.
 */
import YahooFinance from "yahoo-finance2";

// logErrors off: a schema mismatch still throws — the 200-line upstream dump
// per failure would drown the server log.
export const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"], validation: { logErrors: false }, versionCheck: false });
