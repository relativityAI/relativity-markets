import { useState } from "react";
import { LuNewspaper, LuGlobe, LuChartLine } from "react-icons/lu";
import type { IconType } from "react-icons";
import { API_BASE } from "@/db";
import secLogo from "@/assets/sec_logo.png";
import nseLogo from "@/assets/nse_logo.png";
import voyagerLogo from "@/assets/voyager_logo.png";
import yahooLogo from "@/assets/yahoo_finance.png";
import youtubeLogo from "@/assets/youtube_logo.png";
import redditLogo from "@/assets/reddit_logo.png";

export type SourceKey = "sec" | "nse" | "voyager" | "yahoo" | "youtube" | "reddit" | "news" | "web" | "tradingview";

type SourceDef = { image?: string; icon?: IconType; label: string; full: string };

export const SOURCE_DEFS: Record<SourceKey, SourceDef> = {
    sec: { image: secLogo, label: "SEC", full: "U.S. Securities & Exchange Commission" },
    nse: { image: nseLogo, label: "NSE", full: "National Stock Exchange of India" },
    voyager: { image: voyagerLogo, label: "Voyager", full: "Voyager data engine" },
    yahoo: { image: yahooLogo, label: "Yahoo", full: "Yahoo Finance (yfinance MCP)" },
    youtube: { image: youtubeLogo, label: "YouTube", full: "YouTube" },
    reddit: { image: redditLogo, label: "Reddit", full: "Reddit" },
    news: { icon: LuNewspaper, label: "News", full: "Market & ticker news" },
    web: { icon: LuGlobe, label: "Web", full: "Live web search" },
    tradingview: { icon: LuChartLine, label: "TradingView", full: "TradingView market data & technicals" },
};

export function SourceMark({ source, size = 12, muted = false }: { source: SourceKey; size?: number; muted?: boolean }) {
    const def = SOURCE_DEFS[source];
    if (def.image) {
        return (
            <img
                src={def.image}
                alt=""
                aria-hidden="true"
                title={def.full}
                height={size}
                style={{
                    height: size,
                    width: "auto",
                    objectFit: "contain",
                    display: "inline-block",
                    filter: muted ? "grayscale(1)" : undefined,
                    opacity: muted ? 0.7 : 1,
                }}
            />
        );
    }
    const Icon = def.icon!;
    return <Icon size={size} title={def.full} aria-label={def.full} style={{ color: "var(--ink-tertiary)", flexShrink: 0 }} />;
}

// Site favicon for a cited URL, via Google's favicon proxy.
// ponytail: third-party request per citation — self-host or drop if that
// becomes a privacy requirement.
export function FaviconMark({ url, size = 12 }: { url: string; size?: number }) {
    let host = "";
    try {
        host = new URL(url).hostname;
    } catch {
        /* malformed citation url — fall through to the broken-host mark */
    }
    if (!host) return <LuGlobe size={size} aria-hidden />;
    return (
        <img
            src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=${size * 2}`}
            alt=""
            aria-hidden="true"
            title={host}
            onError={(e) => (e.currentTarget.style.visibility = "hidden")}
            style={{ width: size, height: size, borderRadius: 2, flexShrink: 0, display: "inline-block" }}
        />
    );
}

// Circular country mark for a run's exchange — replaces the 🇮🇳/🇺🇸 emoji.
// TradingView's own SVGs, hotlinked (no asset to babysit).
export function CountryFlag({ country, size = 14, title }: { country?: string | null; size?: number; title?: string }) {
    const code = String(country || "").trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(code)) return null;
    return (
        <img
            src={`https://s3-symbol-logo.tradingview.com/country/${code}--big.svg`}
            alt=""
            aria-hidden="true"
            title={title || code}
            width={size}
            height={size}
            loading="lazy"
            onError={(e) => (e.currentTarget.style.display = "none")}
            style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", flexShrink: 0, display: "inline-block" }}
        />
    );
}

export function FlagLogo({ source, size = 14 }: { source?: string | null; size?: number }) {
    const key = String(source || "").toUpperCase() === "NSE" ? "IN" : "US";
    return <CountryFlag country={key} size={size} title={key === "IN" ? "India" : "United States"} />;
}

/**
 * A plugin's market scope as flags: its country when it has one, else the
 * supported markets (India + US) — "works for any market" = all of them.
 */
export function MarketFlags({ country, size = 14 }: { country?: string | null; size?: number }) {
    const code = String(country || "").trim().toUpperCase();
    const codes = /^[A-Z]{2}$/.test(code) ? [code] : ["IN", "US"];
    return (
        <span className="inline-flex shrink-0 items-center gap-1">
            {codes.map((c) => (
                <CountryFlag key={c} country={c} size={size} />
            ))}
        </span>
    );
}

// Company logo for a ticker, served by our own /logo/:symbol route (which
// resolves symbol → domain server-side and redirects to the Ticker Logos
// CDN). Unknown ticker falls back to its initial rather than a broken image.

/** Sample a loaded logo: true for a near-black monochrome glyph (AAPL & co)
 *  that would vanish on the dark plate. Both logo hosts send CORS `*`, so
 *  the canvas is readable; anything else (tainted canvas, decode hiccup)
 *  just returns false and the logo renders untouched. */
function isDarkMono(img: HTMLImageElement): boolean {
    try {
        const w = img.naturalWidth;
        const h = img.naturalHeight;
        if (!w || !h || w * h > 400_000) return false;
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) return false;
        ctx.drawImage(img, 0, 0);
        const d = ctx.getImageData(0, 0, w, h).data;
        let opaque = 0;
        let colored = 0;
        let dark = 0;
        for (let i = 0; i < d.length; i += 4) {
            if (d[i + 3] < 64) continue;
            opaque++;
            const mx = Math.max(d[i], d[i + 1], d[i + 2]);
            if (mx - Math.min(d[i], d[i + 1], d[i + 2]) > 40) colored++;
            if (mx < 96) dark++;
        }
        return opaque > 4 && colored / opaque < 0.08 && dark / opaque > 0.6;
    } catch {
        return false;
    }
}

export function TickerLogo({ symbol, size = 20 }: { symbol?: string; size?: number }) {
    const sym = String(symbol || "").trim();
    const [failed, setFailed] = useState(false);
    const [monoDark, setMonoDark] = useState(false);
    // First host 404s on some tickers (logoapi.sh's gaps) — retry on the
    // other one before giving up and showing the letter.
    const [alt, setAlt] = useState(false);
    const radius = "50%"; // circle, TradingView-style
    if (!sym) return null;
    if (failed) {
        return (
            <span
                aria-hidden="true"
                title={sym}
                style={{
                    width: size,
                    height: size,
                    flexShrink: 0,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    borderRadius: radius,
                    background: "var(--surface-recessed)",
                    color: "var(--ink-tertiary)",
                    fontSize: Math.max(9, Math.round(size * 0.5)),
                    fontWeight: 600,
                    lineHeight: 1,
                }}
            >
                {sym[0].toUpperCase()}
            </span>
        );
    }
    return (
        // Plate lives on the WRAPPER: `filter: invert(1)` (dark mode, black
        // glyphs) inverts everything on the element it's set on — background
        // included — so the plate must never sit on the filtered <img>.
        <span
            style={{
                width: size,
                height: size,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                borderRadius: "50%",
                overflow: "hidden",
                // No plate: the logos are SVGs with their own art — render as-is.
            }}
        >
            <img
                // v=4: busts the browser's cached 302 — the redirect itself used to be
                // cached for a day, so a new logo source took a day to show.
                // Also forces a fresh CORS fetch — a response cached before
                // crossOrigin was added would taint the canvas and kill detection.
                src={`${API_BASE}/logo/${encodeURIComponent(sym)}?v=4${alt ? "&alt=1" : ""}`}
                alt=""
                aria-hidden="true"
                title={sym}
                loading="lazy"
                decoding="async"
                // no-cors images taint the canvas — without this the mono-dark
                // pixel check always throws and black logos stay black.
                crossOrigin="anonymous"
                data-mono-dark={monoDark ? "1" : undefined}
                onLoad={(e) => {
                    if (!monoDark && isDarkMono(e.currentTarget)) setMonoDark(true);
                }}
                onError={() => (alt ? setFailed(true) : setAlt(true))}
                style={{
                    // 70% = the largest square whose corners fit inside the
                    // wrapper circle (side = d/√2), so full-bleed SVGs are
                    // never clipped by the plate.
                    width: Math.round(size * 0.7),
                    height: Math.round(size * 0.7),
                    objectFit: "contain",
                    display: "inline-block",
                }}
            />
        </span>
    );
}

// Maps an agent tool name to the real data sources it pulls from. "exchange"
// is a placeholder resolved to the run's exchange (SEC or NSE) at render time.
const TOOL_SOURCES: Record<string, SourceKey[]> = {
    get_financial_metrics: ["exchange", "voyager"],
    get_financials: ["exchange", "voyager"],
    get_income_statements: ["exchange", "voyager"],
    get_balance_sheets: ["exchange", "voyager"],
    get_cash_flows: ["exchange", "voyager"],
    get_announcements: ["exchange", "voyager"],
    search_company_documents: ["exchange", "voyager"],
    read_latest_transcript: ["exchange", "voyager"],
    read_latest_presentation: ["exchange", "voyager"],
    read_pdf: ["exchange", "voyager"],
    parse_pdf_document: ["exchange", "voyager"],
    get_document_index: ["exchange", "voyager"],
    get_shareholdings: ["exchange", "voyager"],
    analyze_management_sentiment: ["voyager"],
    get_dcf_valuation: ["exchange", "voyager"],
    get_pull_status: ["exchange", "voyager"],
    trigger_data_pull: ["exchange", "voyager"],
    get_pull_job_status: ["voyager"],
    list_pull_jobs: ["voyager"],
    list_categories: ["exchange", "voyager"],
    get_market_news: ["news"],
    get_ticker_news: ["news"],
    search_reddit: ["reddit"],
    search_youtube: ["youtube"],
    get_youtube_transcript: ["youtube"],
    web_search: ["web"],
    searxng_web_search: ["web"],
    web_url_read: ["web"],
    searxng_search_suggestions: ["web"],
    searxng_instance_info: ["web"],
    financial_news: ["tradingview"],
    market_sentiment: ["tradingview"],
    combined_analysis: ["tradingview"],
    market_snapshot: ["tradingview"],
    stock_prices: ["tradingview"],
    yahoo_price: ["tradingview"],
    stock_technical_analysis: ["yahoo"],
    coin_analysis: ["tradingview"],
    multi_timeframe_analysis: ["tradingview"],
    backtest_strategy: ["tradingview"],
    compare_strategies: ["tradingview"],
    walk_forward_backtest_strategy: ["tradingview"],
    multi_agent_analysis: ["tradingview"],
    get_technical_analysis: ["tradingview"],
    get_multi_timeframe_analysis: ["tradingview"],
    get_candlestick_patterns: ["tradingview"],
    get_stock_decision: ["tradingview"],
    screen_stocks: ["tradingview"],
    scan_by_signal: ["tradingview"],
    stock_screener: ["tradingview"],
};

// Single branded mark for one tool call. "exchange" has no logo of its own —
// resolve it to SEC and let the card pick the run's real exchange elsewhere.
// ponytail: no exchange-aware variant; thread the run's exchange in when a
// result card actually needs to distinguish SEC from NSE.
export function sourceForTool(tool: string | undefined): SourceKey {
    const name = String(tool || "");
    if (name.startsWith("yfinance_")) return "yahoo";
    const keys = TOOL_SOURCES[name] || [];
    const key = keys.find((k) => k !== "exchange") || keys[0] || "web";
    return key === "exchange" ? "sec" : key;
}

// Unique, ordered list of sources really used by a parameter's tool calls.
export function sourcesUsedForParam(calls: { tool_name?: string }[] | undefined): SourceKey[] {
    const out: SourceKey[] = [];
    for (const c of calls || []) {
        const name = String(c?.tool_name || "");
        const keys = name.startsWith("yfinance_") ? (["yahoo"] as SourceKey[]) : TOOL_SOURCES[name] || [];
        for (const k of keys) {
            if (!out.includes(k)) out.push(k);
        }
    }
    return out;
}