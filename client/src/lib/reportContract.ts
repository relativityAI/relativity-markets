/**
 * Client mirror of the harness ReportDocument contract
 * (services/harness/report/document.ts). Keep in sync — the UI renders this
 * document deterministically; no model runs in the render path.
 *
 * Two shapes: v2 (current — nested full sections) and v1 (stored runs —
 * flat block list). The renderer branches on `schema`.
 */

export const REPORT_SCHEMA = "relativity/report.v2";
export const REPORT_SCHEMA_V1 = "relativity/report.v1";

export interface SeriesPoint {
  t: number;
  v: number;
  o?: number;
  h?: number;
  l?: number;
}

export interface Series {
  label: string;
  points: SeriesPoint[];
}

export interface ChartSpec {
  /**
   * The plot reference — the only kinds the agent writes and the renderers
   * draw. Server contract mirror (services/harness/report/document.ts).
   */
  kind: "line" | "multiline" | "area" | "hbar" | "vbar" | "gbar" | "table" | "matrix" | "kpi-card" | "stat-spark";
  /** Domain token(s) resolved server-side into `series` (e.g. "price" or "price, sma200"). */
  data?: string;
  series?: Series[];
  categories?: string[];
  values?: number[];
  /** kind:"gbar"/"vbar" — named series aligned to `categories`. */
  groups?: { name: string; values: number[] }[];
  /** kind:"matrix" — column headers left unshaded (plain values). */
  plain?: string[];
  /** kind:"table"/"matrix" — column headers. */
  columns?: string[];
  /** kind:"table"/"matrix" — one array per row; cells are strings, numbers, or { text, sub?, bar? }. */
  rows?: (string | number | { text: string; sub?: string; bar?: number })[][];
}

/** Mermaid diagram — rendered to SVG client-side, never raw HTML. */
export interface DiagramSpec {
  syntax: "mermaid";
  code: string;
}

export interface Highlight {
  text: string;
  kind: "number" | "positive" | "negative" | "citation" | "neutral";
  sourceId?: string;
}

export interface Source {
  id: string;
  label: string;
  tool: string;
  url?: string;
  value: string;
}

export interface ArtifactRef {
  id: string;
  kind: "xlsx" | "pdf" | "csv";
  label: string;
  url: string;
}

/** Inner block of a v2 section. Figure `sourceId` + `type:"table"` are legacy
 *  (stored docs) — current writes cite sources in the citations block. */
export type ReportBlock =
  | { type: "text"; level: 1 | 2; text: string; highlights?: Highlight[] }
  | { type: "callout"; variant: "info" | "warn" | "key"; title?: string; text: string; highlights?: Highlight[] }
  | { type: "chart"; title?: string; tagline?: string; spec: ChartSpec; panels?: ChartSpec[]; caption?: string; measure?: string; sourceId?: string; color?: string; svgs?: string[] }
  | { type: "diagram"; title?: string; spec: DiagramSpec; caption?: string; sourceId?: string }
  | { type: "table"; title?: string; columns: string[]; rows: (string | number)[][]; caption?: string; sourceId?: string }
  | { type: "compare"; title?: string; before: ChartSpec | DiagramSpec; after: ChartSpec | DiagramSpec; sourceId?: string }
  | { type: "metrics"; items: { label: string; value: string; delta?: string; tone?: "neutral" | "positive" | "negative"; sourceId?: string }[] }
  | { type: "code"; language?: string; text: string }
  | { type: "citations"; refs: (string | { source: string; url?: string })[] };

/** v2 full section: exactly one heading + its inner blocks. */
export interface ReportSection {
  heading: { level: 1 | 2 | 3; text: string; tagline?: string };
  blocks: ReportBlock[];
}

/** v1 flat section (stored runs — read path only). */
export type Section =
  | { type: "heading"; level: 1 | 2 | 3; text: string; tagline?: string }
  | { type: "paragraph"; text: string; highlights?: Highlight[]; level?: 1 | 2 }
  | { type: "callout"; variant: "info" | "warn" | "key"; title?: string; text: string; highlights?: Highlight[] }
  | { type: "table"; title?: string; columns: string[]; rows: (string | number)[][]; caption?: string; sourceId?: string }
  | { type: "chart"; title?: string; tagline?: string; spec: ChartSpec; panels?: ChartSpec[]; caption?: string; measure?: string; sourceId?: string; svgs?: string[] }
  | { type: "citations"; refs: string[] }
  | { type: "diagram"; title?: string; spec: DiagramSpec; caption?: string; sourceId?: string }
  | { type: "badges"; items: { label: string; tone?: "neutral" | "positive" | "negative" | "accent" }[] }
  | { type: "compare"; title?: string; before: ChartSpec | DiagramSpec; after: ChartSpec | DiagramSpec; sourceId?: string }
  | { type: "metrics"; items: { label: string; value: string; delta?: string; tone?: "neutral" | "positive" | "negative"; sourceId?: string }[] }
  | { type: "code"; language?: string; text: string }
  | { type: "quote"; text: string; attribution?: string; sourceId?: string };

interface ReportDocumentBase {
  title?: string;
  subtitle?: string;
  generatedAt?: string;
  symbol: string;
  sources: Source[];
  /** Footnote order (source ids) — assembly-computed. */
  footnotes?: string[];
  artifacts?: ArtifactRef[];
}

export interface ReportDocumentV2 extends ReportDocumentBase {
  schema: typeof REPORT_SCHEMA;
  sections: ReportSection[];
}

export interface ReportDocumentV1 extends ReportDocumentBase {
  schema: typeof REPORT_SCHEMA_V1;
  sections: Section[];
}

export type ReportDocument = ReportDocumentV2 | ReportDocumentV1;

/** True when the document is the current nested-section shape. */
export const isV2 = (doc: ReportDocument): doc is ReportDocumentV2 => doc.schema === REPORT_SCHEMA;
