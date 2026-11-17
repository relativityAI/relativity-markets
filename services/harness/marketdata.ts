/**
 * marketdata — server-side price-history client for the technical-analysis
 * skill (decision D5).
 *
 * Primary source: Yahoo Finance chart API (no API key, 15-minute cache).
 * Graceful failure: any outage returns null and the pipeline degrades to a
 * missing-data note. Chart data assembled here is code-grounded — the LLM
 * never types OHLCV values.
 */

import { log } from "../api/logger.js";

export interface Candle {
  date: string; // YYYY-MM-DD
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface PriceHistory {
  symbol: string;
  range: string;
  interval: string;
  candles: Candle[];
  sma20: { date: string; value: number | null }[];
  sma50: { date: string; value: number | null }[];
  sma200: { date: string; value: number | null }[];
  rsi14: { date: string; value: number | null }[];
  macd: { date: string; macd: number | null; signal: number | null; histogram: number | null }[];
  atr14: { date: string; value: number | null }[];
  bollinger: { date: string; upper: number | null; mid: number | null; lower: number | null }[];
  vwap: number;
  fifty_two_week: { high: number; low: number };
  fetched_at: string;
  source: "yahoo";
}

const CACHE_TTL_MS = 15 * 60 * 1000;
const MAX_CANDLES = 400; // ~1.5 years of trading days

/** Yahoo exchange suffix by source: NSE→.NS, BSE→.BO, else bare. Symbols
 *  already carrying a suffix ("RELIANCE.NS", "^NSEI") are returned as-is. */
export function toYahooSymbol(symbol: string, source?: string): string {
  if (symbol.includes(".") || symbol.startsWith("^")) return symbol;
  const ex = (source || "").toLowerCase();
  return ex === "nse" ? `${symbol}.NS` : ex === "bse" ? `${symbol}.BO` : symbol;
}

const cache = new Map<string, { at: number; data: PriceHistory | null }>();

function sma(closes: number[], period: number): (number | null)[] {
  const out: (number | null)[] = [];
  let sum = 0;
  for (let i = 0; i < closes.length; i++) {
    sum += closes[i];
    if (i >= period) sum -= closes[i - period];
    out.push(i >= period - 1 ? Math.round((sum / period) * 10000) / 10000 : null);
  }
  return out;
}

/** Wilder's RSI (standard 14-period smoothing). */
function rsi(closes: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(closes.length).fill(null);
  if (closes.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  out[period] = avgLoss === 0 ? 100 : Math.round((100 - 100 / (1 + avgGain / avgLoss)) * 100) / 100;
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    const g = d > 0 ? d : 0;
    const l = d < 0 ? -d : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
    out[i] = avgLoss === 0 ? 100 : Math.round((100 - 100 / (1 + avgGain / avgLoss)) * 100) / 100;
  }
  return out;
}

function ema(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let prev = 0;
  for (let i = 0; i < period; i++) prev += values[i];
  prev /= period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

function macdSeries(closes: number[], fast = 12, slow = 26, signalP = 9) {
  const emaFast = ema(closes, fast);
  const emaSlow = ema(closes, slow);
  const macdLine: (number | null)[] = closes.map((_, i) =>
    emaFast[i] != null && emaSlow[i] != null ? (emaFast[i] as number) - (emaSlow[i] as number) : null,
  );
  const signalLine: (number | null)[] = new Array(closes.length).fill(null);
  const firstIdx = macdLine.findIndex((v) => v != null);
  if (firstIdx >= 0) {
    const valid = macdLine.slice(firstIdx).map((v) => v as number);
    const sig = ema(valid, signalP);
    for (let i = 0; i < sig.length; i++) signalLine[firstIdx + i] = sig[i];
  }
  const histogram = macdLine.map((v, i) => (v != null && signalLine[i] != null ? v - (signalLine[i] as number) : null));
  return { macdLine, signalLine, histogram };
}

/** Wilder's ATR (14-period). */
function atrSeries(candles: Candle[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(candles.length).fill(null);
  if (candles.length <= period) return out;
  const trs: number[] = [0];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const pc = candles[i - 1].close;
    trs.push(Math.max(c.high - c.low, Math.abs(c.high - pc), Math.abs(c.low - pc)));
  }
  let a = 0;
  for (let i = 1; i <= period; i++) a += trs[i];
  a /= period;
  out[period] = a;
  for (let i = period + 1; i < candles.length; i++) {
    a = (a * (period - 1) + trs[i]) / period;
    out[i] = a;
  }
  return out;
}

function bollingerSeries(closes: number[], period = 20, mult = 2) {
  const mid = sma(closes, period);
  const upper: (number | null)[] = new Array(closes.length).fill(null);
  const lower: (number | null)[] = new Array(closes.length).fill(null);
  for (let i = period - 1; i < closes.length; i++) {
    const m = mid[i] as number;
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += (closes[j] - m) ** 2;
    const sd = Math.sqrt(sum / period);
    upper[i] = m + mult * sd;
    lower[i] = m - mult * sd;
  }
  return { mid, upper, lower };
}

/** Session VWAP over the available window (typical price × volume). */
function vwapOf(candles: Candle[]): number {
  let pv = 0;
  let vol = 0;
  for (const c of candles) {
    const tp = (c.high + c.low + c.close) / 3;
    pv += tp * c.volume;
    vol += c.volume;
  }
  return vol > 0 ? pv / vol : 0;
}

/** Count weekdays between a YYYY-MM-DD date and today (exclusive of both endpoints' partial days). */
function tradingDaysOld(dateStr: string): number {
  const latest = new Date(dateStr + "T00:00:00");
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let count = 0;
  const d = new Date(latest);
  d.setDate(d.getDate() + 1);
  while (d.getTime() < today.getTime()) {
    const day = d.getDay();
    if (day !== 0 && day !== 6) count++;
    d.setDate(d.getDate() + 1);
  }
  return count;
}

interface YahooChartResponse {
  chart?: {
    result?: {
      meta?: { regularMarketPrice?: number; fiftyTwoWeekHigh?: number; fiftyTwoWeekLow?: number; currency?: string };
      timestamp?: number[];
      indicators?: {
        quote?: { open?: (number | null)[]; high?: (number | null)[]; low?: (number | null)[]; close?: (number | null)[]; volume?: (number | null)[] }[];
      };
    }[];
    error?: unknown;
  };
}

/**
 * Fetch daily OHLCV + indicators for a symbol. Returns null on any failure —
 * callers must degrade (never fabricate).
 */
export async function getPriceHistory(symbol: string, range = "2y", source?: string): Promise<PriceHistory | null> {
  const key = `${symbol}:${range}:${source || ""}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;

  const data = await fetchYahoo(symbol, range, source);
  cache.set(key, { at: Date.now(), data });
  return data;
}

async function fetchYahoo(symbol: string, range: string, source?: string): Promise<PriceHistory | null> {
  // Yahoo distinguishes listings by exchange suffix — an NSE ticker
  // queried bare ("GLAND") 404s with "No data found, symbol may be
  // delisted", which grounded every price chart on nothing.
  const q = toYahooSymbol(symbol, source);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(q)}?range=${encodeURIComponent(range)}&interval=1d&includePrePost=false`;
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(15_000),
      headers: { "user-agent": "Mozilla/5.0 (compatible; RelativityPortfolio/1.0)" },
    });
    if (!res.ok) {
      log.warn("marketdata", `yahoo ${symbol} status ${res.status}`);
      return null;
    }
    const json = (await res.json()) as YahooChartResponse;
    const result = json.chart?.result?.[0];
    const ts = result?.timestamp;
    const q = result?.indicators?.quote?.[0];
    if (!ts?.length || !q?.close) return null;

    const candles: Candle[] = [];
    for (let i = 0; i < ts.length; i++) {
      const o = q.open?.[i];
      const h = q.high?.[i];
      const l = q.low?.[i];
      const c = q.close?.[i];
      if (c == null) continue; // skip null trading days
      candles.push({
        date: new Date(ts[i] * 1000).toISOString().slice(0, 10),
        open: o ?? c,
        high: h ?? c,
        low: l ?? c,
        close: c,
        volume: q.volume?.[i] ?? 0,
      });
    }
    if (candles.length < 30) return null;

    // Freshness SLA (WS-4): reject when the latest candle is >1 trading day
    // old (weekend-aware). Stale candles must never be labelled "recent".
    // ponytail: weekday-only check — a holiday calendar would need a market
    // holiday feed; add one if a long-weekend stale candle ever ships.
    const latestDate = candles[candles.length - 1].date;
    if (tradingDaysOld(latestDate) > 1) {
      log.warn("marketdata", `stale price data for ${symbol}: latest candle ${latestDate} is ${tradingDaysOld(latestDate)} trading days old`);
      return null;
    }

    const trimmed = candles.slice(-MAX_CANDLES);
    const closes = trimmed.map((c) => c.close);
    const s20 = sma(closes, 20);
    const s50 = sma(closes, 50);
    const s200 = sma(closes, 200);
    const r14 = rsi(closes, 14);
    const macd = macdSeries(closes);
    const atr14 = atrSeries(trimmed);
    const boll = bollingerSeries(closes);

    const highs = trimmed.map((c) => c.high);
    const lows = trimmed.map((c) => c.low);

    return {
      symbol: symbol.toUpperCase(),
      range,
      interval: "1d",
      candles: trimmed,
      sma20: trimmed.map((c, i) => ({ date: c.date, value: s20[i] })),
      sma50: trimmed.map((c, i) => ({ date: c.date, value: s50[i] })),
      sma200: trimmed.map((c, i) => ({ date: c.date, value: s200[i] })),
      rsi14: trimmed.map((c, i) => ({ date: c.date, value: r14[i] })),
      macd: trimmed.map((c, i) => ({ date: c.date, macd: macd.macdLine[i], signal: macd.signalLine[i], histogram: macd.histogram[i] })),
      atr14: trimmed.map((c, i) => ({ date: c.date, value: atr14[i] })),
      bollinger: trimmed.map((c, i) => ({ date: c.date, upper: boll.upper[i], mid: boll.mid[i], lower: boll.lower[i] })),
      vwap: vwapOf(trimmed),
      fifty_two_week: {
        high: Math.max(...highs.slice(-252)),
        low: Math.min(...lows.slice(-252)),
      },
      fetched_at: new Date().toISOString(),
      source: "yahoo",
    };
  } catch (e: any) {
    log.warn("marketdata", `yahoo ${symbol} failed: ${e?.message}`);
    return null;
  }
}

// Broad-market indices per tracked market (Yahoo tickers). The old Voyager
// /macro endpoint no longer exists; the snapshot is assembled in code from the
// same live chart API the price-history client already uses.
const MARKET_INDICES: Record<string, { symbol: string; label: string }[]> = {
  in: [
    { symbol: "%5ENSEI", label: "Nifty 50" },
    { symbol: "%5EBSESN", label: "Sensex" },
  ],
  us: [
    { symbol: "%5EGSPC", label: "S&P 500" },
    { symbol: "%5EIXIC", label: "Nasdaq Composite" },
  ],
};

export interface IndexSnapshot {
  label: string;
  symbol: string;
  last_close: number | null;
  as_of: string | null;
  return_1m: number | null;
  return_6m: number | null;
}

export interface MacroSnapshot {
  market: string;
  indices: IndexSnapshot[];
  market_direction: string;
  fetched_at: string;
  source: "yahoo";
}

/**
 * Assemble the macro snapshot in code: index levels and trailing returns for
 * the tracked market, plus a plain-language direction call per index. Every
 * figure comes from real candles; a failed index is omitted, never estimated.
 */
export async function getMacroSnapshot(country = "in"): Promise<MacroSnapshot | { unavailable: true; reason: string }> {
  const indices = MARKET_INDICES[country] || MARKET_INDICES.in;
  const snaps: IndexSnapshot[] = [];
  for (const idx of indices) {
    const h = await getPriceHistory(idx.symbol, "1y");
    if (!h || h.candles.length < 30) continue; // degrade per-index, never fake
    const candles = h.candles;
    const last = candles[candles.length - 1];
    const back = (n: number): number | null =>
      candles.length > n && candles[candles.length - 1 - n].close > 0
        ? Math.round((last.close / candles[candles.length - 1 - n].close - 1) * 1000) / 10
        : null;
    snaps.push({
      label: idx.label,
      symbol: idx.symbol.replace(/%5E/, "^"),
      last_close: last.close,
      as_of: last.date,
      return_1m: back(21),
      return_6m: back(126),
    });
  }
  if (snaps.length === 0) {
    return { unavailable: true, reason: "index price history unavailable" };
  }
  // Direction call per index from the trailing 1m/6m returns — a plain-language
  // read the analyst can quote, not a recommendation.
  const direction = (s: IndexSnapshot): string => {
    const r1 = s.return_1m ?? 0;
    const r6 = s.return_6m ?? 0;
    if (r1 >= 3 && r6 >= 5) return "uptrend";
    if (r1 <= -3 && r6 <= -5) return "downtrend";
    if (Math.abs(r1) < 2) return "range-bound";
    return r1 > 0 ? "drifting up" : "drifting down";
  };
  return {
    market: country,
    indices: snaps.map((s) => ({ ...s, direction: direction(s) })) as IndexSnapshot[],
    market_direction: snaps.map((s) => `${s.label}: ${direction(s)}`).join("; "),
    fetched_at: new Date().toISOString(),
    source: "yahoo",
  };
}

/** Compact digest for analyst prompts — bounded, never the full candle list. */
/**
 * Minimal live-quote read for analysts: the last close, as-of date, 52-week
 * range and trailing returns. Sourced from the same cached Yahoo client as
 * the full price history (one fetch, 15-min cache), so a valuation skill
 * blocked on a missing snapshot price can still ground its ratios in a real
 * market price.
 */
export function quoteDigest(h: PriceHistory): Record<string, unknown> {
  const n = h.candles.length;
  const last = h.candles[n - 1];
  const pct = (v: number) => Math.round(v * 1000) / 10; // 0.1234 -> 12.3 (percent)
  return {
    symbol: h.symbol,
    price: last.close,
    as_of: last.date,
    currency_note: "price is in the instrument's listed currency",
    fifty_two_week: h.fifty_two_week,
    return_1m_pct: pct(ret(h.candles, 21)),
    return_3m_pct: pct(ret(h.candles, 63)),
    return_6m_pct: pct(ret(h.candles, 126)),
    source: h.source,
    fetched_at: h.fetched_at,
  };
}

export function priceHistoryDigest(h: PriceHistory): string {
  const n = h.candles.length;
  const last = h.candles[n - 1];
  const last50 = h.candles.slice(-50);
  const avgVol = last50.reduce((s, c) => s + c.volume, 0) / Math.max(1, last50.length);
  const rsiNow = [...h.rsi14].reverse().find((r) => r.value != null)?.value ?? null;
  const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
  const pos52 = last.close > 0 ? (last.close - h.fifty_two_week.low) / Math.max(1e-9, h.fifty_two_week.high - h.fifty_two_week.low) : 0;
  return [
    `symbol=${h.symbol} points=${n} range=${h.range} source=${h.source}`,
    `last_close=${last.close} (${last.date})`,
    `sma20=${[...h.sma20].reverse().find((s) => s.value != null)?.value ?? "n/a"} sma50=${[...h.sma50].reverse().find((s) => s.value != null)?.value ?? "n/a"} sma200=${[...h.sma200].reverse().find((s) => s.value != null)?.value ?? "n/a"}`,
    `rsi14=${rsiNow ?? "n/a"}`,
    `avg_volume_50d=${Math.round(avgVol)}`,
    `52w_high=${h.fifty_two_week.high} 52w_low=${h.fifty_two_week.low} range_position=${pct(pos52)} of 52w range`,
    `returns: 1m=${pct(ret(h.candles, 21))} 3m=${pct(ret(h.candles, 63))} 6m=${pct(ret(h.candles, 126))}`,
  ].join("\n");
}

export function ret(candles: Candle[], back: number): number {
  if (candles.length <= back) return 0;
  const past = candles[candles.length - 1 - back].close;
  const now = candles[candles.length - 1].close;
  return past > 0 ? now / past - 1 : 0;
}

// ─── Market snapshot frozen at run time ──────────────────────────────────

export interface MarketSnapshot {
  /** Last close on (or immediately before) the run date. */
  price: number;
  /** Trading date the price is from (YYYY-MM-DD). */
  as_of: string;
  /** Market cap when the metrics snapshot carries one, else null. */
  market_cap: number | null;
  market_cap_source: "metrics" | null;
  currency: string | null;
  /** Last 6 months of daily closes ending at as_of (downsampled for storage). */
  candles: { date: string; close: number }[];
  fetched_at: string;
}

/**
 * Build the market context an analysis result should always show: the
 * price + market cap on the run date and the trailing 6-month price series
 * ending there. Persisted on the run row so a result viewed months later
 * reflects the market as it was when the verdict was formed. Never throws —
 * a data failure yields null and the UI degrades to "snapshot unavailable".
 */
export async function buildMarketSnapshot(
  symbol: string,
  metrics: Record<string, any> | null,
): Promise<MarketSnapshot | null> {
  try {
    const history = await getPriceHistory(symbol);
    if (!history || history.candles.length === 0) return null;
    const last = history.candles[history.candles.length - 1];
    const sixMonths = history.candles.slice(-130);
    const step = Math.max(1, Math.ceil(sixMonths.length / 130));

    const rawCap = metrics ? toNumberOrNull(metrics.market_capitalization ?? metrics.market_cap) : null;
    return {
      price: last.close,
      as_of: last.date,
      market_cap: rawCap,
      market_cap_source: rawCap != null ? "metrics" : null,
      currency: null,
      candles: sixMonths
        .filter((_, i) => i % step === 0 || i === sixMonths.length - 1)
        .map((c) => ({ date: c.date, close: c.close })),
      fetched_at: new Date().toISOString(),
    };
  } catch (e: any) {
    log.warn("marketdata", `market snapshot for ${symbol} failed: ${e?.message}`);
    return null;
  }
}

function toNumberOrNull(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}
