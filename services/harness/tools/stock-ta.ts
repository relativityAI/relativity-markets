/**
 * stock_technical_analysis — full TA for stocks the TradingView MCP can't
 * reach (notably India NSE/BSE). Reuses marketdata.getPriceHistory, which
 * already maps NSE→.NS and BSE→.BO and computes the core indicators.
 * ponytail: no indicator engine — reuse the one already in marketdata.ts and
 * add only EMA + candlestick patterns on top.
 */
import { tool } from "langchain";
import { z } from "zod";
import type { StructuredTool } from "@langchain/core/tools";
import { ema, getPriceHistory, type Candle } from "../marketdata.js";

const last = <T>(arr: (T | null)[]): T | null => {
  for (let i = arr.length - 1; i >= 0; i--) if (arr[i] != null) return arr[i] as T;
  return null;
};

interface Shape { body: number; range: number; upper: number; lower: number; bull: boolean }

function shape(c: Candle): Shape {
  return {
    body: Math.abs(c.close - c.open),
    range: Math.max(c.high - c.low, 1e-9),
    upper: c.high - Math.max(c.open, c.close),
    lower: Math.min(c.open, c.close) - c.low,
    bull: c.close >= c.open,
  };
}

/** 15 named patterns on the latest candle. Deliberately compact — these are
 *  signals for the agent to weigh, not trade instructions. */
export function detectCandlesticks(candles: Candle[]): string[] {
  const n = candles.length;
  if (n < 3) return [];
  const s = candles.map(shape);
  const [a, b, c] = [s[n - 3], s[n - 2], s[n - 1]];
  const K = candles[n - 1];
  const P = candles[n - 2];
  const out: string[] = [];
  const doji = c.body <= 0.1 * c.range;
  const small = c.body <= 0.35 * c.range;
  const uptrend = K.close > candles[Math.max(0, n - 4)].close;

  if (doji) out.push("doji");
  if (doji && c.lower >= 0.6 * c.range && c.upper <= 0.1 * c.range) out.push("dragonfly_doji");
  if (doji && c.upper >= 0.6 * c.range && c.lower <= 0.1 * c.range) out.push("gravestone_doji");
  if (!doji && small && c.lower >= 2 * c.body && c.upper <= 0.3 * c.body) {
    out.push(uptrend ? "hanging_man" : "hammer");
  }
  if (!doji && small && c.upper >= 2 * c.body && c.lower <= 0.3 * c.body) {
    out.push(uptrend ? "shooting_star" : "inverted_hammer");
  }
  if (!b.bull && c.bull && K.close > P.open && K.open < P.close) out.push("bullish_engulfing");
  if (b.bull && !c.bull && K.open > P.close && K.close < P.open) out.push("bearish_engulfing");
  if (b.bull && K.open > P.open && K.close < P.close && c.body < b.body) out.push("bullish_harami");
  if (!b.bull && K.open < P.open && K.close > P.close && c.body < b.body) out.push("bearish_harami");
  if (!b.bull && c.bull && K.open < P.close && K.close > (P.open + P.close) / 2) out.push("piercing_line");
  if (b.bull && !c.bull && K.open > P.close && K.close < (P.open + P.close) / 2) out.push("dark_cloud_cover");
  if (c.bull && b.bull && a.bull && K.close > P.close && P.close > candles[n - 3].close) out.push("three_white_soldiers");
  if (!c.bull && !b.bull && !a.bull && K.close < P.close && P.close < candles[n - 3].close) out.push("three_black_crows");
  return out;
}

export function stockTechnicalAnalysisTool(): StructuredTool {
  return tool(
    async ({ symbol, exchange, range }) => {
      const sym = String(symbol).trim().toUpperCase();
      const ex = String(exchange || "").trim().toUpperCase();
      const rg = String(range || "2y");
      const h = await getPriceHistory(sym, rg, ex);
      if (!h) {
        return {
          error: `no price history for ${ex ? `${ex}:` : ""}${sym}`,
          hint: "Stocks only. India: symbol=RELIANCE exchange=NSE, or symbol=TCS exchange=BSE. US: symbol=AAPL exchange=NASDAQ.",
        };
      }
      const closes = h.candles.map((c) => c.close);
      const price = closes[closes.length - 1];
      const emas = {
        ema10: last(ema(closes, 10)),
        ema20: last(ema(closes, 20)),
        ema50: last(ema(closes, 50)),
        ema200: last(ema(closes, 200)),
      };
      const rsi14 = last(h.rsi14)?.value ?? null;
      const macd = last(h.macd) ?? null;
      const boll = last(h.bollinger) ?? null;
      const atr14 = last(h.atr14)?.value ?? null;

      const signals: string[] = [];
      let score = 0;
      const vote = (bullish: boolean, text: string) => {
        score += bullish ? 1 : -1;
        signals.push(`${bullish ? "+" : "-"} ${text}`);
      };
      if (emas.ema20 != null) vote(price > emas.ema20, `price ${price > emas.ema20 ? "above" : "below"} EMA20`);
      if (emas.ema50 != null) vote(price > emas.ema50, `price ${price > emas.ema50 ? "above" : "below"} EMA50`);
      if (emas.ema200 != null) vote(price > emas.ema200, `price ${price > emas.ema200 ? "above" : "below"} EMA200`);
      if (rsi14 != null) {
        if (rsi14 < 30) { score++; signals.push("+ RSI14 oversold"); }
        else if (rsi14 > 70) { score--; signals.push("- RSI14 overbought"); }
        else signals.push(`  RSI14 ${rsi14} neutral`);
      }
      if (macd?.histogram != null) vote(macd.histogram > 0, `MACD histogram ${macd.histogram > 0 ? "positive" : "negative"}`);
      if (boll?.mid != null) vote(price > boll.mid, `price ${price > boll.mid ? "above" : "below"} Bollinger mid`);

      const bias = score >= 3 ? "BUY" : score >= 1 ? "LEAN BUY" : score <= -3 ? "SELL" : score <= -1 ? "LEAN SELL" : "HOLD";
      const prev = closes[closes.length - 2];
      return {
        symbol: sym,
        exchange: ex || null,
        as_of: h.candles[h.candles.length - 1].date,
        source: h.source,
        price,
        change_percent: prev ? Math.round(((price - prev) / prev) * 10000) / 100 : null,
        ema: emas,
        rsi14,
        macd,
        bollinger: boll,
        atr14,
        vwap: h.vwap,
        fifty_two_week: h.fifty_two_week,
        candlestick_patterns: detectCandlesticks(h.candles),
        bias,
        score,
        signals,
      };
    },
    {
      name: "stock_technical_analysis",
      description:
        "Full technical analysis for a STOCK (no crypto): EMA10/20/50/200, RSI14, MACD, Bollinger, ATR14, VWAP and 15 candlestick patterns with a BUY/SELL/HOLD bias. Works for India — pass exchange=NSE or BSE (e.g. RELIANCE/NSE, TCS/BSE) and for global stocks (NASDAQ, NYSE).",
      schema: z.object({
        symbol: z.string().min(1).describe("Bare stock ticker, e.g. RELIANCE, TCS, AAPL"),
        exchange: z.string().optional().describe("Stock exchange: NSE | BSE | NASDAQ | NYSE. Optional but recommended."),
        range: z.string().optional().describe("Yahoo chart range: 1y, 2y (default), 5y, max."),
      }),
    },
  );
}
