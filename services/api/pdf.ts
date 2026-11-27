// Server-side PDF report generation.
//
// Report figures are the harness's own figure-kit SVGs — the exact drawings
// the UI shows — rasterized to PNG with the vendored brand fonts and set in
// the same two faces the app ships: Newsreader (display) + Anek Latin (body).

import { createRequire } from "node:module";
import type { ReportBlock } from "../harness/report/legacy-blocks.js";
import type { ChartSpec, ReportDocument } from "../harness/index.js";
import { log } from "./logger.js";
import { agentChipPng, agentSeed } from "../harness/identity.js";
import { NSE_LOGO_DATA_URI, SEC_LOGO_DATA_URI } from "./exchangeLogos.js";
import { tickerLogoDataUri } from "./tickerLogos.js";
import { PDF_FONTS, pdfFontVfs } from "./pdfFonts.js";
import { figurePng } from "./pdfFigures.js";

// pdfmake ships a CJS browser build that Vite's transformer breaks. Load it via
// Node's native require (identical in tsc-runtime and vitest).
const nodeRequire = createRequire(import.meta.url);
const pdfMakeModule: any = nodeRequire("pdfmake/build/pdfmake.js");
const pdfMake: any = pdfMakeModule;

type PdfNode = any;
type PdfContent = PdfNode[];

type ChartBlock = Extract<ReportBlock, { type: "chart" }>;
/** Strip the light markdown the model uses (###, **, bullets) to plain PDF text. */
const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
// Stateless checker: a /g/ regex's .test() carries lastIndex between calls,
// which made the uuid guard below intermittently MISS (it printed raw uuids
// in the "Prepared for" line whenever an earlier .test() advanced the index).
const UUID_TEST_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
export function isUuid(v: unknown): boolean {
  return UUID_TEST_RE.test(String(v || ""));
}
function plain(text: string): string {
  return String(text || "")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(UUID_RE, "")
    .trim();
}

function signalColor(score: number | null | undefined): string {
  if (score == null) return "#9CA3AF";
  if (score >= 70) return "#4C8B6B";
  if (score >= 40) return "#B8935A";
  return "#B85C5C";
}

function fmt(v: unknown): string {
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : v.toFixed(2);
  return String(v ?? "—");
}

/** pdfmake table layout shared by report tables and skill block tables. */
const TABLE_LAYOUT = {
  hLineWidth: () => 0,
  vLineWidth: () => 0,
  fillColor: (rowIdx: number) => (rowIdx === 0 ? "#F4F4F3" : rowIdx % 2 ? "#FAFAF9" : "#FFFFFF"),
  paddingTop: () => 5,
  paddingBottom: () => 5,
  paddingLeft: () => 6,
  paddingRight: () => 6,
};

/** Muted card — one shared language for metric rows and raw tool data. */
const CARD_LAYOUT = {
  hLineWidth: () => 0,
  vLineWidth: () => 0,
  fillColor: () => "#FAFAF9",
  paddingTop: () => 5,
  paddingBottom: () => 5,
  paddingLeft: () => 8,
  paddingRight: () => 8,
};

/** Wrap content in a CARD_LAYOUT card. */
function card(nodes: PdfNode[], margin: number[] = [0, 4, 0, 4], fill = "#FAFAF9"): PdfNode {
  return { table: { widths: ["*"], body: [[{ stack: nodes }]] }, layout: { ...CARD_LAYOUT, fillColor: () => fill }, margin } as PdfNode;
}

/** Tinted callout card — pdfmake ignores `background` on a bare text node,
 *  so the tone lives in the card's fill instead. */
const CALLOUT_TONE: Record<string, { bg: string; ink: string }> = {
  positive: { bg: "#E9F2EC", ink: "#2F6B47" },
  caution: { bg: "#F6EFDC", ink: "#7A5A1F" },
  negative: { bg: "#F7E9E9", ink: "#943F3F" },
  neutral: { bg: "#F4F4F3", ink: "#4B5563" },
};

function callout(text: string, tone = "neutral", margin: number[] = [0, 4, 0, 8]): PdfNode {
  const t = CALLOUT_TONE[tone] || CALLOUT_TONE.neutral;
  return card([{ text, style: "callout", color: t.ink, margin: [0, 0, 0, 0] }], margin, t.bg);
}

function markdownText(md: string): string[] {
  const parts: string[] = [];
  for (const line of String(md || "").split("\n")) {
    const t = plain(line);
    if (!t) continue;
    if (/^\s*[-*•]/.test(line)) parts.push(`•  ${t.replace(/^\s*[-*•]\s*/, "")}`);
    else parts.push(t);
  }
  return parts;
}

/** Map metric/parameter names to a one-line data-point description for evidence captions. */
function evidenceLookupFor(run: any): Record<string, string> {
  const m: Record<string, string> = {};
  const sym: Record<string, string> = { gt: ">", gte: "≥", lt: "<", lte: "≤", eq: "=", between: "between" };
  for (const [k, d] of Object.entries(run.quantitative_analysis || {})) {
    const e = d as any;
    const label = e.metric_name || k;
    const rule = `${sym[e.operator] || "="} ${e.threshold ?? "—"}`;
    const line = e.price_unavailable
      ? `${label} → N/A (no live price)`
      : `${label} ${rule} → ${e.value ?? "—"} · score ${Math.round((e.score ?? 0) * 10) / 10}`;
    m[k] = line;
    m[label] = line;
  }
  for (const [k, p] of Object.entries(run.qualitative_analysis || {})) {
    m[k] = `score ${Math.round(((p as any).score ?? 0) * 10) / 10}`;
  }
  return m;
}

/** Evidence caption under a block that claims to be backed by named data points. */
function evidenceLine(keys: string[] | undefined, lookup: Record<string, string>): PdfContent {
  // Drop infrastructure ids (uuid-shaped keys) — they are never human-facing
  // data points and leak internal row ids into the report.
  const resolved = (keys || []).filter(
    (k) => k !== "scored_data" && k !== "skill_outputs" && !isUuid(k) && (lookup[k] || /^https?:\/\//i.test(k)),
  );
  if (resolved.length === 0) return [];
  // URL-shaped keys become clickable domain links (pdfmake `link`); other
  // keys resolve through the lookup to their human line.
  const nodes: PdfNode[] = [];
  resolved.forEach((k, i) => {
    const isUrl = /^https?:\/\//i.test(k);
    if (isUrl) {
      let domain = k;
      try { domain = new URL(k).hostname.replace(/^www\./, ""); } catch { /* keep full */ }
      nodes.push({
        text: `${domain} \u2197`,
        link: k,
        color: "#23747D",
        decoration: "underline",
      });
    } else {
      nodes.push({ text: lookup[k] ?? k });
    }
    if (i < resolved.length - 1) nodes.push({ text: "  \u00b7  ", color: "#9CA3AF" });
  });
  return [
    {
      text: "Source:  ",
      style: "meta",
      margin: [0, 1, 0, 5],
    },
    ...nodes.map((n) => ({ ...n, fontSize: 8, margin: [0, 1, 0, 5] })),
  ];
}

/**
 * Legacy chart block → the nearest figure-kit spec, so old blocks draw with
 * the same labels/scales as everything else: bar→vbar (or gbar when keyed),
 * dated series→line, and any categorical shape (pie/scatter/radar/non-date x)
 * →hbar — figure-kit's own honest fallback for a categorical shape.
 */
export function legacySpec(block: ChartBlock): ChartSpec | null {
  const data = (block.data || []) as Record<string, string | number>[];
  if (!data.length) return null;
  const first = data[0];
  const xKey = (["name", "label", "date"] as const).find((k) => k in first) || Object.keys(first)[0];
  const keys = Object.keys(first).filter((k) => k !== xKey);
  if (!keys.length) return null;
  const cats = data.map((d) => String(d[xKey] ?? ""));
  const asBars = (values: number[]): ChartSpec => ({ kind: "hbar", categories: cats, values });
  if (block.chartType === "bar") {
    if (keys.length === 1) return { kind: "vbar", categories: cats, values: data.map((d) => Number(d[keys[0]])) };
    return { kind: "gbar", categories: cats, groups: keys.map((k) => ({ name: k, values: data.map((d) => Number(d[k])) })) };
  }
  const epochs = cats.map((c) => Date.parse(c));
  if (epochs.some((n) => !Number.isFinite(n) || n <= 0)) return asBars(data.map((d) => Number(d[keys[0]])));
  const ts = epochs.map((n) => Math.round(n / 1000));
  return {
    kind: "line",
    series: keys.map((k) => ({ label: k, points: data.map((d, i) => ({ t: ts[i], v: Number(d[k]) })) })),
  };
}

function legacyFigurePng(block: ChartBlock): Buffer | null {
  const spec = legacySpec(block);
  return spec ? figurePng(spec, { label: block.title }) : null;
}

async function blockToPdfContent(block: ReportBlock, lookup: Record<string, string>): Promise<PdfContent> {
  switch (block.type) {
    case "heading":
      return [
        { text: plain(block.text), style: block.level === 2 ? "h2" : "h3" },
        ...(block.tagline ? [{ text: plain(block.tagline), style: "tagline" }] : []),
      ];
    case "paragraph": {
      // Strip citation litter the older synthesizer baked into prose — the
      // PDF renders structured citations itself (never "(Source: tool: url)").
      const text = String(block.text || "").includes("(Source:")
        ? String(block.text).replace(/\s*\(Source:[^)]*\)\s*/g, " ").replace(/\s{2,}/g, " ").trim()
        : String(block.text || "");
      return [
        ...markdownText(text).map((ln) => ({ text: ln, style: "body" })),
        ...evidenceLine(block.citedKeys, lookup),
      ];
    }
    case "callout":
      return [callout(plain(block.text), block.tone, [0, 4, 0, 8])];
    case "quote":
      return [{ text: `“${plain(block.text)}”${block.attribution ? `  — ${plain(block.attribution)}` : ""}`, style: "quote" }];
    case "table": {
      const rows = (block.rows || []).map((r) => r.map((c) => ({ text: fmt(c), style: "cell" })));
      return [
        block.title ? { text: plain(block.title), style: "tableTitle" } : {},
        {
          table: {
            headerRows: 1,
            widths: block.columns.map(() => "*"),
            body: [
              block.columns.map((c) => ({ text: plain(c), style: "cellHeader" })),
              ...rows,
            ],
          },
          layout: TABLE_LAYOUT,
          margin: [0, 4, 0, 10],
        },
        ...evidenceLine(block.sourceKeys, lookup),
      ];
    }
    case "chart": {
      try {
        // v2 blocks carry their spec — the UI's own figure; legacy blocks are
        // mapped to the nearest figure-kit shape so every plot reads the same.
        const spec = (block as any).spec as ChartSpec | undefined;
        const png = spec ? figurePng(spec, { label: block.title, unit: (block as any).measure }) : legacyFigurePng(block);
        if (!png) return [{ text: `[No plottable data in: ${block.title || "plot"}]`, style: "cell" }];
        return [
          block.title ? { text: plain(block.title), style: "tableTitle" } : {},
          { image: `data:image/png;base64,${png.toString("base64")}`, width: 500, margin: [0, 4, 0, 12], alignment: "center" },
          ...evidenceLine(block.sourceKeys, lookup),
        ];
      } catch (e: any) {
        log.warn("[pdf]", `chart render failed, skipped: ${e?.message || e}`);
        return [{ text: `[Chart not rendered: ${block.title || "plot"}]`, style: "cell" }];
      }
    }
    default:
      return [];
  }
}

/**
 * The "Prepared for …" meta line, fronted by the agent's identity chip
 * (sepia portrait on its colour) and, when a model is set, the provider's
 * monogram chip. Degrades to the plain text line if rasterization fails.
 */
function identityTitleBand(run: any): PdfNode {
  // agent_name may be a raw uuid (older runs stored the id, not the display
  // name) — never print a uuid in the client-facing report. The pdf route
  // resolves the uuid to the agent's real name before we get here; this
  // fallback only covers callers that didn't.
  const agentLabel = isUuid(run.agent_name)
    ? run.agent_display_name || "Investor agent"
    : run.agent_name || "Agent";
  // WS-5: the model slug is an internal detail — never printed in the
  // investor-facing PDF header.
  const plainLine =
    `Prepared for the "${agentLabel}" mandate` +
    ` · ${run.created_at ? new Date(run.created_at).toLocaleDateString() : ""}`;
  try {
    // Report-size portrait: the agent visibly authors this document, the way
    // an analyst signs a research note — not a 30px chip lost in the header.
    return {
      columns: [
        {
          image: `data:image/png;base64,${agentChipPng(agentSeed(run.agent_name || "Agent"), 128).toString("base64")}`,
          width: 58,
          height: 58,
          margin: [0, 0, 14, 0],
        },
        {
          stack: [
            { text: agentLabel, style: "h3", margin: [0, 2, 0, 1] },
            { text: `Prepared for the "${agentLabel}" mandate`, style: "meta" },
            { text: run.created_at ? new Date(run.created_at).toLocaleDateString() : "", style: "meta" },
          ],
        },
      ],
      margin: [0, 8, 0, 2],
    };
  } catch (e: any) {
    log.warn("[pdf]", `identity chips skipped: ${e?.message || e}`);
    return { text: plainLine, style: "meta" };
  }
}

/** The display domain of a URL ("nseindia.com"), or null when unparsable. */
function domainOfUrl(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** Compact citation line: "nseindia.com · get_financial_metrics" style. */
function citationLine(citations: any[] | undefined): string {
  if (!citations?.length) return "";
  return citations
    .map((c: any) => {
      const domain = c.url ? domainOfUrl(c.url) : null;
      // Web sources read as the site they came from; internal feeds as the tool.
      const src = domain || c.label || c.source || "source";
      return src;
    })
    .filter((v: string, i: number, arr: string[]) => arr.indexOf(v) === i)
    .join("  ·  ");
}

/**
 * Inline source note under a claim: "Source: ⟨chips⟩" — web citations as
 * clickable domains with the external glyph, internal feeds as their feed
 * name. Mirrors the UI's branded citation chips.
 */
function sourceNoteNodes(citations: any[]): PdfNode[] {
  // width:"auto" keeps the label hugging its citations instead of splitting
  // the page 50/50 and shoving every citation to the middle of the line.
  const nodes: PdfNode[] = [{ text: "Source:  ", style: "sourceLine", width: "auto" }];
  const seen = new Set<string>();
  const list = citations.filter((c: any) => {
    const key = c.url || c.label || c.source;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  list.forEach((c: any, i: number) => {
    const domain = c.url ? domainOfUrl(c.url) : null;
    if (c.url && domain) {
      nodes.push({
        text: [`${domain} \u2197`, c.value ? String(c.value).slice(0, 80) : null].filter(Boolean).join(" — "),
        link: c.url,
        color: "#23747D",
        decoration: "underline",
        fontSize: 7.5,
        margin: [1, 0, 0, 4],
      });
    } else {
      nodes.push({ text: c.label || c.source || "source", style: "sourceLine" });
    }
    if (i < list.length - 1) nodes.push({ text: "  \u00b7  ", color: "#9CA3AF", fontSize: 7.5, margin: [1, 0, 0, 4] });
  });
  return [{ columns: nodes, columnGap: 2, margin: [1, 0, 0, 4] }];
}

/** Full citation references for the Sources section: label + domain + url. */
function citationRefLine(c: any): string {
  const domain = c.url ? domainOfUrl(c.url) : null;
  const name = c.label || c.source || domain || "source";
  const parts = [name];
  if (domain && domain !== name) parts.push(domain);
  if (c.url && (!domain || !c.url.includes(domain))) parts.push(c.url);
  if (c.value) parts.push(String(c.value).slice(0, 140));
  return parts.filter(Boolean).join("  —  ");
}

/** One-line human summary of an observation's JSON payload (key: value pairs). */
function observationSummary(o: any): string | null {
  const raw = String(o.result || "");
  if (!(raw.startsWith("{") || raw.startsWith("["))) return null;
  try {
    const j = JSON.parse(raw);
    const flat: string[] = [];
    const visit = (v: unknown, prefix = ""): void => {
      if (flat.length >= 6) return;
      if (v == null) return;
      if (typeof v === "object") {
        for (const [k, val] of Object.entries(v as Record<string, unknown>).slice(0, 10)) visit(val, prefix ? `${prefix}.${k}` : k);
      } else if (typeof v === "number" || typeof v === "string") {
        const sv = String(v);
        if (sv.length <= 60 && !/^https?:/.test(sv)) flat.push(`${prefix}: ${sv}`);
      }
    };
    visit(j);
    return flat.length ? flat.join("   ") : null;
  } catch {
    return null;
  }
}

interface WebStory {
  title: string;
  url: string;
  source: string | null;
  date: string | null;
  snippet: string | null;
}

/**
 * Pull readable web stories out of a web-search/news observation's payload —
 * the PDF renders these as a source list (headline first, clickable domain),
 * never as raw JSON. Returns null for non-story payloads.
 */
function webStoriesFromPayload(o: any): WebStory[] | null {
  const raw = String(o.result || "");
  if (!(raw.startsWith("{") || raw.startsWith("["))) return null;
  try {
    const j = JSON.parse(raw);
    const arr: any[] = Array.isArray(j) ? j : Array.isArray(j.results) ? j.results : [];
    const stories: WebStory[] = [];
    for (const it of arr.slice(0, 8)) {
      if (!it || typeof it !== "object") continue;
      const url = typeof it.url === "string" && /^https?:/i.test(it.url) ? it.url : null;
      const title = typeof it.title === "string" && it.title.trim() ? plain(it.title.trim()) : null;
      if (!title && !url) continue;
      stories.push({
        title: title || domainOfUrl(url) || "story",
        url: url || "",
        source: typeof it.source === "string" ? plain(it.source) : null,
        date: typeof it.published_date === "string" ? it.published_date.slice(0, 16) : null,
        snippet: typeof it.content === "string" ? plain(it.content.replace(/\s+/g, " ")).slice(0, 220) : null,
      });
    }
    return stories.length > 0 ? stories : null;
  } catch {
    return null;
  }
}

/** UI vocabulary for anchor verdicts (Met / Partly met / …) and its colours. */
const VERDICT_LABEL: Record<string, string> = {
  PASS: "Met",
  PARTIAL: "Partly met",
  FAIL: "Not met",
  INSUFFICIENT: "No data",
};
const VERDICT_COLOR: Record<string, string> = {
  PASS: "#4C8B6B",
  PARTIAL: "#B8935A",
  FAIL: "#B85C5C",
  INSUFFICIENT: "#9CA3AF",
};

/** Coverage → percent label; the DB holds 0–1 and 0–100 across eras. */
function coveragePct(coverage: number | null | undefined): number | null {
  if (coverage == null || !Number.isFinite(coverage)) return null;
  return Math.round(coverage * (coverage <= 1 ? 100 : 1));
}

/** Same floor the UI uses to suppress the headline score (0–1 scale). */
function insufficientCoverage(coverage: number | null | undefined): boolean {
  return coverage != null && Number.isFinite(coverage) && coverage < 0.6;
}

/** The UI's verdict sentence, for runs without a synthesised report. */
function generateVerdict(run: any): string {
  const total = run.total_score;
  if (total == null) return "Run completed. Review quantitative and qualitative sections for details.";
  const quant = Object.values((run.quantitative_analysis || {}) as Record<string, any>);
  const live = quant.filter((m: any) => !m.price_unavailable);
  const passed = live.filter((m: any) => (m.score ?? 0) >= 70).length;
  const failed = live.filter((m: any) => (m.score ?? 0) < 40);
  const unavailable = quant.length - live.length;
  const qual = Object.values((run.qualitative_analysis || {}) as Record<string, any>);
  const qualScored = qual.filter((p: any) => !p.error);
  const qualAvg = qualScored.length ? qualScored.reduce((s, p) => s + (p.score ?? 0), 0) / qualScored.length : 0;
  // Macro params get their own sentence in the UI — same wording here.
  const macroScored = qualScored.filter((p: any) => String(p.section || "").toLowerCase().includes("macro"));
  const macroAvg = macroScored.length ? macroScored.reduce((s, p) => s + (p.score ?? 0), 0) / macroScored.length : null;
  let sentence = `Passes ${passed} of ${quant.length} quantitative gates`;
  if (failed.length) {
    const names = failed.slice(0, 3).map((m: any) => m.metric_name).filter(Boolean).join(", ");
    sentence += `; ${failed.length} underperforming${names ? ` (${names})` : ""}`;
  }
  sentence += ".";
  if (unavailable > 0) sentence += ` ${unavailable} price-dependent ${unavailable === 1 ? "criterion" : "criteria"} not scored (live price unavailable).`;
  if (qualScored.length) {
    sentence += ` Qualitative narrative is ${qualAvg >= 70 ? "supportive" : qualAvg >= 40 ? "moderately supportive" : "mixed"}.`;
  }
  if (macroAvg != null) {
    sentence += ` Macro (market) narrative is ${macroAvg >= 70 ? "supportive" : macroAvg >= 40 ? "moderately supportive" : "mixed"}.`;
  }
  if (qual.some((p: any) => p.error)) sentence += " Some qualitative parameters failed to score.";
  return sentence;
}

/** Process label behind the UI's band pill (Shortlist ≥75 / Watch ≥55 / Pass). */
function bandLabel(score: number | null | undefined): string {
  if (score == null) return "unscored";
  if (score >= 75) return "Shortlist";
  if (score >= 55) return "Watch";
  return "Pass";
}

/* ─── Page-1 run info (the app's Run Info tab, as print) ──────────────── */

const kfmt = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}k` : String(n));

/** Tone behind each verdict word — same signal palette as the score bands. */
const VERDICT_TONE: Record<string, string> = {
  Outstanding: "#4C8B6B",
  Strong: "#4C8B6B",
  Fair: "#B8935A",
  Underwhelming: "#B8935A",
  Subpar: "#B85C5C",
};

/** The UI's five verdict bands on the 0–100 scale — same words. */
function verdictLabel(score: number | null | undefined): string {
  if (score == null || !Number.isFinite(score)) return "Unscored";
  if (score >= 90) return "Outstanding";
  if (score >= 70) return "Strong";
  if (score >= 55) return "Fair";
  if (score >= 40) return "Underwhelming";
  return "Subpar";
}

const TERMINAL = ["complete", "completed", "success", "error", "failed", "budget_exhausted"];

/** Wall-clock length of a run: recorded seconds, else start→updated. */
function runDuration(run: any): string | null {
  if (typeof run?.duration === "number" && run.duration > 0) {
    const s = Math.round(run.duration);
    return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
  }
  const started = run?.started_at || run?.created_at;
  if (!started) return null;
  const end = TERMINAL.includes(String(run?.status || "").toLowerCase())
    ? +new Date(run?.updated_at || started)
    : Date.now();
  const ms = end - +new Date(started);
  if (!(ms >= 0)) return null;
  const s = Math.round(ms / 1000);
  return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
}

/** Tokens: harness rows carry a final `usage` trace event; legacy rows tally
 *  per-section tokens. Same two sources the UI's cost meter reads. */
function runTokens(run: any): { input: number; output: number } | null {
  const trace: any[] = Array.isArray(run?.trace) ? run.trace : [];
  for (let i = trace.length - 1; i >= 0; i--) {
    const ev = trace[i];
    if (ev?.type === "usage" && ev.value) {
      const input = Number(ev.value.tokens_in ?? 0);
      const output = Number(ev.value.tokens_out ?? 0);
      if (input + output > 0) return { input, output };
    }
  }
  let input = 0;
  let output = 0;
  for (const entry of Object.values((run?.qualitative_analysis || {}) as Record<string, any>)) {
    const t = entry?.tokens;
    if (!t) continue;
    input += typeof t.input === "number" ? t.input : 0;
    output += typeof t.output === "number" ? t.output : 0;
  }
  return input + output > 0 ? { input, output } : null;
}

const ts = (v: any) =>
  typeof v === "string" && v
    ? new Date(v).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
    : "—";

/**
 * The Run Info card: verdict word (signal-coloured), stock identity, coverage,
 * agent, model, timing and tokens — everything the header implies, printed.
 */
function runInfoPanel(run: any, covText: string, reportVerdict: string | null): PdfNode {
  const total = run.total_score;
  const tokens = runTokens(run);
  const trace: any[] = Array.isArray(run?.trace) ? run.trace : [];
  const toolCalls = trace.filter((e) => e?.type === "tool_call").length;
  const agent = isUuid(run.agent_name) ? run.agent_display_name || "—" : run.agent_name || "—";
  const word = reportVerdict ?? verdictLabel(total);

  const row = (label: string, value: string, color?: string): PdfNode => ({
    columns: [
      { text: label, style: "infoLabel", width: 62 },
      { text: value, style: "infoValue", width: "*", ...(color ? { color } : {}) },
    ],
    columnGap: 8,
    margin: [0, 1.5, 0, 1.5],
  });

  const left = [
    row(
      "Verdict",
      total != null ? `${word} · ${total}` : word,
      total != null ? signalColor(total) : (reportVerdict ? VERDICT_TONE[reportVerdict] : undefined) ?? "#9CA3AF",
    ),
    row("Stock", run.share_name && run.share_name !== run.symbol ? `${run.symbol} · ${run.share_name}` : run.symbol || "—"),
    row("Coverage", covText),
    row("Agent", agent),
    row("Model", run.model || "—"),
  ];
  const right = [
    row("Started", ts(run.started_at || run.created_at)),
    row("Duration", runDuration(run) || "—"),
    row("Tool calls", toolCalls ? String(toolCalls) : "—"),
    row(
      "Tokens",
      tokens ? `${kfmt(tokens.input + tokens.output)} net (${kfmt(tokens.input)} in / ${kfmt(tokens.output)} out)` : "—",
    ),
    row("Source", run.source ? String(run.source).toUpperCase() : "—"),
  ];

  return card(
    [
      { text: "Run info", style: "tableTitle", margin: [0, 0, 0, 5] },
      { columns: [{ stack: left }, { stack: right }], columnGap: 18 },
    ],
    [0, 6, 0, 8],
  );
}

/**
 * Section opener — the PDF's one signature device: hairline rule, numbered
 * eyebrow, title with the section's count on the right. Every page break in
 * the document lands on one of these, so the rule itself marks where a new
 * section begins.
 */
function sectionOpener(
  eyebrow: string,
  title: string,
  opts: { pageBreak?: boolean; count?: string; countColor?: string } = {},
): PdfContent {
  const head: PdfNode = {
    stack: [
      { canvas: [{ type: "line", x1: 0, y1: 0, x2: 510, y2: 0, lineWidth: 0.75, lineColor: "#D9D9D5" }] },
      { text: eyebrow.toUpperCase(), style: "eyebrow", margin: [0, 7, 0, 3] },
      {
        columns: [
          { text: title, style: "h1", width: "*" },
          ...(opts.count != null
            ? [{ text: opts.count, style: "sectionCount", width: "auto", color: opts.countColor ?? "#9CA3AF" }]
            : []),
        ],
        columnGap: 8,
      },
    ],
    margin: [0, opts.pageBreak ? 0 : 14, 0, 10],
  };
  if (opts.pageBreak) head.pageBreak = "before";
  return [head];
}

/** One skill's table block, resolved against its stored datasets. */
function skillTableBlock(b: any, output: any): PdfContent {
  const ds = (output.datasets || []).find((d: any) => d.id === b.dataset_id);
  const cols: string[] = (b.columns || (ds?.columns || []).map((c: any) => c.name) || []).map(String);
  const rows: any[] = ((ds?.data || []) as any[]).slice(-(b.last_n || 30));
  if (!cols.length || !rows.length) return [];
  return [
    b.title ? { text: plain(b.title), style: "tableTitle" } : {},
    {
      table: {
        headerRows: 1,
        widths: cols.map(() => "*"),
        body: [
          cols.map((c) => ({ text: plain(c), style: "cellHeader" })),
          ...rows.map((r) => cols.map((c) => ({ text: fmt(r?.[c]), style: "cell" }))),
        ],
      },
      layout: TABLE_LAYOUT,
      margin: [0, 4, 0, 10],
    },
  ];
}

/**
 * Per-skill chapter (v3 pipeline): opens on its own page under a numbered
 * section opener, then the narrative analysis, findings, anchor verdicts,
 * workbooks, and the "Sources & raw data" block — a skill's data sources stay
 * on the skill's own pages, never split onto a page of their own.
 */
function skillSectionBlocks(output: any, index: number, total: number): PdfContent {
  const out: PdfContent = [];
  const score = output.score_0_100;
  const name = plain(output.skill_name || output.skill_id || "Skill");
  const nn = String(index + 1).padStart(2, "0");
  // The only skill of a run flows directly under the section header; in a
  // multi-skill run every chapter opens on its own page.
  const pageBreak = !(index === 0 && total <= 1);
  out.push(
    ...sectionOpener(`Skill ${nn} of ${String(total).padStart(2, "0")}`, name, {
      pageBreak,
      count: score != null ? String(score) : output.error ? "×" : "no score",
      countColor: score != null ? signalColor(score) : "#9CA3AF",
    }),
  );
  const met = (output.verdicts || []).filter((v: any) => v.verdict === "PASS").length;
  const count = output.total_checklist ?? (output.verdicts || []).length;
  out.push({
    text: [
      ...(output.category ? [plain(output.category)] : []),
      `weight ${output.weight ?? "—"}`,
      ...(count > 0 ? [`${met} of ${count} criteria met`] : []),
    ].join("  ·  "),
    style: "meta",
    margin: [0, 0, 0, 8],
  });

  if (output.error) {
    out.push(callout(`No real data reached this skill — ${plain(String(output.error)).slice(0, 300)}`, "caution"));
    return out;
  }

  if (output.rawText) {
    out.push({ text: plain(String(output.rawText)).slice(0, 4000), style: "obsRaw", margin: [0, 2, 0, 6] });
  }
  if (output.analysis) {
    for (const ln of markdownText(output.analysis)) out.push({ text: ln, style: "body" });
  }

  for (const b of output.blocks || []) {
    if (b.kind === "text") {
      for (const ln of markdownText(b.body || "")) out.push({ text: ln, style: "body" });
    } else if (b.kind === "table") {
      out.push(...skillTableBlock(b, output));
    } else if (b.kind === "chart") {
      // The UI renders chart blocks as a labelled placeholder — same title
      // and row count, so both surfaces say the identical thing.
      const ds = (output.datasets || []).find((d: any) => d.id === b.dataset_id);
      const cols = [b.x, ...(b.y || [])].filter(Boolean).join(", ");
      const rows = ((ds?.data || []) as any[]).length;
      if (b.title) out.push({ text: plain(b.title), style: "tableTitle" });
      out.push({
        text: `[${b.type}] chart using ${cols} (${rows} rows)`,
        style: "cell",
        margin: [0, 4, 0, 6],
      });
    }
  }

  if ((output.findings || []).length > 0) out.push({ text: "Findings", style: "tableTitle" });
  for (const f of output.findings || []) {
    const title = typeof f === "string" ? "" : plain(f.title || "");
    const detail = typeof f === "string" ? f : plain(f.detail || f.text || f.finding || "");
    if (title) out.push({ text: title, style: "h3" });
    if (detail) out.push({ text: detail, style: "body" });
    if (typeof f === "object" && f.citations?.length) out.push(...sourceNoteNodes(f.citations));
  }

  for (const v of output.verdicts || []) {
    const detail = v.evidence || v.rationale;
    out.push({
      columns: [
        {
          text: `${plain(v.anchor || v.checklist_id || "—")}${detail ? ` — ${plain(String(detail)).slice(0, 300)}` : ""}`,
          style: "cell",
          width: "*",
        },
        {
          text: VERDICT_LABEL[v.verdict] || String(v.verdict || ""),
          style: "verdictPill",
          width: "auto",
          color: VERDICT_COLOR[v.verdict] || "#9CA3AF",
        },
      ],
      columnGap: 8,
      margin: [0, 2, 0, 0],
    });
    if (v.citations?.length) out.push(...sourceNoteNodes(v.citations));
  }

  if ((output.artifacts || []).length > 0) out.push({ text: "Workbooks", style: "tableTitle" });
  for (const a of output.artifacts || []) {
    out.push({
      text: `•  ${plain(a.recipe?.filename || a.kind || "workbook")} — ${plain(a.summary || a.status)}`,
      style: "sourceLine",
    });
  }

  if (
    !output.error &&
    !(output.verdicts || []).length &&
    !(output.findings || []).length &&
    !output.analysis &&
    !(output.blocks || []).length
  ) {
    out.push(
      callout(
        "This skill completed but returned no findings or verdicts — nothing was assessable in the data available.",
        "caution",
      ),
    );
  }

  const citations: any[] = output.citations || [];
  const observations: any[] = output.raw_observations || [];
  if (citations.length > 0 || observations.length > 0) {
    out.push({ text: "Sources & raw data", style: "tableTitle" });

    for (const c of citations.slice(0, 12)) {
      out.push({ text: `•  ${plain(citationRefLine(c))}`, style: "sourceLine" });
    }

    for (const o of observations.slice(0, 10)) {
      const isWeb = !!o.url;
      const headerLabel = isWeb ? domainOfUrl(o.url) || "web source" : plain(o.tool || "tool");
      const statusTag = o.status === "ok" ? "" : `  [${String(o.status || "no data").toUpperCase()}]`;

      // Each call gets its own muted card so raw payloads never clash with prose.
      const obs: PdfNode[] = [
        {
          columns: [
            { text: `${headerLabel}${statusTag}`, style: "obsHeader", width: "auto" },
            { text: isWeb ? plain(o.url) : plain(String(o.args || "")).slice(0, 80), style: "obsUrl", width: "*", alignment: "right" },
          ],
          columnGap: 8,
          margin: [0, 0, 0, 2],
        },
      ];

      if (o.status === "ok") {
        const stories = webStoriesFromPayload(o);
        if (stories) {
          for (const s of stories) {
            obs.push({
              columns: [
                {
                  text: s.url ? s.title : `${s.title} — ${s.source || ""}`,
                  style: "obsSummary",
                  width: "*",
                  ...(s.url ? { link: s.url, color: "#23747D" } : {}),
                },
                { text: [s.source, s.date].filter(Boolean).join(" · "), style: "obsUrl", width: "auto", alignment: "right" },
              ],
              columnGap: 8,
              margin: [0, 2, 0, 0],
            });
            if (s.snippet && s.url) {
              obs.push({ text: s.snippet, style: "obsSummary", margin: [0, 0, 0, 2] });
            }
          }
        } else {
          const sum = observationSummary(o);
          if (sum) obs.push({ text: plain(sum).slice(0, 260), style: "obsSummary" });
          else obs.push({ text: plain(String(o.result || "")).slice(0, 300), style: "obsRaw" });
        }
      } else {
        obs.push({
          text: o.status === "ERR" ? "This call failed — nothing came back from the source." : "This call returned no data.",
          style: "obsSummary",
        });
      }
      out.push(card(obs, [0, 4, 0, 2]));
    }
  }
  return out;
}

/** Compact "k=v k=v" view of a tool call's arguments. */
function toolArgsLine(args: unknown): string {
  if (args == null) return "";
  let line = "";
  if (typeof args === "object" && !Array.isArray(args)) {
    line = Object.entries(args as Record<string, unknown>)
      .filter(([, v]) => v != null && v !== "" && typeof v !== "object")
      .map(([k, v]) => `${k}=${v}`)
      .join("  ");
  } else {
    try {
      line = JSON.stringify(args);
    } catch {
      line = "";
    }
  }
  return line.length > 140 ? `${line.slice(0, 137)}…` : line;
}

/** One-line view of a tool response for the reasoning timeline. */
function resultExcerpt(result: unknown): string {
  // ponytail: full verbatim tool payloads are elided here (the UI collapses
  // them behind a disclosure too); upgrade path — an "Raw tool responses"
  // appendix page for auditors who need the exact bytes.
  const raw = typeof result === "string" ? result : JSON.stringify(result ?? "");
  const line = plain(raw.replace(/\s+/g, " "));
  return line.length > 320 ? `${line.slice(0, 317)}…` : line;
}

/**
 * Trace → activity rows: a direct port of the UI's buildRows in
 * AgentActivity — steps only when there is no trace, consecutive thoughts
 * merged, each tool result paired with its still-running call (the UI keeps
 * responses as separate rows for skill runs — same split here).
 */
function buildTraceRows(run: any, separate: boolean): any[] {
  const events: any[] = Array.isArray(run.trace)
    ? [...run.trace].sort((a: any, b: any) => (a?.seq ?? 0) - (b?.seq ?? 0))
    : [];
  const steps: any[] = Array.isArray(run.steps) ? run.steps : [];
  const rows: any[] = [];
  if (!events.length) {
    for (const st of steps) {
      rows.push({ kind: "step", label: st?.label || st?.key || "step", status: st?.status || "pending", duration_ms: st?.duration_ms });
    }
  }
  for (const ev of events) {
    switch (ev?.type) {
      case "thought": {
        const last = rows[rows.length - 1];
        if (last?.kind === "thought") last.text += ev.text || "";
        else rows.push({ kind: "thought", text: ev.text || "" });
        break;
      }
      case "tool_call":
        rows.push({ kind: "tool", name: ev.tool || "tool", toolCallId: ev.tool_call_id, args: ev.args, status: "running" });
        break;
      case "tool_result": {
        let idx = -1;
        for (let i = rows.length - 1; i >= 0; i--) {
          const r = rows[i];
          if (r.kind === "tool" && r.status === "running" && (ev.tool_call_id ? r.toolCallId === ev.tool_call_id : r.name === ev.tool)) {
            idx = i;
            break;
          }
        }
        if (idx >= 0) {
          rows[idx] = {
            ...rows[idx],
            status: ev.status === "ERR" ? "ERR" : "OK",
            duration_ms: ev.duration_ms,
            snippet: separate ? undefined : resultExcerpt(ev.result),
          };
        } else {
          rows.push({ kind: "log", text: `${ev.tool} → ${ev.status}` });
        }
        if (separate) rows.push({ kind: "tool_response", name: ev.tool || "tool", status: ev.status || "OK", result: ev.result });
        break;
      }
      case "decision":
        rows.push({ kind: "decision", score: ev.score, text: ev.text || "" });
        break;
      case "log":
        if (ev.text) rows.push({ kind: "log", text: ev.text });
        break;
      default:
        break;
    }
  }
  return rows;
}

/**
 * The Reasoning section: the run's activity rows printed line by line —
 * merged thoughts, tool calls with args, duration, status and a short
 * response excerpt, decisions, and log lines.
 */
function reasoningBlocks(run: any): PdfContent {
  const out: PdfContent = [];
  const rows = buildTraceRows(run, run.run_mode === "skill");
  if (!rows.length) {
    out.push(callout("No reasoning trace was stored for this run.", "neutral"));
    return out;
  }
  const secs = (ms?: number) => (typeof ms === "number" ? `  ·  ${(ms / 1000).toFixed(1)}s` : "");
  for (const r of rows) {
    if (r.kind === "step") {
      out.push({ text: `${plain(r.label)}  ·  ${plain(String(r.status))}${secs(r.duration_ms)}`, style: "body", margin: [0, 2, 0, 0] });
    } else if (r.kind === "thought") {
      // Full thoughts stay; the 1600-char cap only guards a runaway loop.
      const text = plain(String(r.text).slice(0, 1600));
      if (text) out.push({ text, style: "thought" });
    } else if (r.kind === "tool") {
      const args = toolArgsLine(r.args);
      const glyph = r.status === "running" ? "·" : r.status === "ERR" ? "✗" : "✓";
      out.push({
        columns: [
          {
            text: `${glyph} ${plain(r.name)}${args ? `  ${args}` : ""}${secs(r.duration_ms)}`,
            style: "toolLine",
            width: "*",
          },
          ...(r.status === "running"
            ? []
            : [{ text: r.status, style: "obsUrl", width: "auto", color: r.status === "ERR" ? "#B85C5C" : undefined }]),
        ],
        columnGap: 6,
        margin: [0, 3, 0, 0],
      });
      if (r.snippet) out.push({ text: r.snippet, style: "obsSummary", margin: [16, 1, 0, 3] });
    } else if (r.kind === "tool_response") {
      const ok = String(r.status).toUpperCase() !== "ERR";
      out.push({
        text: `${ok ? "response" : "response (ERR)"} — ${resultExcerpt(r.result) || "no data"}`,
        style: "obsSummary",
        margin: [16, 1, 0, 3],
      });
    } else if (r.kind === "decision") {
      out.push({
        text: [
          { text: "Decision", style: "toolLine" },
          ...(r.score != null ? [{ text: `  ${Number(r.score).toFixed(1)}`, style: "toolLine" }] : []),
          ...(r.text ? [{ text: `  —  ${plain(String(r.text)).slice(0, 400)}`, color: "#7A5A1F", fontSize: 8.5 }] : []),
        ],
        margin: [0, 4, 0, 0],
      });
    } else {
      out.push({ text: plain(r.text), style: "obsSummary", margin: [0, 2, 0, 0] });
    }
  }
  return out;
}

/** Assemble the full PDF document definition for a completed run. */

/** Time-series ChartSpec → legacy chart rows (the SVG renderers' input). */
function chartRows(spec: ChartSpec): { data: Record<string, string | number>[]; sourceKeys: string[] } {
  if (spec.categories?.length) {
    // gbar: one column per group, aligned to the categories — never zero-filled.
    if (spec.groups?.length) {
      const names = spec.groups.map((g) => g.name);
      return {
        data: spec.categories.map((name, i) => ({
          name,
          ...Object.fromEntries(spec.groups!.map((g) => [g.name, g.values[i] ?? 0])),
        })),
        sourceKeys: ["name", ...names],
      };
    }
    return {
      data: spec.categories.map((name, i) => ({ name, value: spec.values?.[i] ?? 0 })),
      sourceKeys: ["name", "value"],
    };
  }
  const rows = new Map<number, Record<string, string | number>>();
  for (const series of spec.series ?? []) {
    for (const p of series.points) {
      const row = rows.get(p.t) ?? { date: new Date(p.t < 1e12 ? p.t * 1000 : p.t).toISOString().slice(0, 10) };
      row[series.label] = p.v;
      rows.set(p.t, row);
    }
  }
  const data = [...rows.values()];
  return { data, sourceKeys: data[0] ? Object.keys(data[0]) : ["date", "value"] };
}

type LegacyChartType = Extract<ReportBlock, { type: "chart" }>["chartType"];
/** New kinds → the legacy PNG chart families. `table`/`matrix` never reach here (pushChart handles them). */
const CHART_TYPE = (kind: ChartSpec["kind"]): LegacyChartType =>
  kind === "kpi-card" || kind === "stat-spark" || kind === "multiline" ? "line"
  : "bar";

/** Typed ReportDocument (v1 flat or v2 nested) → legacy blocks, reusing the existing block renderers. */
export function documentToBlocks(doc: ReportDocument): ReportBlock[] {
  const out: ReportBlock[] = [];
  const pushChart = (spec: ChartSpec, title?: string) => {
    // The table/matrix figure IS a legacy table — ship it as one, no PNG round-trip.
    if ((spec.kind === "table" || spec.kind === "matrix") && spec.columns?.length && spec.rows?.length) {
      out.push({
        type: "table",
        title,
        columns: spec.columns,
        rows: spec.rows.map((r) => r.map((c) => (c != null && typeof c === "object" ? c.text : c)) as (string | number)[]),
        sourceKeys: [],
      });
      return;
    }
    const { data, sourceKeys } = chartRows(spec);
    // Gate on drawable content, not row count: a kpi-card is one row and must
    // still render. figure-kit returns null for a spec with nothing to draw.
    const drawable = !!(spec.series?.length || spec.values?.length || spec.rows?.length || spec.groups?.length);
    if (drawable) out.push({ type: "chart", chartType: CHART_TYPE(spec.kind), title, data, sourceKeys, spec } as ReportBlock);
  };
  const sourceNote = (label?: string) => label ? { type: "paragraph" as const, text: `Source: ${label}`, citedKeys: [] } : null;
  // v2 nested section → heading + blocks; v1 flat blocks pass through below.
  const isV2 = doc.sections.some((s: any) => s && typeof s === "object" && "heading" in s);
  if (isV2) {
    for (const sec of doc.sections as any[]) {
      out.push({ type: "heading", level: sec.heading.level === 1 ? 2 : 3, text: sec.heading.text, tagline: sec.heading.tagline });
      for (const b of sec.blocks ?? []) {
        const src = b.sourceId ? doc.sources.find((x) => x.id === b.sourceId) : undefined;
        switch (b.type) {
          case "text":
            out.push({ type: "paragraph", text: b.text, citedKeys: (b.highlights ?? []).map((h: any) => h.sourceId).filter((x: any) => !!x) });
            break;
          case "callout":
            out.push({ type: "callout", tone: b.variant === "warn" ? "caution" : b.variant === "key" ? "positive" : "neutral", text: `${b.title ? `${b.title}: ` : ""}${b.text}` });
            break;
          case "table":
            out.push({ type: "table", title: b.title, columns: b.columns, rows: b.rows, sourceKeys: [] });
            if (src) out.push(sourceNote(src.url ? `${src.label} (${src.url})` : src.label)!);
            break;
          case "chart":
            pushChart(b.spec, b.title);
            if (src) out.push(sourceNote(src.url ? `${src.label} (${src.url})` : src.label)!);
            break;
          case "metrics":
            out.push({ type: "table", title: "At a glance", columns: ["Metric", "Value", "Delta"], rows: b.items.map((m: any) => [m.label, m.value, m.delta ?? ""]), sourceKeys: [] });
            break;
          case "code":
            out.push({ type: "quote", text: b.text });
            break;
          case "compare":
            if ("kind" in b.before) pushChart(b.before, `${b.title ?? "Comparison"} — before`);
            if ("kind" in b.after) pushChart(b.after, `${b.title ?? "Comparison"} — after`);
            if (src) out.push(sourceNote(src.url ? `${src.label} (${src.url})` : src.label)!);
            break;
          case "diagram":
            // Mermaid renders in the UI; the PDF notes it rather than guessing.
            out.push({ type: "paragraph", text: `[${b.spec.syntax} diagram — see the report view]` });
            if (src) out.push(sourceNote(src.url ? `${src.label} (${src.url})` : src.label)!);
            break;
          case "citations":
            break;
        }
      }
    }
    return out;
  }
  for (const s of doc.sections as any[]) {
    switch (s.type) {
      case "heading":
        out.push({ type: "heading", level: s.level === 1 ? 2 : 3, text: s.text });
        break;
      case "paragraph":
        out.push({ type: "paragraph", text: s.text, citedKeys: (s.highlights ?? []).map((h: any) => h.sourceId).filter((x: any) => !!x) });
        break;
      case "callout":
        out.push({ type: "callout", tone: s.variant === "warn" ? "caution" : s.variant === "key" ? "positive" : "neutral", text: `${s.title ? `${s.title}: ` : ""}${s.text}` });
        break;
      case "table":
        out.push({ type: "table", title: s.title, columns: s.columns, rows: s.rows, sourceKeys: [] });
        break;
      case "chart":
        pushChart(s.spec, s.title);
        break;
      case "quote":
        out.push({ type: "quote", text: s.text, attribution: s.attribution });
        break;
      case "metrics":
        out.push({ type: "table", title: "At a glance", columns: ["Metric", "Value", "Delta"], rows: s.items.map((m: any) => [m.label, m.value, m.delta ?? ""]), sourceKeys: [] });
        break;
      case "badges":
        out.push({ type: "paragraph", text: s.items.map((i: any) => i.label).join("  ·  ") });
        break;
      case "code":
        out.push({ type: "quote", text: s.text });
        break;
      case "compare":
        if ("kind" in s.before) pushChart(s.before, `${s.title ?? "Comparison"} — before`);
        if ("kind" in s.after) pushChart(s.after, `${s.title ?? "Comparison"} — after`);
        break;
      case "diagram":
        // Mermaid renders in the UI; the PDF notes it rather than guessing.
        out.push({ type: "paragraph", text: `[${s.spec.syntax} diagram — see the report view]` });
        break;
      case "citations":
        break;
    }
  }
  return out;
}

/** The wordmark — "Relativity." set in Newsreader, the app's Logo as type. */
function wordmark(margin: number[] = [0, 0, 0, 10]): PdfNode {
  return { text: "Relativity.", style: "wordmark", margin };
}

/** Shared page styles: Newsreader for display, Anek Latin for everything else. */
const PDF_STYLES = {
  wordmark: { fontSize: 16, font: "Newsreader", color: "#16181B" },
  title: { fontSize: 26, font: "Newsreader", color: "#16181B" },
  subtitle: { fontSize: 12, color: "#6B7280" },
  meta: { fontSize: 9, color: "#9CA3AF", margin: [0, 2, 0, 0] },
  hero: { fontSize: 30, font: "Newsreader", color: "#16181B" },
  heroLabel: { fontSize: 9, color: "#9CA3AF", margin: [0, -6, 0, 8] },
  eyebrow: { fontSize: 7.5, bold: true, color: "#23747D", characterSpacing: 1.4 },
  h1: { fontSize: 17, font: "Newsreader", color: "#16181B" },
  sectionCount: { fontSize: 11, bold: true, color: "#9CA3AF" },
  h2: { fontSize: 14, font: "Newsreader", color: "#16181B", margin: [0, 16, 0, 6] },
  tagline: { fontSize: 9.5, font: "Newsreader", italics: true, color: "#23747D", margin: [0, -2, 0, 8] },
  h3: { fontSize: 11, font: "Newsreader", color: "#4B5563", margin: [0, 10, 0, 3] },
  body: { fontSize: 9.5, color: "#4B5563", lineHeight: 1.45, margin: [0, 2, 0, 4] },
  callout: { fontSize: 9.5, margin: [10, 6, 10, 6], color: "#4B5563" },
  quote: { fontSize: 10, font: "Newsreader", italics: true, color: "#4B5563", margin: [0, 4, 0, 6] },
  tableTitle: { fontSize: 9.5, bold: true, color: "#4B5563", margin: [0, 6, 0, 2] },
  cellHeader: { fontSize: 8.5, bold: true, color: "#6B7280", margin: [0, 1] },
  cell: { fontSize: 8.5, color: "#16181B", margin: [0, 1] },
  infoLabel: { fontSize: 8, color: "#9CA3AF" },
  infoValue: { fontSize: 8, color: "#16181B" },
  sourceLine: { fontSize: 7.5, color: "#23747D", margin: [1, 0, 0, 4] },
  spacer: { fontSize: 6 },
  footer: { fontSize: 7.5, color: "#9CA3AF" },
};

export async function buildReportPdf(run: any): Promise<Buffer> {
  const report = run.report || {};
  // v2 harness documents carry their own sections; legacy runs stored flat blocks.
  const isDoc = report?.schema === "relativity/report.v1" || report?.schema === "relativity/report.v2";
  const blocks: ReportBlock[] = isDoc
    ? documentToBlocks(report as ReportDocument)
    : Array.isArray(report.blocks)
      ? report.blocks
      : [];
  const docSources: any[] = isDoc && Array.isArray(report.sources) ? report.sources : [];
  // The report's own verdict word leads the hero when no score was computed.
  const verdictWord = isDoc && typeof report.verdict === "string" && report.verdict ? String(report.verdict) : null;
  const total = run.total_score;
  const coverage = run.coverage;
  const fitLow = run.fit_low;
  const fitHigh = run.fit_high;
  const isSkillRun = run.run_mode === "skill";
  // UI parity: below the coverage floor the headline number is suppressed —
  // the hero renders "—" and the caution callout explains why (U2).
  const lowCov = insufficientCoverage(coverage);
  // UI coverage pill wording: "83% of rubric scored".
  const covText = coveragePct(coverage) != null ? `${coveragePct(coverage)}% of rubric scored` : "coverage n/a";
  // Footer agent label: same uuid guard as the title band.
  const footerAgent = isUuid(run.agent_name)
    ? run.agent_display_name || ""
    : run.agent_name || "";
  const traceCount = Array.isArray(run.trace) ? run.trace.length : 0;
  // Subject's own logo, hotlinked from the free logo APIs — never stored.
  // A miss just means the title renders without it.
  const tickerLogo = await tickerLogoDataUri(run.symbol);

  // ── Section 01: executive summary (agent runs only, mirrors the UI) ──
  const execNodes: PdfNode[] = [];
  if (!isSkillRun) {
    execNodes.push(...sectionOpener("Section 01", "Executive summary", { count: String(blocks.length) }));
    if (!run.report) {
      // UI shows these two in this order: partial first, then fallback.
      execNodes.push(callout("No executive synthesis for this run — review the parameter breakdowns below.", "caution"));
    } else {
      if (report.partial) {
        execNodes.push(
          callout(
            `Some skills could not assess every anchor — this report leans on partial evidence${covText !== "coverage n/a" ? ` (${covText})` : ""}.`,
            "caution",
          ),
        );
      }
      if (report.source === "fallback") {
        execNodes.push(
          callout(
            "AI narrative was unavailable for this run; this synthesis was assembled deterministically from the scored breakdowns below.",
            "caution",
          ),
        );
      }
    }
    for (const block of blocks) {
      for (const n of await blockToPdfContent(block, evidenceLookupFor(run))) execNodes.push(n);
    }
    const execPlots = (report as any).plots as any[] | undefined;
    if (execPlots && execPlots.length) {
      execNodes.push({ text: "Charts", style: "h2", margin: [0, 16, 0, 6] });
      for (const p of execPlots) {
        if (p.title || p.caption) execNodes.push({ text: p.title || p.caption, style: "h3" });
        const data = Array.isArray(p.data) ? p.data : [];
        if (data.length) {
          const keys = Object.keys(data[0]).slice(0, 6);
          const rows = [[...keys], ...data.slice(0, 8).map((r: any) => keys.map(k => r[k] ?? ""))];
          execNodes.push({ table: { widths: keys.map(() => "*"), body: rows }, layout: "lightHorizontalLines" });
          if (data.length > 8) execNodes.push({ text: `... (${data.length} points total)`, style: "body", fontSize: 8 });
        }
      }
    }
  }

  // ── Section 02: skill reports, one chapter per page ──
  const outputs: any[] = Array.isArray(run.skill_outputs) ? run.skill_outputs : [];
  const usable = outputs.filter((o) => o && (o.skill_id || o.skill_name));
  // Agent runs break the summary onto a fresh page; skill runs have no
  // summary, so their first section flows straight under the title band.
  const skillNodes: PdfNode[] = sectionOpener(isSkillRun ? "Section 01" : "Section 02", "Skill reports", {
    pageBreak: !isSkillRun,
    count: String(usable.length),
  });
  if (usable.length === 0) {
    skillNodes.push(callout("No skill reports were stored for this run.", "caution"));
  } else {
    // Index — a real sequence: each skill's score and coverage at a glance.
    usable.forEach((o, i) => {
      const score = o.score_0_100;
      skillNodes.push(
        card(
          [
            {
              columns: [
                { text: `${String(i + 1).padStart(2, "0")}`, style: "sourceLine", width: "auto", margin: [0, 0, 8, 0] },
                { text: `${o.skill_name || o.skill_id || "Skill"}`, style: "cell", width: "*" },
                {
                  text: `${score != null ? score : "no score"}${o.coverage != null ? ` · ${coveragePct(o.coverage)}%` : ""}`,
                  style: "sourceLine",
                  width: "auto",
                  alignment: "right",
                  color: signalColor(score),
                },
              ],
              columnGap: 4,
            },
          ],
          [0, 2, 0, 2],
        ),
      );
      const sp = (o as any).plots as any[] | undefined;
      if (sp && sp.length) {
        for (const p of sp.slice(0, 2)) {
          if (p.title || p.caption) skillNodes.push({ text: p.title || p.caption, style: "tableTitle" });
          const data = Array.isArray(p.data) ? p.data : [];
          if (data.length) {
            const keys = Object.keys(data[0]).slice(0, 6);
            const rows = [[...keys], ...data.slice(0, 6).map((r: any) => keys.map(k => r[k] ?? ""))];
            skillNodes.push({ table: { widths: keys.map(() => "*"), body: rows }, layout: "lightHorizontalLines" });
          }
        }
      }
    });
    skillNodes.push({ text: "", style: "spacer" });
  }

  const document: any = {
    pageSize: "A4",
    pageMargins: [44, 46, 44, 60],
    fonts: PDF_FONTS,
    info: { title: `${run.share_name || run.symbol || "Analysis"} — Equity Report`, author: "Relativity" },
    footer: (currentPage: number, pageCount: number) => ({
      columns: [
        { text: "Relativity.", style: "wordmark", fontSize: 8.5, margin: [0, 1, 0, 0] },
        { text: `${run.share_name || run.symbol}${footerAgent ? ` · ${footerAgent}` : ""}`, style: "footer", alignment: "left", margin: [0, 3, 0, 0] },
        {
          text: [
            { text: `page ${currentPage} of ${pageCount}` },
            // Attribution the Ticker Logos licence requires wherever its
            // logo is printed — linked, same footer size and colour.
          ],
          style: "footer",
          alignment: "right",
          margin: [0, 3, 0, 0],
        },
      ],
      columnGap: 6,
      margin: [44, 20, 44, 0],
    }),
    content: [
      // ── Title band ──
      // Wordmark alone on top, stock name and details stacked below it.
      wordmark(),
      // Subject's logo sits left of the title; an empty spacer keeps the
      // column geometry identical when the CDN has no logo for the ticker.
      {
        columns: [
          tickerLogo
            ? { image: tickerLogo, width: 34, fit: [34, 34], margin: [0, 5, 0, 0] }
            : { text: "", width: 34 },
          { text: run.share_name || run.symbol || "Equity Analysis", style: "title" },
        ],
        columnGap: 12,
      },
      // Exchange mark for the market this stock was selected on, sized to read
      // at print size (the old report carried the source only as 12px text).
      {
        columns: [
          {
            image: String(run.source || "NSE").toUpperCase().includes("SEC") ? SEC_LOGO_DATA_URI : NSE_LOGO_DATA_URI,
            // width fixes the column width too, so the symbol text sits next
            // to the mark instead of a natural-width gap away.
            width: 64,
            fit: [64, 30],
          },
          {
            text: `${run.symbol || ""}${run.source ? ` · ${run.source}` : ""}`,
            style: "subtitle",
            margin: [8, 8, 0, 0],
          },
        ],
        columnGap: 6,
        margin: [0, 2, 0, 10],
      },
      // Skill runs have no agent to sign the report — a plain subject line
      // replaces the portrait identity band (the UI shows the skill name in
      // its meta line for skill runs).
      ...(isSkillRun
        ? [
            {
              text: `Skill run · ${usable[0]?.skill_name || run.skill_id || "skill"}${
                run.created_at ? ` · ${new Date(run.created_at).toLocaleDateString()}` : ""
              }`,
              style: "subtitle",
              margin: [0, 2, 0, 10],
            },
          ]
        : [identityTitleBand(run)]),
      { text: "", style: "spacer" },
      // ── Hero band (agent runs; the UI shows no hero for skill runs) ──
      ...(!isSkillRun
        ? [
            {
              table: {
                headerRows: 0,
                widths: ["*"],
                body: [
                  [
                    {
                      // The verdict word leads when no score was computed (the
                      // UI puts the verdict's word at the headline too).
                      text: verdictWord
                        ? verdictWord
                        : report.heroLabel
                          ? String(report.heroLabel)
                          : total != null && !lowCov
                            ? `${total}`
                            : "—",
                      style: "hero",
                      color: verdictWord
                        ? VERDICT_TONE[verdictWord] ?? "#9CA3AF"
                        : report.heroLabel
                          ? "#16181B"
                          : total == null || lowCov
                            ? "#9CA3AF"
                            : signalColor(total),
                      alignment: "center",
                      ...(!verdictWord && report.heroLabel && String(report.heroLabel).length > 14 ? { fontSize: 20 } : {}),
                    },
                  ],
                  [
                    {
                      // UI renders the band pill beside the coverage pill in
                      // both hero variants — fold both into this sub-line.
                      text: verdictWord && total == null
                        ? `Verdict from the report · ${covText}`
                        : report.heroLabel
                          ? `Stance${total != null && !lowCov ? ` · ${bandLabel(total)}` : ""} · ${covText}`
                          : total == null
                            ? "No fit score — see the skill reports below"
                            : lowCov
                              ? covText
                              : `Fit to the agent's philosophy · ${bandLabel(total)} · ${covText}${fitLow != null && fitHigh != null ? ` · band ${fitLow}–${fitHigh}` : ""}`,
                      style: "heroLabel",
                      alignment: "center",
                    },
                  ],
                ],
              },
              layout: CARD_LAYOUT,
              margin: [0, 4, 0, 18],
            },
            // No synthesised report: the UI prints its generated verdict
            // sentence right under the hero instead of in the summary body.
            ...(!run.report
              ? [{ text: generateVerdict(run), style: "body", margin: [0, -10, 0, 10] }]
              : []),
          ]
        : []),
      // ── Run info: verdict, identity, timing, tokens ──
      runInfoPanel(run, covText, verdictWord),
      // Callouts the UI shows above the report body (all run modes).
      ...(run.price_data === "unavailable"
        ? [
            callout(
              "No live price feed for this instrument — valuation and technical criteria are shown as N/A.",
              "caution",
              [0, 0, 0, 8],
            ),
          ]
        : []),
      ...(run.error
        ? [callout(`Run error — ${plain(String(run.error)).slice(0, 400)}`, "negative", [0, 0, 0, 8])]
        : []),
      ...(!isSkillRun && insufficientCoverage(coverage)
        ? [
            callout(
              `Not enough of the rubric could be scored to give a reliable headline score. Only ${coveragePct(coverage)}% of the criteria had usable data. Review the breakdowns below — unscored criteria are excluded, not failed.`,
              "caution",
              [0, 0, 0, 8],
            ),
          ]
        : []),
      ...execNodes,
      ...skillNodes,
      ...usable.flatMap((o, i) => skillSectionBlocks(o, i, usable.length)),
      // ── Section 03: reasoning trace ──
      ...sectionOpener(
        isSkillRun ? "Section 02" : "Section 03",
        isSkillRun ? "Skill reasoning" : "Agent reasoning",
        { pageBreak: true, count: String(traceCount) },
      ),
      ...reasoningBlocks(run),
      // ── Sources the report cited (v2 documents carry their own) ──
      ...(docSources.length
        ? [
            ...sectionOpener("Appendix", "Sources", { pageBreak: true, count: String(docSources.length) }),
            ...docSources.map((s: any) => ({
              text: `•  ${plain([s.label, s.value].filter(Boolean).join(" — "))}${s.url ? `  ${s.url}` : ""}`,
              style: "sourceLine",
              margin: [0, 2, 0, 2],
            })),
          ]
        : []),
    ],
    defaultStyle: { font: "Anek" },
    styles: {
      ...PDF_STYLES,
      verdictPill: { fontSize: 8, bold: true, color: "#4B5563", alignment: "right" },
      obsHeader: { fontSize: 8, bold: true, color: "#16181B" },
      obsUrl: { fontSize: 7, color: "#9CA3AF" },
      obsSummary: { fontSize: 8, color: "#4B5563", lineHeight: 1.35, margin: [0, 0, 0, 2] },
      obsRaw: { fontSize: 6.5, color: "#9CA3AF", lineHeight: 1.3, margin: [0, 0, 0, 4] },
      thought: { fontSize: 9, font: "Newsreader", italics: true, color: "#4B5563", lineHeight: 1.45, margin: [12, 3, 0, 4] },
      toolLine: { fontSize: 8.5, color: "#16181B" },
      risks: { fontSize: 9, color: "#7A5A1F", margin: [0, 2, 0, 4] },
    },
  };

  const pdf: any = pdfMake;
  const doc = pdf.createPdf(document, undefined, PDF_FONTS, pdfFontVfs());
  return new Promise<Buffer>((resolve, reject) => {
    doc.getBuffer((buf: Buffer) => resolve(Buffer.from(buf)), (err: Error) => reject(err));
  });
}