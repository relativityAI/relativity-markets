/**
 * Legacy report block shapes — the pre-report.v2 zod schema used by runs
 * persisted before the ReportDocument contract. Kept ONLY so the PDF export
 * of old runs keeps working; new runs always render ReportDocument.
 */
import { z } from "zod";

export const ReportBlockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("heading"), level: z.union([z.literal(2), z.literal(3)]), text: z.string(), tagline: z.string().optional() }),
  z.object({ type: z.literal("paragraph"), text: z.string(), citedKeys: z.array(z.string()).optional() }),
  z.object({ type: z.literal("table"), title: z.string().optional(), columns: z.array(z.string()), rows: z.array(z.array(z.union([z.string(), z.number()]))), sourceKeys: z.array(z.string()) }),
  z.object({ type: z.literal("chart"), chartType: z.enum(["bar", "line", "radar", "area", "scatter", "pie", "candlestick"]), title: z.string().optional(), data: z.array(z.record(z.string(), z.union([z.string(), z.number()]))), sourceKeys: z.array(z.string()) }),
  z.object({ type: z.literal("callout"), tone: z.enum(["positive", "caution", "negative", "neutral"]), text: z.string() }),
  z.object({ type: z.literal("quote"), text: z.string(), attribution: z.string().optional() }),
]);

export type ReportBlock = z.infer<typeof ReportBlockSchema>;

export const AnalysisReportSchema = z.object({
  heroPct: z.number(),
  heroLabel: z.string(),
  blocks: z.array(ReportBlockSchema),
  partial: z.boolean(),
  /** "llm" = narrative synthesized by the model, "fallback" = deterministic assembly from scored data. */
  source: z.enum(["llm", "fallback"]).default("llm"),
  layoutSections: z.array(z.any()).optional(),
});

export type AnalysisReport = z.infer<typeof AnalysisReportSchema>;
