/**
 * System-prompt reference blocks — generated from the live schema so adding a
 * chart kind or a section primitive never needs a prompt edit. The config-dir
 * markdown embeds these via {{section_contract}} / {{plot_reference}} slots
 * (run.ts fills them per run; if the format file drops a slot, run.ts appends
 * the block itself so the contract always reaches the model).
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
      "Any plotted or tabulated figure — everything nests under `spec` (kind inside spec). Lines: `line` (ONE series) / `multiline` (2–4 series) / `area` / `scatter`. Bars: `hbar` (horizontal, rankings) / `vbar` (columns) / `gbar` (grouped columns — 2–4 series across the SAME categories, for comparisons like returns by period). Parts of a whole: `pie` (share strip) / `donut` (ring + center total). Ledger rows: `table` (columns+rows). Also `candle`, `stat`, `movers`. Categorical kinds take `spec.categories`+`spec.values` (`gbar`: `spec.categories`+`spec.groups`; table: `spec.columns`+`spec.rows`); time-series take `spec.data` tokens or `spec.series`. Carry `measure` (axis unit) and REQUIRED `sourceId` (printed under the figure); optional `color` (hex) when the skill's structure prescribes a palette.",
    json: `{ "type": "chart", "title": "…", "measure": "USD", "sourceId": "s1", "spec": { "kind": "candle", "data": "price, sma200" } }`,
  },
  {
    id: "table",
    name: "table",
    when: "A raw grid (financials, comparisons, factor scores) that is not a plot. Numbers as JSON numbers, not strings. REQUIRED `sourceId` (printed under the table).",
    json: `{ "type": "table", "columns": ["Year", "Revenue"], "rows": [[2024, 391.0]], "sourceId": "s1" }`,
  },
  {
    id: "compare",
    name: "compare",
    when: "Before/after pairs (entry vs stop, scenario A vs B). Each side is a chart. REQUIRED `sourceId` (printed under the figure).",
    json: `{ "type": "compare", "title": "Scenario", "before": { "kind": "line", "data": "price" }, "after": { "kind": "line", "data": "price, sma200" }, "sourceId": "s1" }`,
  },
  { id: "citations", name: "citations", when: "Optional footnote anchor — lands exactly where you write it, never a sources list. The harness appends nothing.", json: `{ "type": "citations", "refs": [] }` },
];

/** The envelope every report_write section must have. */
export const SECTION_SHAPE = `Each section you write is a COMPLETE unit — one heading plus its inner blocks. Nothing outside a section:

\`\`\`json
{
  "heading": { "level": 2, "text": "How is the economy doing?", "tagline": "Mixed" },
  "blocks": [
    { "type": "text", "level": 1, "text": "…claim with inline sources…" },
    { "type": "text", "level": 2, "text": "…detail…" },
    { "type": "chart", "title": "…", "tagline": "…", "measure": "USD", "sourceId": "s1", "spec": { "kind": "multiline", "data": "price, sma200" } }
  ]
}
\`\`\`

Rules:
- Exactly ONE heading per section, and it carries \`tagline\` (REQUIRED): 3–5 words, the answer ("Mixed", "Funds buying, savers sitting") — rendered in colour under the title.
- Section order: heading → level-1 text → OPTIONAL level-2 detail → figures. A level-1 text may stand alone; a level-2 must sit directly under its level-1.
- Every figure (\`chart\`, \`table\`, \`compare\`) MUST carry \`sourceId\` — the harness prints the source beneath it. Writes without it are rejected.
- \`stat\` figures render as a CARDS, not plots: carry \`title\` and \`tagline\` (3–5 words).
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
  line: "single time-series — ONE `series` (or one `data` token); the story line, big serif end label. Not for comparisons — use `multiline`.",
  multiline: "2–4 time-series on one axis — `series` or comma `data` tokens (e.g. \"price, sma200\"); lead = story ink, rival = ink, rest grey. Never more than 4 lines.",
  area: "time-series with weight — same data as `line`, filled under the curve; use when magnitude under the line is the point.",
  scatter: "time-series as dots — `series`; correlation/cluster reads, not trends (use `line` for trends).",
  hbar: "horizontal bars — `categories`+`values`; rankings, top/bottom lists, long category labels. Bars grow left→right from zero, value printed at the bar end.",
  vbar: "vertical columns — `categories`+`values` (discrete comparison) or `series` (over time); heights from zero. Use for period-over-period columns, not rankings.",
  gbar: "grouped columns — `categories` + `groups` (2–4 of `{name, values}`); ONE group per series, every group aligned to the same categories. The comparison chart: returns by period across indices/sectors, YTD vs 1Y vs 3Y, plan vs actual. Not for rankings (hbar), not for a single series (vbar).",
  pie: "parts of a whole — `categories`+`values` summing to a meaningful total; ships as a share strip with % legend (house style: no wedges). ≤6 slices.",
  donut: "parts of a whole with a center total — `categories`+`values`; ring + big-number legend beneath. Use when the whole's size matters as much as the split.",
  candle: "OHLC — `series` with o/h/l per point; renders as the interactive chart in the UI (needs a market-data tool).",
  stat: "big-number KPI card — `categories[0]` = label, `categories[1]` = optional sub-line, `values[0]` = the headline number, `series` or a `data` token = sparkline; for the one number that matters (index level, headline delta).",
  movers: "gainers/losers board — `categories` = names, `values` = signed numbers (two columns past five rows, +/− coloured); set `measure` to `%`; for biggest moves, top/bottom N.",
  table: "ledger table — `columns` (headers) + `rows` (array of arrays; strings and numbers). Hairline rows, numbers right-aligned. USE THIS instead of any markdown/`table` section block for 3+ column figures (financials, comparisons, factor scores). Numbers as JSON numbers, not strings.",
  radar: "categorical (`categories`+`values`); honestly drawn as bars — prefer `hbar` unless the radar shape is the point",
  bar: "LEGACY — prefer `hbar` (categorical) or `vbar` (columns); accepted only so old documents still render",
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
    `- categorical: \`{ "type": "chart", "measure": "USD per share", "sourceId": "s1", "spec": { "kind": "hbar", "categories": ["Base", "Bull"], "values": [218, 354] } }\``,
    `- grouped: \`{ "type": "chart", "measure": "%", "sourceId": "s1", "spec": { "kind": "gbar", "categories": ["1Y", "3Y", "5Y"], "groups": [{ "name": "Nifty 50", "values": [-1.8, 10.2, 8.0] }, { "name": "Smallcap 250", "values": [5.9, 12.8, 13.7] }] } }\` — several series across the SAME categories (comparisons: returns, plan vs actual)`,
    `- time-series: \`{ "type": "chart", "measure": "USD", "sourceId": "s1", "spec": { "kind": "multiline", "data": "price, sma200" } }\` — the harness expands tokens into real series at assembly`,
    "- `data` tokens resolve ONE symbol's series (this run's payloads) — for ticker-vs-ticker comparisons use a categorical chart (categories+values) with the numbers computed from the evidence; NEVER inline raw point arrays.",
    `- name the lines yourself: \`spec.names\` sits beside \`data\`, positional — \`{ "kind": "multiline", "data": "price, sma20, sma50", "names": ["AAPL", "20-day average", "50-day average"] }\`. Omitted → harness labels (close, SMA20…). Never leave lines named by raw tokens or dates.`,
    `- table: \`{ "type": "chart", "measure": "USD bn", "sourceId": "s1", "spec": { "kind": "table", "columns": ["Year", "Revenue", "FCF"], "rows": [[2024, 391.0, 111.5]] } }\` — numbers as JSON numbers`,
    "",
    hasSeriesTool
      ? `Data tokens available this run: ${DATA_TOKENS.join(", ")}.`
      : `NO series data tool this run — \`data\` tokens (${DATA_TOKENS.join(", ")}) will NOT resolve. Write categorical charts (categories+values, or \`gbar\` with categories+groups) instead.`,
    "",
    "Every chart also carries `measure` (axis unit) and `sourceId`, plus a one-line caption saying how to read it.",
    `Optional \`color\` (hex, e.g. "#C66B4E") inks the plot — when the active skill's report-structure prescribes a palette, pick from it and give different plots different colors.`,
  ];
  return lines.join("\n");
}
