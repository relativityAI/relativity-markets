/**
 * report_write — the agent's only way onto the report canvas.
 *
 * One call appends one section-group: schema-graded Sections. Invalid blocks
 * are rejected per-section (valid ones still land), so one malformed block
 * never costs the rest of the write. Citations are enforced HERE, where the
 * evidence is still fresh: refs are validated against the run's verified
 * source ledger, and a section that lands without a citations block gets one
 * backfilled from the sources gathered so far — every section ships a
 * per-section source list, never empty. A deepagents `tool()` — plain
 * tool-calling, works on any gateway (the opencode-compatible one rejects
 * response_format, so structured output is not an option here).
 */
import { tool } from "langchain";
import { z } from "zod";
import type { StructuredTool } from "@langchain/core/tools";
import { validateComposed, type ReportCanvas } from "../report/canvas.js";
import { resolveRefs } from "../report/sources.js";
import type { Source } from "../report/document.js";

/** Backfill cap: the freshest sources at write time are the likeliest relevant. */
const BACKFILL = 8;

export function reportWriteTool(o: {
  canvas: ReportCanvas;
  notify?: () => void;
  /** Verified source ledger so far — live, mined from the running trace. */
  sources?: () => Source[];
}): StructuredTool {
  return tool(
    async ({ title, sections }) => {
      const v = validateComposed({ sections });
      if (!v.sections.length) {
        return {
          error: `no valid sections (${v.invalid.join(" | ") || "empty sections array"})`,
          rejected: v.invalid,
        };
      }
      const ledger = o.sources?.() ?? o.canvas.sources();
      let dropped = 0;
      for (const s of v.sections) {
        const cites = s.blocks.find((b) => b.type === "citations");
        if (cites?.type === "citations") {
          const before = cites.refs.length;
          cites.refs = resolveRefs(cites.refs, ledger);
          dropped += before - cites.refs.length;
        } else if (ledger.length) {
          // No citations block — attach the verified sources gathered so far.
          s.blocks.push({
            type: "citations",
            refs: ledger.slice(-BACKFILL).map((src) => ({ source: src.label, url: src.url })),
          });
        }
      }
      o.canvas.appendSections(title, v.sections);
      o.notify?.();
      return {
        added: v.sections.length,
        rejected: v.invalid,
        totalSections: o.canvas.sectionCount(),
        ...(dropped
          ? { droppedRefs: `${dropped} citation link(s) were dropped — only URLs from your own tool results survive. Cite sources exactly as the tool returned them.` }
          : {}),
      };
    },
    {
      name: "report_write",
      description:
        "Write one section-group of the report onto the report canvas. Each section is a COMPLETE unit: { heading: {level,text}, blocks: [...] } — one heading, then any mix of text/figure blocks (see the full-section contract), ending with a citations block. Call repeatedly; each call appends. The final document is compiled from every call. The active skill's Report structure (BINDING) governs what you write — its section list, summary box, sentence-length and table rules — not a generic format.",
      schema: z.object({
        title: z.string().describe("Short section-group label (2–5 words), e.g. 'What's new' — a label only, not a heading"),
        sections: z.array(z.any()).min(1).describe("Full sections — each { heading: {level, text}, blocks: [...] } per the output-format contract"),
        sources: z.array(z.any()).optional().describe("Deprecated — ignored. Cite sources in the section's citations block instead: refs of { source, url } copied from your tool results."),
      }),
    },
  );
}
