/**
 * Shared result-page formatting + band semantics (plan 0.7 / D4 / E2–E4, E8).
 *
 * Bands live in ONE place so score colors mean the same thing everywhere
 * (previously 70/40 was hard-coded in several files with different scales,
 * including the 0.7/0.4-vs-0..100 bug in generateVerdict). Currency comes
 * from the instrument's market, not a hard-coded ₹.
 */

import { FaceNeutral, ThumbsDown, ThumbsUp, type LucideIcon } from "lucide-react";

export type MarketCurrency = "INR" | "USD";

/** Market from the run's data source ("nse" | "sec" | …). Defaults to USD. */
export function currencyForSource(source?: string | null): MarketCurrency {
  return String(source || "").toLowerCase() === "nse" ? "INR" : "USD";
}

const CURRENCY_SYMBOL: Record<MarketCurrency, string> = { INR: "₹", USD: "$" };

/**
 * Market-aware compact currency (E4): ₹ in Cr/Lakh for Indian listings,
 * $ in M/B for US listings — never "₹…B" mixed conventions.
 */
export function formatCurrencyForMarket(val: number, currency: MarketCurrency = "USD"): string {
  const sym = CURRENCY_SYMBOL[currency];
  if (currency === "INR") {
    if (val >= 1e7) return `${sym}${(val / 1e7).toFixed(2)}Cr`;
    if (val >= 1e5) return `${sym}${(val / 1e5).toFixed(2)}L`;
    return `${sym}${val.toLocaleString()}`;
  }
  if (val >= 1e9) return `${sym}${(val / 1e9).toFixed(2)}B`;
  if (val >= 1e6) return `${sym}${(val / 1e6).toFixed(2)}M`;
  if (val >= 1e3) return `${sym}${(val / 1e3).toFixed(1)}K`;
  return `${sym}${val.toLocaleString()}`;
}

/** Action buckets live on the profile in the full plan; these are the defaults. */
export interface ScoreBands {
  shortlistAt: number; // score ≥ shortlistAt → shortlist
  watchAt: number; // score ≥ watchAt → watch, else pass
}

export const DEFAULT_BANDS: ScoreBands = { shortlistAt: 75, watchAt: 55 };

export type ActionBucket = "shortlist" | "watch" | "pass";

/** The verdict strip's action bucket — a process label, not investment advice. */
export function actionBucket(score: number, bands: ScoreBands = DEFAULT_BANDS): ActionBucket {
  if (score >= bands.shortlistAt) return "shortlist";
  if (score >= bands.watchAt) return "watch";
  return "pass";
}

export interface BandStyle {
  color: string;
  bg: string;
  label: string;
}

/** Shared band → color/label mapping on the 0–100 scale (fixes E3's scale bug). */
export function bandForScore(score: number | null | undefined): BandStyle {
  if (score == null) {
    return { color: "var(--ink-tertiary)", bg: "var(--surface-recessed)", label: "unscored" };
  }
  const bucket = actionBucket(score);
  if (bucket === "shortlist") {
    return { color: "var(--signal-positive)", bg: "transparent", label: "Shortlist" };
  }
  if (bucket === "watch") {
    return { color: "var(--signal-caution)", bg: "transparent", label: "Watch" };
  }
  return { color: "var(--signal-negative)", bg: "transparent", label: "Pass" };
}

/**
 * Headline verdict — five hard-coded ranges on the 0–100 scale. The result
 * page leads with this word, so its wording and colour live here beside the
 * bands they're derived from: red below 40, amber through the middle,
 * green once the score earns it.
 */
export interface Verdict {
  label: string;
  color: string;
}

export function verdictForScore(score: number | null | undefined): Verdict {
  if (score == null || !Number.isFinite(score)) {
    return { label: "Unscored", color: "var(--ink-tertiary)" };
  }
  // Subtle tint: mute the signal toward ink so the word reads as colored
  // text, not a bright badge.
  const muted = (c: string) => `color-mix(in srgb, ${c} 60%, var(--ink-primary))`;
  if (score >= 90) return { label: "Outstanding", color: muted("var(--signal-positive)") };
  if (score >= 70) return { label: "Strong", color: muted("var(--signal-positive)") };
  if (score >= 55) return { label: "Fair", color: muted("var(--signal-caution)") };
  if (score >= 40) return { label: "Underwhelming", color: muted("var(--signal-caution)") };
  return { label: "Subpar", color: muted("var(--signal-negative)") };
}

/**
 * Map a score to the legacy 3-signal palette used by bars/indicators
 * (kept for visual continuity, now on one shared 0–100 scale).
 */
export function scoreSignal(score: number): "positive" | "caution" | "negative" {
  if (score >= DEFAULT_BANDS.watchAt) return "positive";
  if (score >= 40) return "caution";
  return "negative";
}

/**
 * Strip score scaffolding the pipeline leaves in analyst markdown (E2):
 * FINAL_SCORE lines, "Score: NN/100" headers and bare score-table stubs are
 * developer/debug output — the number already lives in the hero and tables.
 */
export function stripScoreScaffolding(markdown?: string | null): string {
  if (!markdown) return "";
  return markdown
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      if (/^FINAL_SCORE\s*[:：=]/i.test(t)) return false;
      if (/^[-*_>*\s#`]*\bFINAL_SCORE\b[:：=]?/i.test(t)) return false;
      // Bare one-line score stubs: "Score: 72/100", "**Final Score: 61.5**",
      // "# Final Score: 42 out of 100" — never prose that merely mentions a score.
      if (
        /^[-*_>*\s#`]*\*{0,2}(final\s+)?score\*{0,2}\s*[:：=]\s*\d+(\.\d+)?\s*(\/\s*100|out of 100)?\*{0,2}\.?$/i.test(
          t,
        )
      )
        return false;
      return true;
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Coverage → compact label for the chip beside the score (E8). */
export function coverageLabel(coverage?: number | null): string {
  if (coverage == null || !Number.isFinite(coverage)) return "";
  const pct = Math.round(coverage * (coverage <= 1 ? 100 : 1));
  return `${pct}%`;
}

/** Below the profile's minimum coverage the headline number is suppressed. */
export const MIN_COVERAGE_DEFAULT = 0.6;

export function insufficientCoverage(coverage?: number | null, min: number = MIN_COVERAGE_DEFAULT): boolean {
  return coverage != null && Number.isFinite(coverage) && coverage < min;
}

/* ── Run verdicts ───────────────────────────────────────────────────────────
   The runs table and the insights cards grade a run identically, so the
   harness five-band mapping and the score fallback live here beside the
   other band tables. */

/** Harness quality verdict (report.verdict) → the 3-signal palette. */
export const QUALITY_SIGNAL: Record<string, "positive" | "caution" | "negative"> = {
  "Very Poor": "negative",
  Poor: "negative",
  Fair: "caution",
  Good: "positive",
  Excellent: "positive",
};

export type VerdictTone = "good" | "caution" | "bad" | "neutral";

/** Chip colour for a verdict label — the harness five-band words, the
    score-band words, the buy/sell vocabulary the watchlist and alerts use,
    and "Failed" (what a dead run alerts with). Case-insensitive, so the
    same word colours a badge wherever it appears. */
export function verdictTone(label: string | null | undefined): VerdictTone {
  if (!label) return "neutral";
  const q = QUALITY_SIGNAL[label];
  if (q) return q === "positive" ? "good" : q === "caution" ? "caution" : "bad";
  const v = label.trim().toLowerCase();
  if (["outstanding", "strong", "shortlist", "buy", "excellent", "good"].includes(v)) return "good";
  if (["fair", "underwhelming", "hold", "watch", "neutral"].includes(v)) return "caution";
  if (["subpar", "pass", "error", "failed", "sell", "poor", "very poor"].includes(v)) return "bad";
  return "neutral";
}

/** Watchlist badge glyphs — thumbs tell the story: double up = great
 *  (better than good), double down = very bad, neutral face = average/fair
 *  (and anything unclassified). Colour comes from badgeFill. */
export function badgeIcons(label: string | null | undefined): LucideIcon[] {
  const v = (label || "").trim().toLowerCase();
  if (v === "outstanding" || v === "excellent") return [ThumbsUp, ThumbsUp];
  if (v === "very poor") return [ThumbsDown, ThumbsDown];
  const tone = verdictTone(label);
  if (tone === "good") return [ThumbsUp];
  if (tone === "bad") return [ThumbsDown];
  return [FaceNeutral];
}

/** Badge/dot fill by severity — shades of green and red (deeper = more
 *  severe), yellow for average, gray when unclassified. All sit in the
 *  light-fill range so near-black ink holds ≥4.5:1 in light mode; the
 *  dark-mode rule in index.css deepens them for white ink. */
export function badgeFill(label: string | null | undefined): string {
  const v = (label || "").trim().toLowerCase();
  if (v === "outstanding" || v === "excellent") return "#22C55E";
  if (v === "very poor") return "#EF4444";
  const tone = verdictTone(label);
  if (tone === "good") return "#4ADE80";
  if (tone === "bad") return "#F87171";
  if (tone === "caution") return "#FACC15";
  return "#9CA3AF";
}

/** Compact verdict age shown right on the badge — "now" / "4m" / "5h" /
 *  "3d" / "2w", then a short date past five weeks. Answers "is this verdict
 *  old?" without a hover. */
export function badgeAge(iso?: string | null): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(diff)) return "";
  if (diff < 60_000) return "now";
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Text-safe signal ink for a verdict word (badges, pills, tinted chips) —
 *  the twins that hold 4.5:1 on canvas and on their own 14% tint. undefined
 *  = no signal: render it neutral. */
export function verdictInk(label: string | null | undefined): string | undefined {
  switch (verdictTone(label)) {
    case "good":
      return "var(--signal-positive-text)";
    case "caution":
      return "var(--signal-caution-text)";
    case "bad":
      return "var(--signal-negative-text)";
    default:
      return undefined;
  }
}

export interface RunVerdict {
  label: string;
  tone: VerdictTone;
  /** 3-signal palette, for dots/indicators. */
  signal: "positive" | "caution" | "negative";
}

/**
 * A run's verdict: the harness grade inside report.verdict wins; skill-era
 * rows without one fall back to the score band. null = no verdict at all.
 */
export function runVerdict(a: { verdict?: string | null; total_score?: number | null }): RunVerdict | null {
  const score = typeof a.total_score === "number" && Number.isFinite(a.total_score) ? a.total_score : null;
  const label = a.verdict || (score != null ? verdictForScore(score).label : null);
  if (!label) return null;
  const tone = verdictTone(label);
  return { label, tone, signal: tone === "good" ? "positive" : tone === "bad" ? "negative" : "caution" };
}
