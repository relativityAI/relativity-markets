/**
 * Deterministic ReportDocument renderer.
 *
 * No model runs here: every node in the typed document maps to a fixed
 * component. This is the payoff of separating analysis (the model produces a
 * ReportDocument) from presentation (this file draws it).
 */

import React, { useEffect, useState } from "react";
import { Box, Flex, Text } from "@/compat/ui";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MarketChart } from "@/components/builder/MarketChart";
import { downloadSvg, downloadCsv, downloadPng } from "@/lib/figureExport";
import { isV2, type ChartSpec, type DiagramSpec, type Highlight, type ReportDocument, type ReportSection, type Section, type Source } from "@/lib/reportContract";
import "@/styles/almanac-report.css";

// Chakra's `--chakra-colors-*-fg` vars died with the runtime — map to the
// app's own semantic tokens (they adapt in dark mode) and keep the old hexes
// for the two shades the theme has no token for.
const HIGHLIGHT_COLOR: Record<Highlight["kind"], string> = {
  neutral: "var(--ink-secondary, #4a5568)",
  number: "#2b6cb0",
  positive: "var(--signal-positive, #2f855a)",
  negative: "var(--signal-negative, #c53030)",
  citation: "#6b46c1",
};

export interface HighlightPart {
  text: string;
  kind?: Highlight["kind"];
  sourceId?: string;
}

/** Split text into plain and highlighted runs. Longest match wins. */
function splitHighlights(text: string, highlights: Highlight[]): HighlightPart[] {
  const sorted = highlights.filter((h) => h.text).sort((a, b) => b.text.length - a.text.length);
  const parts: HighlightPart[] = [];
  let remaining = text;
  while (remaining) {
    let best: { idx: number; h: Highlight } | null = null;
    for (const h of sorted) {
      const idx = remaining.indexOf(h.text);
      if (idx >= 0 && (!best || idx < best.idx)) best = { idx, h };
    }
    if (!best) {
      parts.push({ text: remaining });
      break;
    }
    if (best.idx > 0) parts.push({ text: remaining.slice(0, best.idx) });
    parts.push({ text: best.h.text, kind: best.h.kind, sourceId: best.h.sourceId });
    remaining = remaining.slice(best.idx + best.h.text.length);
  }
  return parts;
}

function epochToDate(t: number): string {
  const ms = t < 1e12 ? t * 1000 : t;
  return new Date(ms).toISOString().slice(0, 10);
}

function toMarketRows(spec: ChartSpec): Record<string, string | number>[] {
  const rows = new Map<number, Record<string, string | number>>();
  for (const s of spec.series ?? []) {
    for (const p of s.points) {
      const row = rows.get(p.t) ?? { date: epochToDate(p.t) };
      // Series label stays on the row: MarketChart reads it as an overlay,
      // the volume pane, or the sole line — reserved keys are filtered there.
      row[s.label] = p.v;
      rows.set(p.t, row);
    }
  }
  return [...rows.entries()].sort((a, b) => a[0] - b[0]).map(([, r]) => r);
}

const SERIES_COLORS = ["#5B7FDE", "#4C8B6B", "#B8935A", "#8FA0C8", "#B85C5C"];

/** area (no-svg fallback) — recharts AreaChart, the same way the legacy builder draws it. */
function SeriesRechartsBlock({ spec, title }: { spec: ChartSpec; title?: string }) {
  const rows = toMarketRows(spec);
  const labels = (spec.series ?? []).map((s) => s.label);
  return (
    <Box data-testid="report-chart" data-kind={spec.kind} my={4}>
      {title && <Text fontWeight="light" mb={2}>{title}</Text>}
      <ResponsiveContainer width="100%" height={280}>
        <AreaChart data={rows}>
          <XAxis dataKey="date" />
          <YAxis />
          <Tooltip />
          <Legend />
          {labels.map((l, i) => (
            <Area key={l} type="monotone" dataKey={l} stroke={SERIES_COLORS[i % SERIES_COLORS.length]} fill={SERIES_COLORS[i % SERIES_COLORS.length]} fillOpacity={0.25} />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </Box>
  );
}

/** Mermaid → inline SVG. strict mode: no scripts, no click handlers. */
function DiagramBlock({ spec, title }: { spec: DiagramSpec; title?: string }) {
  const [svg, setSvg] = useState("");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "neutral" });
        const id = `d${Math.abs([...spec.code].reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 7))}`;
        const { svg: rendered } = await mermaid.render(id, spec.code);
        if (!dead) setSvg(rendered);
      } catch {
        if (!dead) setFailed(true);
      }
    })();
    return () => {
      dead = true;
    };
  }, [spec.code]);
  return (
    <Box data-testid="report-diagram" my={4}>
      {title && <Text fontWeight="light" mb={2}>{title}</Text>}
      {svg ? (
        <Box dangerouslySetInnerHTML={{ __html: svg }} overflow="auto" />
      ) : (
        <Text fontSize="sm" color="fg.muted">{failed ? "Diagram could not be rendered." : "Rendering diagram…"}</Text>
      )}
    </Box>
  );
}

const isChart = (spec: ChartSpec | DiagramSpec): spec is ChartSpec => "kind" in spec;

function ChartBlock({ spec, title }: { spec: ChartSpec; title?: string }) {
  const rows = toMarketRows(spec);
  // Categorical charts draw from categories/values — share strip, ring,
  // columns, horizontal bars; hover shows the value.
  // Grouped columns: several series across the SAME categories (returns by
  // period, YTD across indices) — one recharts <Bar> per group, hover reads all.
  if (spec.kind === "gbar" && spec.categories?.length && spec.groups?.length) {
    const groups = spec.groups;
    const data = (spec.categories ?? []).map((name, i) => {
      const row: Record<string, string | number> = { name };
      for (const gp of groups) row[gp.name] = gp.values[i] ?? 0;
      return row;
    });
    // figure-kit's series ink ladder: story ink → ink → grey → mid grey
    const inks = ["#3A5BD0", "#16181B", "#b7b7bf", "#5A6270"];
    return (
      <Box data-testid="report-chart" data-kind={spec.kind} my={4}>
        {title && <Text fontWeight="light" mb={2}>{title}</Text>}
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={data} margin={{ top: 8, right: 16, bottom: 4 }}>
            <XAxis dataKey="name" />
            <YAxis />
            <Tooltip />
            <Legend />
            {groups.map((gp, i) => (
              <Bar key={gp.name} dataKey={gp.name} fill={inks[i % inks.length]} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </Box>
    );
  }
  const cat = spec.categories?.length && spec.values?.length;
  if (cat) {
    const data = (spec.categories ?? []).map((name, i) => ({ name, value: spec.values?.[i] ?? 0 }));
    if (spec.kind !== "vbar" && spec.kind !== "gbar") {
      // hbar (and the honest fallback for any unknown categorical shape):
      // magnitude bars inked by sign, value on hover
      return (
        <Box data-testid="report-chart" data-kind={spec.kind} my={4}>
          {title && <Text fontWeight="light" mb={2}>{title}</Text>}
          <ResponsiveContainer width="100%" height={Math.max(180, data.length * 44 + 40)}>
            <BarChart layout="vertical" data={data} margin={{ left: 8, right: 24 }}>
              <XAxis type="number" hide />
              <YAxis type="category" dataKey="name" width={150} tick={{ fontSize: 12 }} />
              <Tooltip />
              <Bar dataKey="value">
                {data.map((d, i) => <Cell key={i} fill={d.value < 0 ? "#c05050" : "#3182ce"} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Box>
      );
    }
    return (
      <Box data-testid="report-chart" data-kind={spec.kind} my={4}>
        {title && <Text fontWeight="light" mb={2}>{title}</Text>}
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={data}>
            <XAxis dataKey="name" />
            <YAxis />
            <Tooltip />
            <Bar dataKey="value" fill="#3182ce" />
          </BarChart>
        </ResponsiveContainer>
      </Box>
    );
  }
  // Grid specs (table/matrix) without a stored SVG render as a plain HTML
  // table — the honest fallback for legacy documents.
  if (spec.columns?.length && spec.rows?.length) {
    return (
      <Box data-testid="report-chart" data-kind={spec.kind} my={4} overflowX="auto">
        {title && <Text fontWeight="light" mb={2}>{title}</Text>}
        <Table>
          <TableHeader>
            <TableRow>{spec.columns.map((c) => <TableHead key={c}>{c}</TableHead>)}</TableRow>
          </TableHeader>
          <TableBody>
            {spec.rows.map((row, ri) => (
              <TableRow key={ri}>
                {row.map((cell, ci) => (
                  <TableCell key={ci}>{typeof cell === "object" ? cell.text : String(cell ?? "")}</TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Box>
    );
  }
  if (spec.kind === "area") {
    return <SeriesRechartsBlock spec={spec} title={title} />;
  }
  return (
    <Box data-testid="report-chart" data-kind={spec.kind} my={4}>
      <MarketChart data={rows} variant="line" title={title} />
    </Box>
  );
}

function HighlightParts({ text, highlights, footnotes }: { text: string; highlights: Highlight[]; footnotes?: string[] }) {
  const note = (id?: string) => {
    if (!id || !footnotes) return null;
    const n = footnotes.indexOf(id) + 1;
    return n > 0 ? <sup className="fn">{n}</sup> : null;
  };
  return (
    <>
      {splitHighlights(text, highlights).map((part, i) =>
        part.kind ? (
          <React.Fragment key={i}>
            <Text
              as="mark"
              data-testid="report-highlight"
              data-kind={part.kind}
              bg="transparent"
              fontWeight="light"
              color={HIGHLIGHT_COLOR[part.kind]}
            >
              {part.text}
            </Text>
            {note(part.sourceId)}
          </React.Fragment>
        ) : (
          <React.Fragment key={i}>{part.text}</React.Fragment>
        ),
      )}
    </>
  );
}

function ParagraphBlock({ section, footnotes }: { section: Extract<Section, { type: "paragraph" }>; footnotes?: string[] }) {
  // level 1 = the claim/lead (primary ink), level 2 = the supporting detail
  // (secondary body colour). v1 docs carry no level → detail styling.
  if (!section.highlights?.length) {
    return (
      <Box data-testid="report-paragraph" data-level={section.level} my={3}>
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{section.text}</ReactMarkdown>
      </Box>
    );
  }
  return (
    <Text as="p" data-testid="report-paragraph" data-level={section.level} my={3} lineHeight="tall">
      <HighlightParts text={section.text} highlights={section.highlights} footnotes={footnotes} />
    </Text>
  );
}

/** Source line beneath a figure (chart/diagram/table/compare) — required on every v2 figure. */
function SourceNote({ sourceId, sources }: { sourceId?: string; sources: Source[] }) {
  if (!sourceId) return null;
  const src = sources.find((s) => s.id === sourceId);
  if (!src) return null;
  return (
    <Text data-testid="report-source" fontSize="sm" color="fg.muted" mt={1}>
      Source:{" "}
      {src.url ? (
        <a href={src.url} target="_blank" rel="noreferrer">
          {src.label}
        </a>
      ) : (
        src.label
      )}
    </Text>
  );
}

/** Fig. N frame around the assembly's stored SVG: title states the finding,
 * measure + how-to-read + source + SVG/CSV/PNG downloads (skill rule 7).
 * `interactive` swaps the body for the live MarketChart (hover x+y readout);
 * the stored svg still powers the SVG/PNG downloads. */
function FigureBlock({
  section,
  sources,
  figN,
}: {
  section: Extract<Section, { type: "chart" }>;
  sources: Source[];
  figN?: number;
}) {
  const svgs = section.svgs ?? [];
  const src = section.sourceId ? sources.find((s) => s.id === section.sourceId) : undefined;
  const name = `fig${figN}-${section.title ?? "figure"}`;
  return (
    <Box data-testid="report-figure" data-fig={figN} className="fig-frame">
      <Flex className="fig-head">
        {figN != null && <Text as="span" className="fig-n">Fig. {figN}</Text>}
        <Text className="fig-title">{section.title}</Text>
        {section.measure && <Text className="fig-measure">{section.measure}</Text>}
      </Flex>
      {svgs.map((svg, i) => (
        <Box key={i} className="fig-body" dangerouslySetInnerHTML={{ __html: svg }} />
      ))}
      {section.caption && <Text className="fig-cap">{section.caption}</Text>}
      <Flex className="fig-foot">
        {src ? (
          <a href={src.url || undefined} target="_blank" rel="noreferrer">
            Source: {src.label}
          </a>
        ) : (
          <span>No source attached</span>
        )}
        <span className="fig-exports">
          <button type="button" onClick={() => downloadSvg(svgs[0], name)}>SVG</button>
          <button type="button" onClick={() => downloadCsv(section.spec, name)}>CSV</button>
          <button type="button" onClick={() => downloadPng(svgs[0], name)}>PNG</button>
        </span>
      </Flex>
    </Box>
  );
}

/** Card kinds (kpi-card / stat-spark) → KPI card: own title + coloured
 *  tagline over the card SVG, never a Fig. N plot frame. stat-spark panels
 *  lay out as one card row. */
function CardBlock({ section, sources }: { section: Extract<Section, { type: "chart" }>; sources: Source[] }) {
  const svgs = section.svgs ?? [];
  const src = section.sourceId ? sources.find((s) => s.id === section.sourceId) : undefined;
  const row = section.spec.kind === "stat-spark" && svgs.length > 1;
  return (
    <Box data-testid="report-stat" className="stat-card">
      {section.title && <Text className="stat-title">{section.title}</Text>}
      {section.tagline && <Text className="sec-tagline">{section.tagline}</Text>}
      {svgs.length ? (
        <Flex className={row ? "card-row" : undefined} gap={row ? 3 : 0} wrap={row ? "wrap" : undefined}>
          {svgs.map((svg, i) => <Box key={i} className="fig-body" dangerouslySetInnerHTML={{ __html: svg }} />)}
        </Flex>
      ) : (
        <ChartBlock spec={section.spec} title={undefined} />
      )}
      {section.caption && <Text className="fig-cap">{section.caption}</Text>}
      <Flex className="fig-foot">
        {src ? (
          <a href={src.url || undefined} target="_blank" rel="noreferrer">
            Source: {src.label}
          </a>
        ) : (
          <span>No source attached</span>
        )}
      </Flex>
    </Box>
  );
}

function SectionView({
  section,
  sources,
  figN,
  footnotes,
}: {
  section: Section;
  sources: Source[];
  figN?: number;
  footnotes?: string[];
}) {
  switch (section.type) {
    case "heading":
      return (
        <Box data-testid="report-heading" data-level={section.level} mt={10} mb={4}>
          <Text
            as={`h${section.level + 1}` as "h2" | "h3" | "h4"}
            fontSize="40px"
            mb={0}
          >
            {section.text}
          </Text>
          {section.tagline && (
            <Text className="sec-tagline" mt={1.5}>
              {section.tagline}
            </Text>
          )}
        </Box>
      );
    case "paragraph":
      return <ParagraphBlock section={section} footnotes={footnotes} />;
    case "callout": {
      // Verdict / Falsifiers etc. — plain Newsreader prose, no card. Colour
      // is a subtle role tint: slate for the key finding, muted amber for
      // warnings, plain ink otherwise.
      const ink =
        section.variant === "key"
          ? "color-mix(in srgb, var(--accent-primary) 50%, var(--ink-primary))"
          : section.variant === "warn"
            ? "color-mix(in srgb, var(--signal-caution) 55%, var(--ink-primary))"
            : "var(--ink-secondary)";
      return (
        <Box data-testid="report-callout" data-variant={section.variant} my={4}>
          {section.title && (
            <Text
              fontSize="11px"
              letterSpacing="0.1em"
              textTransform="uppercase"
              color="var(--ink-tertiary)"
              mb={1}
            >
              {section.title}
            </Text>
          )}
          <Text fontFamily="var(--font-display)" fontWeight={300} fontSize={{ base: "20px", md: "26px" }} lineHeight="1.5" color={ink}>
            {section.highlights?.length ? (
              <HighlightParts text={section.text} highlights={section.highlights} footnotes={footnotes} />
            ) : (
              section.text
            )}
          </Text>
        </Box>
      );
    }
    case "table":
      return (
        <Box data-testid="report-table" my={4} overflowX="auto">
          {section.title && <Text fontWeight="light" mb={2}>{section.title}</Text>}
          <Table>
            <TableHeader>
              <TableRow>
                {section.columns.map((c) => (
                  <TableHead key={c}>{c}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {section.rows.map((row, ri) => (
                <TableRow key={ri}>
              {row.map((cell, ci) =>
                ci === 0 ? (
                  // row header (skill table rule): first column is a <th scope>
                  <th
                    key={ci}
                    scope="row"
                    data-testid="report-table-cell"
                    className="px-3 py-2.5 align-middle font-medium text-left"
                  >
                    {cell}
                  </th>
                ) : (
                  <TableCell key={ci} data-testid="report-table-cell">
                    {cell}
                  </TableCell>
                ),
              )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {section.caption && <Text fontSize="sm" color="fg.muted" mt={1}>{section.caption}</Text>}
          <SourceNote sourceId={section.sourceId} sources={sources} />
        </Box>
      );
    case "chart": {
      // Cards (kpi-card / stat-spark) render as KPI cards, not Fig. plot frames.
      const k = section.spec.kind;
      if (k === "kpi-card" || k === "stat-spark")
        return <CardBlock section={section} sources={sources} />;
      // Stored SVGs carry the Almanac design AND the hover layer (CSS baked
      // into the SVG: crosshair readouts, bar values) — prefer them whenever
      // assembly produced them. ChartBlock (live recharts / MarketChart) is
      // the fallback for missing SVGs.
      if (!section.svgs?.length) {
        return (
          <Box my={4}>
            <ChartBlock spec={section.spec} title={section.title} />
            {section.panels?.map((p, i) => <ChartBlock key={i} spec={p} title={section.title} />)}
            {section.caption && <Text fontSize="sm" color="fg.muted">{section.caption}</Text>}
            <SourceNote sourceId={section.sourceId} sources={sources} />
          </Box>
        );
      }
      return <FigureBlock section={section} sources={sources} figN={figN} />;
    }
    case "diagram":
      return (
        <Box my={4}>
          <DiagramBlock spec={section.spec} title={section.title} />
          {(section as any).caption && <Text fontSize="sm" color="fg.muted">{(section as any).caption}</Text>}
          <SourceNote sourceId={(section as any).sourceId} sources={sources} />
        </Box>
      );
    case "badges":
      return (
        <Flex data-testid="report-badges" gap={2} flexWrap="wrap" my={2}>
          {section.items.map((b, i) => (
            <Text key={i} as="span" className="chip" data-tone={b.tone ?? "neutral"}>
              {b.label}
            </Text>
          ))}
        </Flex>
      );
    case "compare":
      return (
        <Box data-testid="report-compare" my={4}>
          {section.title && <Text fontWeight="light" mb={2}>{section.title}</Text>}
          <Flex gap={4} direction={{ base: "column", md: "row" }}>
            <Box flex={1}>
              {isChart(section.before) ? <ChartBlock spec={section.before} title="Before" /> : <DiagramBlock spec={section.before} title="Before" />}
            </Box>
            <Box flex={1}>
              {isChart(section.after) ? <ChartBlock spec={section.after} title="After" /> : <DiagramBlock spec={section.after} title="After" />}
            </Box>
          </Flex>
          <SourceNote sourceId={(section as any).sourceId} sources={sources} />
        </Box>
      );
    case "metrics":
      // Ledger stats: tiny letterspaced labels over huge thin numerals (rule 2)
      return (
        <Box data-testid="report-metrics" className="ledger">
          {section.items.map((m, i) => (
            <Box key={i} className="cell">
              <Text className="lab">{m.label}</Text>
              <Text className="num" data-tone={m.tone ?? "neutral"}>{m.value}</Text>
              {m.delta && <Text className="delta">{m.delta}</Text>}
            </Box>
          ))}
        </Box>
      );
    case "code":
      return (
        <Box data-testid="report-code" as="pre" fontFamily="mono" fontSize="sm" bg="bg.subtle" p={3} borderRadius="md" my={3} overflowX="auto" whiteSpace="pre-wrap">
          {section.text}
        </Box>
      );
    case "quote":
      return (
        <Box data-testid="report-quote" borderLeftWidth="4px" borderColor="gray.300" pl={3} my={3}>
          <Text fontStyle="italic">
            “{section.text}”
            {section.sourceId && footnotes && footnotes.includes(section.sourceId) && (
              <sup className="fn">{footnotes.indexOf(section.sourceId) + 1}</sup>
            )}
          </Text>
          {section.attribution && <Text fontSize="sm" color="fg.muted">— {section.attribution}</Text>}
        </Box>
      );
    case "citations": {
      // Legacy: refs are source ids (order from doc.footnotes, resolved via the
      // registry). Current: refs are the agent-written { source, url } pairs.
      // The cast widens the flat-Section string[] — v2 blocks flow through
      // flattenSections and may carry objects.
      const ordered = (footnotes ?? section.refs) as (string | { source: string; url?: string })[];
      type CitationNote = { key: string; src: { label: string; url?: string; value?: string } };
      const notes = ordered
        .map((r): CitationNote | null => {
          if (typeof r !== "string") return { key: r.source, src: { label: r.source, url: r.url, value: "" } };
          const src = sources.find((s) => s.id === r);
          return src ? { key: r, src } : null;
        })
        .filter((n): n is CitationNote => !!n);
      if (!notes.length) return null;
      return (
        <Box data-testid="report-footnotes" className="footnotes">
          {notes.map((n, i) => (
            <Box key={n.key} data-testid="report-footnote" data-source-id={n.key} className="fn">
              <sup>{i + 1}</sup>
              <span>
                {n.src.url ? (
                  <a href={n.src.url} target="_blank" rel="noreferrer">
                    {n.src.label}
                  </a>
                ) : (
                  n.src.label
                )}
                {n.src.value ? ` — ${n.src.value}` : ""}
              </span>
            </Box>
          ))}
        </Box>
      );
    }
  }
}

/** v2 nested sections → the flat block list SectionView already renders.
 *  text becomes a paragraph carrying its level (1 = claim/lead, 2 = detail);
 *  the section heading becomes a heading block; figure blocks pass through. */
function flattenSections(doc: ReportDocument): Section[] {
  if (!isV2(doc)) return doc.sections as Section[];
  return (doc.sections as ReportSection[]).flatMap((sec): Section[] => [
    { type: "heading", ...sec.heading },
    ...sec.blocks.map((b): Section => (b.type === "text" ? { type: "paragraph", text: b.text, highlights: b.highlights, level: b.level } : (b as Section))),
  ]);
}

export function ReportDocumentRenderer({ document }: { document: ReportDocument | null | undefined }) {
  // Harness runs may render this before a document exists (running/failed
  // with no flushed doc) — one guard here covers every caller.
  if (!document) return null;
  const sections = flattenSections(document);
  // Fig. N sequence: charts numbered in document order (shared with the md dump)
  let figSeq = 0;
  const figOf = new Map<number, number>();
  sections.forEach((s, i) => {
    // stat cards are not plots — they never take a Fig. N number
    if (s.type === "chart" && s.spec.kind !== "kpi-card" && s.spec.kind !== "stat-spark") figOf.set(i, ++figSeq);
  });
  return (
    <Box data-testid="report-document" data-symbol={document.symbol} className="almanac-report dom-economy">
      {document.title && (
        <Text as="h1" fontSize="48px">
          {document.title}
        </Text>
      )}
      {document.subtitle && (
        <Text color="fg.muted" mb={2}>
          {document.subtitle}
        </Text>
      )}
      {(document.generatedAt) && (
        <Flex gap={4} fontSize="sm" color="fg.muted" mb={4}>
          <Text>{document.generatedAt}</Text>
        </Flex>
      )}
      {sections.map((section, i) => (
        <SectionView key={i} section={section} sources={document.sources} figN={figOf.get(i)} footnotes={document.footnotes} />
      ))}
      {/* v2: footnotes print from doc.footnotes even without a citations block */}
      {isV2(document) && document.footnotes?.length && !sections.some((s) => s.type === "citations") ? (
        <Box data-testid="report-footnotes" className="footnotes">
          {document.footnotes.map((id, i) => {
            const src = document.sources.find((s) => s.id === id);
            if (!src) return null;
            return (
              <Box key={id} data-testid="report-footnote" data-source-id={id} className="fn">
                <sup>{i + 1}</sup>
                <span>
                  {src.url ? (
                    <a href={src.url} target="_blank" rel="noreferrer">
                      {src.label}
                    </a>
                  ) : (
                    src.label
                  )}
                  {src.value ? ` — ${src.value}` : ""}
                </span>
              </Box>
            );
          })}
        </Box>
      ) : null}
      {document.artifacts?.length ? (
        <Box data-testid="report-artifacts" mt={6} pt={3} borderTopWidth="1px" borderColor="border">
          <Text fontSize="sm" fontWeight="light" mb={1}>Attachments</Text>
          <Flex gap={3} flexWrap="wrap">
            {document.artifacts.map((a) => (
              <a key={a.id} href={a.url} download={a.label} className="text-sm text-blue-500">
                {a.label} ({a.kind})
              </a>
            ))}
          </Flex>
        </Box>
      ) : null}
    </Box>
  );
}
