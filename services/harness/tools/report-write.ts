/**
 * report_write — the agent's only way onto the report canvas.
 *
 * One call appends one section-group: schema-graded Sections plus the Sources
 * they cite. Invalid blocks are rejected per-section (valid ones still land),
 * so one malformed block never costs the rest of the write. A deepagents
 * `tool()` — plain tool-calling, works on any gateway (the opencode-compatible
 * one rejects response_format, so structured output is not an option here).
 */
import { tool } from "langchain";
import { z } from "zod";
import type { StructuredTool } from "@langchain/core/tools";
import { validateComposed, type ReportCanvas } from "../report/canvas.js";

export function reportWriteTool(o: { canvas: ReportCanvas; notify?: () => void }): StructuredTool {
  return tool(
    async ({ title, sections }) => {
      const v = validateComposed({ sections });
      if (!v.sections.length) {
        return {
          error: `no valid sections (${v.invalid.join(" | ") || "empty sections array"})`,
          rejected: v.invalid,
        };
      }
      o.canvas.appendSections(title, v.sections);
      o.notify?.();
      return {
        added: v.sections.length,
        rejected: v.invalid,
        totalSections: o.canvas.sectionCount(),
      };
    },
    {
      name: "report_write",
      description:
        "Write one section-group of the report onto the report canvas. Each section is a COMPLETE unit: { heading: {level,text}, blocks: [...] } — one heading, then any mix of text/figure blocks (see the full-section contract). Call repeatedly; each call appends. The final document is compiled from every call. The active skill's Report structure (BINDING) governs what you write — its section list, summary box, sentence-length and table rules — not a generic format.",
      schema: z.object({
        title: z.string().describe("Short section-group label (2–5 words), e.g. 'What's new' — a label only, not a heading"),
        sections: z.array(z.any()).min(1).describe("Full sections — each { heading: {level, text}, blocks: [...] } per the output-format contract"),
        sources: z.array(z.any()).optional().describe("Deprecated — ignored. Cite sources in the section's citations block instead: refs of { source, url }."),
      }),
    },
  );
}
