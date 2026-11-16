/**
 * System-prompt reference blocks — generated from the live schema so adding a
 * chart kind or a section primitive never needs a prompt edit. The agent's
 * format markdown embeds these via {{section_contract}} / {{plot_reference}}
 * slots (engine.ts fills them per run; if the format file drops a slot, the
 * engine appends the block itself so the contract always reaches the model).
 */

import { ChartSpecSchema } from "./document.js";

export interface BlockSpec {
  id: string;
  name: string;
  /** One line: when the model should reach for this block. */
  when: string;
  /** Minimal, copyable JSON example. */
  json: string;
}

/** The report_write block vocabulary — everything allowed INSIDE a section. */
export const BLOCKS: BlockSpec[] = [
  {
    id: "text",
    name: "text",
    when:
      "Prose. level 1 = the claim/lead (inline sources via highlights); level 2 = the supporting detail — OPTIONAL: a level-1 text may stand alone; when a level-2 follows, it comes IMMEDIATELY after its level-1. Every number gets a highlight with a sourceId.",
    json: `{ "type": "text", "level": 1, "text": "…", "highlights": [{ "text": "4.2%", "kind": "positive", "sourceId": "s1" }] }`,
  },
  {
    id: "chart",
    name: "chart",
    when:
      "Any figure — everything nests under `spec` (kind inside spec). Lines: `line` (ONE series) / `multiline` (2–4 series) / `area`. Bars: `hbar` (magnitude by sign, hover values) / `vbar` (paired totals + drawdown markers) / `gbar` (grouped comparisons). Grids: `table` (advanced cells) / `matrix` (heatmap). Cards: `kpi-card` / `stat-spark`. Time-series kinds take `spec.data` tokens or `spec.series` (ALWAYS name them via `spec.names`); grid kinds take `spec.columns`+`spec.rows`; categorical bars take `spec.categories`+`spec.values` (paired/grouped: `spec.groups`). Carry `measure` (axis unit); optional `color` (hex) when the skill's structure prescribes a palette.",
    json: `{ "type": "chart", "title": "…", "measure": "USD", "spec": { "kind": "candle", "data": "price, sma200" } }`,
  },
  {
    id: "compare",
    name: "compare",
    when: "Before/after pairs (entry vs stop, scenario A vs B). Each side is a chart.",
    json: `{ "type": "compare", "title": "Scenario", "before": { "kind": "line", "data": "price" }, "after": { "kind": "line", "data": "price, sma200" } }`,
  },
  {
    id: "citations",
    name: "citations",
    when: "REQUIRED at the end of the report's last section (or per section when the skill asks): the sources you actually used. Each ref is the agent-written { source, url } — real label and real link, exactly as you found them. Never emit placeholder tokens like [src] or [1].",
    json: `{ "type": "citations", "refs": [{ "source": "Apple Q3 2026 press release", "url": "https://apple.com/newsroom/…" }] }`,
  },
];

/** The envelope every report_write section must have. */
export const SECTION_SHAPE = `Each section you write is a COMPLETE unit — one heading plus its inner blocks. Nothing outside a section:

\`\`\`json
{
  "heading": { "level": 2, "text": "How is the economy doing?", "tagline": "Mixed" },
  "blocks": [
    { "type": "text", "level": 1, "text": "…claim…" },
    { "type": "text", "level": 2, "text": "…detail…" },
    { "type": "chart", "title": "…", "tagline": "…", "measure": "USD", "spec": { "kind": "multiline", "data": "price, sma200" } }
  ]
}
\`\`\`

Rules:
- Exactly ONE heading per section, and it carries \`tagline\` (REQUIRED): 3–5 words, the answer ("Mixed", "Funds buying, savers sitting") — rendered in colour under the title.
- Section order: heading → level-1 text → OPTIONAL level-2 detail → figures. A level-1 text may stand alone; a level-2 must sit directly under its level-1.
- Cite sources INLINE, not by id: no \`sourceId\` fields exist and the harness keeps no source registry. When the report's structure asks for sources, end with a \`citations\` block whose refs carry the REAL { source, url } you pulled numbers from. Never write placeholder tokens like \`[src]\`, \`[1]\` or \`[source]\`.
- \`kpi-card\` and \`stat-spark\` render as CARDS, not plots: carry \`title\` and \`tagline\` (3–5 words); \`stat-spark\` clusters several cards via \`panels\`.
- \`badges\`, \`quote\` and \`callout\` do not exist — never write them.`;

/**
 * Data tokens the harness can expand at assembly — mirrors tokenSeries() in
 * report/builder.ts (price, volume, sma overlays and rsi14 only; no local
 * indicator math).
 */
export const DATA_TOKENS = ["price", "volume", "sma20", "sma50", "sma200", "rsi14"];

/**
 * What each kind needs and how it ships — mirrors renderFigure() dispatch in
 * report/figure-kit.ts. ponytail: hand-kept next to the schema enum; update
 * together (a new kind needs a renderer anyway).
 */
const PLOT_NOTES: Record<string, string> = {
  line: "single time-series — ONE `series` (or one `data` token). Tall plot, tight y-axis that hugs the data, serif end label, hover crosshair (date + value). ALWAYS name the line (`spec.names` positional, or the series `label`). Not for comparisons — use `multiline`.",
  multiline: "2–4 time-series on one axis — `series` or comma `data` tokens (e.g. \"price, sma200\"); lead = story ink, rival = ink, rest grey. Name EVERY line via `spec.names`. Hover shows date + every series' value. Never more than 4 lines.",
  area: "time-series with weight — same data as `line`, drawn as the line itself.",
  hbar: "magnitude bars from one zero baseline, inked by sign (positive = blue ink, negative = warm ink); the signed value appears on hover; sign legend on top; compact width. Rankings, sector days, top/bottom lists.",
  vbar: "paired vertical columns — `groups` with TWO series: primary period totals (ink columns, serif value labels) alongside secondary negative peak/drawdown markers (warm dashes + labels); legend on top, compact width, signed axis. A single series (`categories`+`values`) draws plain columns.",
  gbar: "grouped columns — `categories` + `groups` (2–4 of `{name, values}`); ONE group per series, every group aligned to the same categories. Legend, compact width, serif value labels when ≤2 groups. The comparison chart: returns by period across indices/sectors, plan vs actual.",
  table: "the advanced grid — `columns` (headers) + `rows`; cells are text, numbers, or `{ text, sub?, bar? }` — a level-1 main line, a level-2 muted sub-line, an optional 0..1 underline gauge. Bold row labels, generous spacing, numbers right-aligned. Model-vs-model, financials, comparisons.",
  matrix: "heatmap grid — `columns` + `rows` where each row = [label, group?, ...numbers] aligned to the columns; numeric cells shade by sign AND magnitude (blue positive, warm negative) with signed tabular values; `plain` names columns left unshaded (e.g. \"Below peak\"). Returns across periods, factor scores, anything numerical.",
  "kpi-card": "big-number card — accented top border, category label, prominent serif headline value with a small unit beside it, contextual sub-line. `categories[0]` label, `values[0]` value, `measure` the unit text, `categories[1]` sub-line. For THE one number that matters.",
  "stat-spark": "KPI card with an inline sparkline — headline metric (sign-coloured serif), sub-line, spark path with an endpoint marker dot. `categories[0]` label, `values[0]` value, `measure` unit, `categories[1]` sub-line, `series` (or a `data` token) the spark. Put sibling cards in `panels` — they render as one card row.",
};

/** The report_write contract: the section envelope + every block with a copyable JSON example. */
export function sectionContractMarkdown(): string {
  const blocks = BLOCKS.map((p) => `- ${p.id} — ${p.when}\n      ${p.json}`).join("\n");
  return `${SECTION_SHAPE}\n\nBlock types allowed inside a section:\n${blocks}`;
}

/**
 * Plot menu + the exact spec shapes. `hasSeriesTool` steers honestly: with a
 * web-only toolbox no `data` token can ever resolve, so categorical charts are
 * the only ones that will actually draw.
 */
export function plotReferenceMarkdown(hasSeriesTool: boolean): string {
  const kinds = ChartSpecSchema.shape.kind.options;
  const lines = [
    "Every chart's data nests under `spec` — `kind` lives INSIDE `spec`:",
    "",
    ...kinds.map((k) => `- \`${k}\` — ${PLOT_NOTES[k] ?? "see the renderer"}`),
    "",
    "Data shapes:",
    `- bars: \`{ "type": "chart", "measure": "%", "spec": { "kind": "hbar", "categories": ["FMCG", "Pharma", "IT"], "values": [-0.8, -1.2, 0.6] } }\` — inked by sign, value on hover`,
    `- paired columns: \`{ "type": "chart", "measure": "%", "spec": { "kind": "vbar", "categories": ["'22", "'23", "'24"], "groups": [{ "name": "Total return over the calendar year, %", "values": [6, 21, 10] }, { "name": "Largest fall from a peak within that year, %", "values": [-16, -7, -11] }] } }\` — primary totals + secondary drawdown markers`,
    `- grouped: \`{ "type": "chart", "measure": "%", "spec": { "kind": "gbar", "categories": ["1Y", "3Y", "5Y"], "groups": [{ "name": "Nifty 50", "values": [-1.8, 10.2, 8.0] }, { "name": "Smallcap 250", "values": [5.9, 12.8, 13.7] }] } }\` — several series across the SAME categories (comparisons: returns, plan vs actual)`,
    `- time-series: \`{ "type": "chart", "measure": "USD", "spec": { "kind": "multiline", "data": "price, sma200", "names": ["AAPL", "200-day average"] } }\` — the harness expands tokens into real series at assembly`,
    "- `data` tokens resolve ONE symbol's series (this run's payloads) — for ticker-vs-ticker comparisons use a categorical chart (categories+values) with the numbers computed from the evidence; NEVER inline raw point arrays.",
    `- name the lines yourself: \`spec.names\` sits beside \`data\`, positional — \`{ "kind": "multiline", "data": "price, sma20, sma50", "names": ["AAPL", "20-day average", "50-day average"] }\`. REQUIRED — never leave lines named by raw tokens or dates.`,
    `- table: \`{ "type": "chart", "measure": "", "spec": { "kind": "table", "columns": ["Model", "India only", "With global"], "rows": [["Trend", { "text": "48% invested, 52% cash", "sub": "since Sept 2026", "bar": 0.48 }, { "text": "46% invested, 54% cash", "sub": "since Sept 2026", "bar": 0.46 }]] } }\` — cells: text, numbers, or { text, sub?, bar? }`,
    `- matrix: \`{ "type": "chart", "measure": "%", "spec": { "kind": "matrix", "columns": ["Asset", "Class", "1M", "YTD", "Below peak"], "plain": ["Below peak"], "rows": [["Large caps (Nifty 50)", "Indian equity", 10.8, -2.8, -4]] } }\` — heat-shaded numeric cells, unshaded \`plain\` columns`,
    `- kpi-card: \`{ "type": "chart", "measure": "₹ lakh crore", "spec": { "kind": "kpi-card", "categories": ["Foreign investors · Flows", "of Indian shares net sold in the year to 31 Oct 2026"], "values": [3.22] } }\``,
    `- stat-spark: \`{ "type": "chart", "measure": "%", "spec": { "kind": "stat-spark", "categories": ["Nifty 50", "YTD −2.8%"], "values": [-0.61], "data": "price" }, "panels": [{ "kind": "stat-spark", "categories": ["Nifty Bank", "YTD +3.1%"], "values": [-0.79], "data": "price" }] }\` — panels cluster into one card row`,
    "",
    hasSeriesTool
      ? `Data tokens available this run: ${DATA_TOKENS.join(", ")}.`
      : `NO series data tool this run — \`data\` tokens (${DATA_TOKENS.join(", ")}) will NOT resolve. Write categorical charts (categories+values, or \`gbar\` with categories+groups) instead.`,
    "",
    "Every chart carries `measure` (axis unit) plus a one-line caption saying how to read it.",
    `Optional \`color\` (hex, e.g. "#C66B4E") inks the plot — when the active skill's report-structure prescribes a palette, pick from it and give different plots different colors.`,
  ];
  return lines.join("\n");
}
