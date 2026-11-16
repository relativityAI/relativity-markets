/**
 * Report quality verdict — ONE call after the stitch.
 *
 * Plain text completion + extractJson, NOT structured output: the
 * opencode-compatible gateway rejects response_format/json_schema
 * ("responseFormat is not supported"), so structured mode silently returns
 * prose and parsing fails. extractJson (fence-aware, jsonrepair) is the parse
 * this codebase already trusts; zod picks the band. A failed call yields
 * null — never a fabricated grade — and never touches the report. Outside
 * the loop: zero steps, zero budget tokens.
 */
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { z } from "zod";
import { dumpMarkdown } from "../dump.js";
import { extractJson } from "./builder.js";
import type { ReportDocument } from "./document.js";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

/** Grading input: the report as markdown, SVGs collapsed, capped at 14k. */
export function reportDigest(document: ReportDocument): string {
  return dumpMarkdown(document).replace(/<svg[\s\S]*?<\/svg>/g, "[chart]").slice(0, 14_000);
}

export const VERDICTS = ["Very Poor", "Poor", "Fair", "Good", "Excellent"] as const;
export type Verdict = (typeof VERDICTS)[number];

const VerdictSchema = z.object({ verdict: z.enum(VERDICTS) });

const SYSTEM =
  "You grade REPORT QUALITY on one fixed scale: Very Poor, Poor, Fair, Good, Excellent.\n" +
  "Judge the artifact only — completeness against its stated structure, cited evidence behind claims, " +
  "figures carrying measure and source, number discipline, coherence and editing. " +
  "Do NOT judge the investment conclusion or the direction of the call.\n" +
  'Reply with ONE JSON object and nothing else: {"verdict":"<one of the five bands>"}';

export async function gradeReport(o: {
  /** Digest of the final document (dumpMarkdown with SVGs stripped). */
  text: string;
  model: BaseChatModel;
  abortSignal?: AbortSignal;
}): Promise<Verdict | null> {
  if (o.abortSignal?.aborted) return null;
  try {
    const model = o.model;
    const r = await model.invoke([new SystemMessage(SYSTEM), new HumanMessage(o.text)], {
      // ponytail: maxTokens isn't in the BaseChatModelCallOptions type but every
      // chat model honors it; the cast keeps the grading cap without threading
      // another buildModel parameter.
      maxTokens: 2_000,
      ...(o.abortSignal ? { signal: o.abortSignal } : {}),
    } as any);
    const parsed = VerdictSchema.safeParse(extractJson(typeof r.content === "string" ? r.content : ""));
    if (!parsed.success) return null;
    return parsed.data.verdict;
  } catch (e: any) {
    console.warn(`[verdict] grading failed — ${String(e?.message || e).slice(0, 200)}`);
    return null;
  }
}
