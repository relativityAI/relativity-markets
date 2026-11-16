/**
 * dumpMarkdown — raw markdown dump of the ReportDocument (the .md artifact
 * the run writes). Lives outside cli.ts so it stays importable in tests
 * (cli.ts self-executes main()).
 *
 * v2: each section prints its heading, then its blocks in order. Figures
 * render as the assembly's stored SVG (standalone via var() fallbacks) with
 * Fig. N, measure, how-to-read, a linked source and a CSV data block — the
 * figure leaves the file whole (skill rule 7). Every figure block prints its
 * Source line beneath it.
 */
import { figureCsv, renderFigure } from "./report/figure-kit.js";
import { type Block, type ReportDocument, type Section } from "./report/document.js";

export function dumpMarkdown(doc: ReportDocument): string {
  const lines: string[] = [];
  if (doc.title) lines.push(`# ${doc.title}`);
  if (doc.subtitle) lines.push(doc.subtitle);
  if (doc.generatedAt) lines.push(`${doc.symbol} · ${doc.generatedAt}`, "");
  else if (doc.title || doc.subtitle) lines.push("");
  const specLine = (s: { kind: string; data?: string; series?: unknown[]; categories?: unknown[] }) =>
    `${s.kind}${s.data ? ` data=${s.data}` : ""}` +
    (s.series?.length ? ` · ${s.series.length} series` : "") +
    (s.categories?.length ? ` · ${s.categories.length} cats` : "");
  const sourceLine = (sourceId?: string) => {
    const src = sourceId ? doc.sources.find((x) => x.id === sourceId) : undefined;
    return src ? `Source: ${src.url ? `[${src.label}](${src.url})` : src.label}` : "";
  };
  let figN = 0;
  for (const sec of doc.sections as Section[]) {
    lines.push(`${"#".repeat(sec.heading.level + 1)} ${sec.heading.text}`, sec.heading.tagline ? `${sec.heading.tagline}` : "");
    for (const s of sec.blocks as Block[]) {
      switch (s.type) {
        case "text":
          lines.push(s.text, "");
          break;
        case "callout":
          lines.push(`> [${s.variant}]${s.title ? ` ${s.title}:` : ""} ${s.text}`, "");
          break;
        case "chart": {
          const isCard = s.spec.kind === "kpi-card" || s.spec.kind === "stat-spark";
          if (!isCard) figN++;
          if (isCard) {
            // KPI cards: title + tagline, no Fig. N
            lines.push(`**${s.title ?? "(card)"}**${s.tagline ? ` — *${s.tagline}*` : ""}`, "");
          } else lines.push(`**Fig. ${figN} — ${s.title ?? "(untitled chart)"}**${s.measure ? ` *(${s.measure})*` : ""}`, "");
          if (s.svgs?.length) {
            lines.push(s.svgs.join("\n"), "");
          } else {
            // no stored svg (candle — the UI keeps its live chart — or an
            // unresolved token): render statically when we honestly can
            const specs = s.panels?.length ? s.panels : [s.spec];
            const rendered = specs.map((sp) => renderFigure(sp, { label: s.title, unit: s.measure, ink: s.color }));
            if (rendered.every((x): x is string => x != null)) {
              lines.push(rendered.join("\n"), "");
            } else {
              lines.push(`[chart] ${s.title ?? "(untitled)"} — ${specs.map(specLine).join(" + ")}`, "");
            }
          }
          if (s.caption) lines.push(`How to read: ${s.caption}`, "");
          const src = sourceLine(s.sourceId);
          if (src) lines.push(src, "");
          const csv = figureCsv(s.spec);
          if (csv) lines.push("<details><summary>Data</summary>", "", "```csv", csv, "```", "", "</details>", "");
          break;
        }
        case "diagram":
          lines.push(`[diagram] ${s.title ?? "(untitled)"} — mermaid`, "```mermaid", s.spec.code, "```", "");
          if (s.caption) lines.push(`How to read: ${s.caption}`);
          {
            const src = sourceLine(s.sourceId);
            if (src) lines.push(src);
          }
          lines.push("");
          break;
        case "compare": {
          const before = "kind" in s.before ? specLine(s.before) : "diagram";
          const after = "kind" in s.after ? specLine(s.after) : "diagram";
          lines.push(`[compare] ${s.title ?? "(untitled)"} — ${before} → ${after}`, "");
          const src = sourceLine(s.sourceId);
          if (src) lines.push(src, "");
          break;
        }
        case "metrics":
          lines.push(`| ${s.items.map((m) => m.label).join(" | ")} |`);
          lines.push(`| ${s.items.map(() => "---").join(" | ")} |`);
          lines.push(`| ${s.items.map((m) => `${m.value}${m.delta ? ` (${m.delta})` : ""}`).join(" | ")} |`, "");
          break;
        case "citations": {
          // refs: legacy string ids resolve via the sources registry; current
          // docs carry the agent-written { source, url } directly.
          const notes: { label: string; url?: string; value: string }[] = [];
          for (const r of s.refs) {
            if (typeof r === "string") {
              const src = doc.sources.find((x) => x.id === r);
              if (src) notes.push(src);
            } else notes.push({ label: r.source, url: r.url, value: "" });
          }
          if (!notes.length) break;
          lines.push("**Sources**", "");
          notes.forEach((src, i) => {
            lines.push(`${i + 1}. ${src.url ? `[${src.label}](${src.url})` : src.label}${src.value ? ` — ${src.value}` : ""}`, "");
          });
          break;
        }
        case "code":
          lines.push("```" + (s.language ?? ""), s.text, "```", "");
          break;
        default:
          lines.push(JSON.stringify(s), "");
      }
    }
  }
  return lines.join("\n").trimEnd();
}
