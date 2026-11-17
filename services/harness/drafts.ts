/**
 * One-shot LLM features — the conversational agent builder, the document
 * signal extractor, the parameter drafter, and the skill author. All plain
 * tool-calling turns on langchain's createAgent (no filesystem, no todos, no
 * subagents — deepagents is for analysis runs, these are chat turns).
 */

import { createAgent } from "langchain";
import { HumanMessage, SystemMessage, AIMessage } from "@langchain/core/messages";
import type { StructuredTool } from "@langchain/core/tools";
import { buildModel, type LlmKeys } from "./model.js";
import type { MetricDef } from "../api/metrics.js";
import { normalizeQuantRules } from "../api/metrics.js";
import { buildAgentBuilderSystemPrompt, buildBuilderRecoveryPrompt, buildDocumentExtractionPrompt, buildDraftParametersPrompt } from "./agentPrompts.js";
import { webSearchTool } from "./tools/websearch.js";
import { getToolCatalog } from "./tools/catalog.js";
import { insertBuilderSessionTurn } from "../db/repo.js";
import { classifyModelError } from "../api/modelcheck.js";
import { keyPool } from "../api/keypool.js";
import { listAllSkillsForUser, loadBuiltinSkills, parseSkillMarkdown } from "./skills.js";
import type { TraceEvent } from "./types.js";
import { TraceMapper } from "./trace.js";

// Pull web_search results into readable "query → title → url" entries.
function searchResultsFromTrace(events: TraceEvent[]): { query: string; title: string; url: string }[] {
  const out: { query: string; title: string; url: string }[] = [];
  const seen = new Set<string>();
  for (const ev of events) {
    if (ev.type !== "tool_result" || ev.tool !== "web_search") continue;
    const args = (ev as any).args as { query?: string } | undefined;
    for (const r of ((ev.result as any)?.results ?? []) as any[]) {
      if (!r?.url || seen.has(r.url)) continue;
      seen.add(r.url);
      let fallback = r.url;
      try {
        fallback = new URL(r.url).hostname.replace(/^www\./, "");
      } catch {}
      out.push({ query: args?.query || "", title: r.title || fallback, url: r.url });
    }
  }
  return out;
}

// "query → N results → domains" source lines for the UI.
function sourcesFromResults(results: { query: string; url: string }[]): string[] {
  const byQuery = new Map<string, string[]>();
  for (const r of results) {
    let host = r.url;
    try {
      host = new URL(r.url).hostname.replace(/^www\./, "");
    } catch {}
    const list = byQuery.get(r.query) ?? [];
    if (!list.includes(host)) list.push(host);
    byQuery.set(r.query, list);
  }
  return [...byQuery.entries()].map(([q, hosts]) => `${q} → ${hosts.length} results → ${hosts.join(", ")}`);
}

// Pull and parse the first balanced {...} JSON object out of arbitrary model text.
export function parseJsonObject(text: string): any | null {
  if (!text) return null;
  const cleaned = text.replace(/```json\s*/gi, "").replace(/```\s*/g, "");
  const start = cleaned.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (escaped) {
      escaped = false;
    } else if (ch === "\\") {
      escaped = true;
    } else if (inString) {
      if (ch === '"') inString = false;
    } else if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(cleaned.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/** Text of the last non-empty AIMessage in a run's final state. */
function lastText(messages: unknown[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m instanceof AIMessage && typeof m.content === "string" && m.content.trim()) return m.content;
  }
  return "";
}

/**
 * Map display-name-only skill references back to catalog ids and clamp values.
 * A model that writes prose instead of ids still attaches the right skills
 * instead of having them silently dropped.
 */
function normalizeDraft(
  update: Record<string, unknown> | undefined,
  catalog?: { id: string; name: string }[],
): Record<string, unknown> | undefined {
  if (!update) return update;
  const next: Record<string, unknown> = { ...update };

  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const byIdOrName = new Map<string, { id: string; name: string }>();
  for (const s of catalog || []) {
    byIdOrName.set(norm(s.id), s);
    byIdOrName.set(norm(s.name), s);
  }
  const resolveSkill = (raw: string): { id: string; name: string } | null => {
    const n = norm(raw);
    if (!n) return null;
    const exact = byIdOrName.get(n);
    if (exact) return exact;
    for (const s of byIdOrName.values()) {
      if (n.includes(norm(s.id)) || n.includes(norm(s.name)) || norm(s.name).includes(n)) return s;
    }
    return null;
  };

  const phil = (next.philosophy as string) || (next.persona as any)?.philosophy || (next.persona as any)?.philosophy_and_mindset;
  if (phil) {
    next.philosophy = phil;
    next.persona = {
      ...(typeof next.persona === "object" && next.persona ? (next.persona as any) : {}),
      philosophy: phil,
    };
  }

  if (next.configuration && typeof next.configuration === "object") {
    const cfg = { ...(next.configuration as Record<string, unknown>) };
    if (typeof cfg.risk_appetite === "string") {
      const match = cfg.risk_appetite.match(/\d+/);
      if (match) cfg.risk_appetite = Number(match[0]);
    }
    const risk = Number(cfg.risk_appetite);
    if (Number.isFinite(risk)) cfg.risk_appetite = Math.min(10, Math.max(1, Math.round(risk)));
    next.configuration = cfg;
  }

  if (Array.isArray(next.skills)) {
    const seen = new Set<string>();
    const skills: { skill_id: string; weight: number }[] = [];
    for (const raw of next.skills as any[]) {
      const rawId = typeof raw?.skill_id === "string" ? raw.skill_id.trim() : "";
      if (!rawId) continue;
      const match = resolveSkill(rawId);
      if (!match) {
        console.warn(`[builder] dropped unresolvable skill "${rawId}" from draft (no catalog match)`);
        continue;
      }
      if (seen.has(match.id)) continue;
      seen.add(match.id);
      const w = Math.round(Number(raw?.weight));
      skills.push({ skill_id: match.id, weight: Number.isFinite(w) ? Math.min(10, Math.max(1, w)) : 5 });
    }
    if (skills.length) next.skills = skills;
    else delete next.skills;
  }

  delete next.asset_evaluation;
  delete next.macro_evaluation;
  delete next.style;

  return next;
}

export interface BuilderMessage {
  role: "assistant" | "user";
  content: string;
  options?: { id: string; label: string; description?: string }[];
}

export interface BuilderRequest {
  session_id?: string;
  user_id?: string;
  model_id: string;
  llm_keys: LlmKeys;
  messages: BuilderMessage[];
  agent_draft: Record<string, unknown>;
  metrics: MetricDef[];
  document_texts: { filename: string; text: string }[];
  user_response?: string;
  skill_catalog?: { id: string; name: string; description: string; category: string }[];
}

export interface BuilderResponse {
  message: string;
  options?: { id: string; label: string; description?: string }[];
  agent_draft_update?: Record<string, unknown>;
  thinking?: string;
  sources?: string[];
  search_results?: { query: string; title: string; url: string }[];
  annotations?: { what: string; basis: string }[];
  trace?: TraceEvent[];
}

/** Audit trail persistence for builder session turns */
async function persistBuilderSessionTurn(req: BuilderRequest, res: BuilderResponse): Promise<void> {
  if (!req.session_id || !req.user_id) return;
  try {
    insertBuilderSessionTurn(
      req.session_id,
      req.user_id,
      req.messages.length,
      req.user_response || "",
      res.agent_draft_update || req.agent_draft || {},
      res.annotations || [],
      res.sources || [],
    );
  } catch (e: any) {
    console.warn(`[builder] failed to persist session turn: ${e?.message}`);
  }
}

/** Process a builder conversation turn: conversation text + agent draft patches. */
export async function processBuilderTurn(
  req: BuilderRequest,
  opts: { onTrace?: (ev: TraceEvent) => void } = {},
): Promise<BuilderResponse> {
  const { apiKey, keyRef } = keyPool.pickKey(req.model_id, req.llm_keys as Record<string, string | undefined>);
  const provider = req.model_id.split("/")[0];
  const model = buildModel(req.model_id, req.llm_keys, apiKey);
  const toolCatalog = getToolCatalog();

  let catalog = req.skill_catalog;
  if (!catalog?.length) {
    try {
      const skills = req.user_id ? listAllSkillsForUser(req.user_id) : loadBuiltinSkills();
      catalog = skills.map((s) => ({ id: s.id, name: s.name, description: s.description, category: s.category }));
    } catch (e: any) {
      console.warn(`[builder] skill catalog unavailable: ${e?.message}`);
      catalog = [];
    }
  }

  const conversationHistory = req.messages
    .filter((m) => m.role === "assistant" || m.role === "user")
    .map((m) => `${m.role === "assistant" ? "Assistant" : "User"}: ${m.content}`)
    .join("\n\n");

  let docContext = "";
  if (req.document_texts.length > 0) {
    docContext =
      "\n\n## Uploaded Documents (extracted text only — you cannot read the original PDF/file)\n" +
      req.document_texts
        .map((d) => `### ${d.filename}\n${d.text.slice(0, 8000)}`)
        .join("\n\n");
  }

  let draftContext = "";
  if (req.agent_draft && Object.keys(req.agent_draft).length > 0) {
    draftContext = "\n\n## Current Agent Draft\n```json\n" + JSON.stringify(req.agent_draft, null, 2) + "\n```";
  }

  const userMessage = req.user_response ? `\n\n## User's Latest Response\n${req.user_response}` : "";

  const prompt =
    (conversationHistory ? "## Conversation So Far\n" + conversationHistory + "\n\n" : "") +
    draftContext +
    docContext +
    userMessage +
    "\n\nRespond with JSON only.";

  const searchTools: StructuredTool[] = webSearchTool({ tavilyKey: req.llm_keys.tavily });
  const tools = searchTools.length ? searchTools : [];
  const trace: TraceEvent[] = [];
  const onEvent = (ev: TraceEvent) => {
    trace.push(ev);
    opts.onTrace?.(ev);
  };

  const agent = createAgent({
    model,
    tools,
    systemPrompt: buildAgentBuilderSystemPrompt(toolCatalog, catalog),
  });
  const mapper = new TraceMapper(onEvent);
  let finalMessages: unknown[] = [];
  try {
    const stream = await agent.stream(
      { messages: [{ role: "user", content: prompt }] },
      { streamMode: ["updates"], recursionLimit: 6 },
    );
    for await (const chunk of stream) {
      mapper.feed(chunk);
    }
    const state = (await agent.getState({ recursionLimit: 6 } as any)) as { values?: { messages?: unknown[] } } | undefined;
    finalMessages = state?.values?.messages ?? [];
  } catch (e: any) {
    const failure = classifyModelError(e);
    throw new Error(failure.message);
  }
  keyPool.recordUsage({
    provider,
    keyRef,
    modelId: req.model_id,
    requests: 1,
  });

  const results = searchResultsFromTrace(trace);
  const sources = sourcesFromResults(results);
  const rawText = lastText(finalMessages);
  let parsed: any = parseJsonObject(rawText);

  // Recover only when JSON parsing failed outright; a valid response without
  // agent_draft_update means the model decided nothing changed.
  if (!parsed) {
    try {
      const recoveryModel = buildModel(req.model_id, req.llm_keys, apiKey, 0.3, 4_096);
      const recovery = await recoveryModel.invoke(
        [new SystemMessage(buildAgentBuilderSystemPrompt(toolCatalog, catalog)), new HumanMessage(buildBuilderRecoveryPrompt(prompt, rawText))],
      );
      const retryParsed = parseJsonObject(typeof recovery.content === "string" ? recovery.content : "");
      if (retryParsed) parsed = retryParsed;
    } catch (e: any) {
      console.warn(`[builder] JSON recovery failed: ${e?.message}`);
    }
  }

  if (!parsed) {
    const fallbackRes: BuilderResponse = {
      message: "I had trouble processing that. Could you try again?",
      sources: sources.length ? sources : undefined,
      search_results: results.length ? results : undefined,
      trace: trace.length ? trace : undefined,
    };
    await persistBuilderSessionTurn(req, fallbackRes);
    return fallbackRes;
  }

  const docNames = (req.document_texts || []).map((d) => d.filename.toLowerCase());
  const knownUrls = new Set(results.map((r) => r.url.toLowerCase().replace(/\/+$/, "")));
  const knownHosts = new Set(
    results.map((r) => {
      try {
        return new URL(r.url).hostname.replace(/^www\./, "");
      } catch {
        return "";
      }
    }),
  );
  const isRealBasis = (basis: string) => {
    const b = (basis || "").toLowerCase();
    if (b.includes("user input")) return true;
    if (docNames.some((n) => n && b.includes(n))) return true;
    if (knownUrls.has(b.replace(/\/+$/, ""))) return true;
    return [...knownHosts].some((h) => h && b.includes(h));
  };

  const seenOpts = new Set<string>();
  const options = Array.isArray(parsed.options)
    ? parsed.options
        .filter((o: any) => o && typeof o.label === "string" && o.label.trim())
        .map((o: any, i: number) => ({
          id: o && typeof o.id === "string" && o.id.trim() ? o.id.trim() : `opt-${i}`,
          label: o.label.trim(),
          description: o && typeof o.description === "string" && o.description.trim() ? o.description.trim() : undefined,
        }))
        .filter((o: { id: string }) => {
          if (seenOpts.has(o.id)) return false;
          seenOpts.add(o.id);
          return true;
        })
        .slice(0, 7)
    : undefined;

  const response: BuilderResponse = {
    message: parsed.message || "Let me know if you'd like to adjust anything.",
    options: options?.length ? options : undefined,
    agent_draft_update: normalizeDraft(parsed.agent_draft_update || undefined, catalog),
    thinking: parsed.thinking || undefined,
    sources: sources.length ? sources : undefined,
    search_results: results.length ? results : undefined,
    annotations: Array.isArray(parsed.annotations)
      ? parsed.annotations.filter((a: any) => a?.what && a?.basis && isRealBasis(a.basis)).slice(0, 40)
      : undefined,
    trace: trace.length ? trace : undefined,
  };

  await persistBuilderSessionTurn(req, response);
  return response;
}

/** Extract investment signals from uploaded document text. */
export async function extractDocumentSignals(
  modelId: string,
  keys: LlmKeys,
  documents: { filename: string; text: string }[],
): Promise<{
  style: string;
  philosophy: string;
  horizon: string;
  risk: number;
  qualitative_params: { parameter: string; content: string; weightage: number }[];
  quantitative_rules: { metric: string; metric_name: string; metric_type: string; operator: string; value: number; weightage: number }[];
}> {
  const { apiKey, keyRef } = keyPool.pickKey(modelId, keys as Record<string, string | undefined>);
  const provider = modelId.split("/")[0];
  const model = buildModel(modelId, keys, apiKey, 0.3, 2_000);

  const docContent = documents
    .map((d) => `### ${d.filename}\n${d.text.slice(0, 10000)}`)
    .join("\n\n");

  const result = await model.invoke([new HumanMessage(buildDocumentExtractionPrompt(docContent))]);
  keyPool.recordUsage({ provider, keyRef, modelId, requests: 1 });

  const empty = {
    style: "custom",
    philosophy: "",
    horizon: "Long-term (years)",
    risk: 5,
    qualitative_params: [],
    quantitative_rules: [],
  };
  const raw = typeof result.content === "string" ? result.content : "";
  const parsed = parseJsonObject(raw);
  if (!parsed) return empty;
  return {
    style: parsed.style || "custom",
    philosophy: parsed.philosophy || "",
    horizon: parsed.horizon || "Long-term (years)",
    risk: Math.min(10, Math.max(1, Number(parsed.risk) || 5)),
    qualitative_params: Array.isArray(parsed.qualitative_params) ? parsed.qualitative_params : [],
    quantitative_rules: normalizeQuantRules(Array.isArray(parsed.quantitative_rules) ? parsed.quantitative_rules : []),
  };
}

/** Draft qualitative parameters from an investor's persona text. */
export async function draftParameters(
  modelId: string,
  keys: LlmKeys,
  persona: string,
  section: "asset_evaluation" | "macro_evaluation",
  count: number,
): Promise<{ parameter: string; content: string; weightage: number }[]> {
  const { apiKey, keyRef } = keyPool.pickKey(modelId, keys as Record<string, string | undefined>);
  const provider = modelId.split("/")[0];
  const scope =
    section === "macro_evaluation"
      ? "market-level / macro qualitative factors a stock picker should monitor"
      : "company-level qualitative parameters for judging individual stocks";
  const model = buildModel(modelId, keys, apiKey, 0.4, 1_500);
  const result = await model.invoke([new HumanMessage(buildDraftParametersPrompt(persona, count, scope, getToolCatalog()))]);
  keyPool.recordUsage({ provider, keyRef, modelId, requests: 1 });

  const text = (typeof result.content === "string" ? result.content : "").replace(/```(?:json)?|```/g, "").trim();
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end <= start) throw new Error("Draft response was not a JSON array");
  let arr: any[];
  try {
    arr = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new Error("Could not parse drafted parameters");
  }
  return (Array.isArray(arr) ? arr : [])
    .filter((p) => p && typeof p.parameter === "string" && p.parameter.trim())
    .slice(0, count)
    .map((p) => ({
      parameter: String(p.parameter).trim(),
      content: String(p.content ?? "").trim(),
      weightage: Number.isFinite(Number(p.weightage)) ? Math.min(Math.max(Math.round(Number(p.weightage)), 1), 10) : 5,
    }));
}

// ── Skill authoring ─────────────────────────────────────────────────────────

export interface SkillDraftMessage {
  role: "assistant" | "user";
  content: string;
}

export interface SkillDraftRequest {
  user_id?: string;
  model_id: string;
  llm_keys: LlmKeys;
  messages: SkillDraftMessage[];
  requirements: string;
  current_draft: string;
  web_search?: boolean;
}

export interface SkillDraftResponse {
  message: string;
  skill_markdown?: string;
  issues?: { line: number; message: string; severity: string }[];
  valid: boolean;
  search_results?: { query: string; title: string; url: string }[];
}

const SKILL_AUTHOR_SYSTEM_PROMPT = `You are a skill author for an investor-agent platform. An investor agent is a set of skills; each skill is a markdown document that tells one focused analyst exactly what data to fetch, how to analyze it, what to conclude (verdict anchors), and what to plot.

Your craft, in order:
1. Capture intent before writing. If the user's request is ambiguous on WHAT to analyze, WHICH tools feed it, or what a YES verdict means, ask 2-4 focused questions instead of guessing. If the request is clear enough, draft immediately and note your interpretation in one line.
2. Design the skill around observable evidence. Every Method step must name the data it reads and what the analyst does with it; every anchor must be a claim a tool result can confirm or refute. A step or anchor that no tool can support is a defect — replace it with one the data can carry, or mark it honestly INSUFFICIENT in the Output Template.
3. Explain why, not just what. One clause of reasoning per Method step ("so a one-quarter spike isn't mistaken for a trend") makes the analyst smarter than a wall of rigid rules.

You write ONE skill markdown document per request, following the Agent Skills
specification (https://agentskills.io/specification) and this EXACT grammar:

---
name: kebab-case-name
description: One sentence on what the skill measures. Make it specific enough that a reader scanning the skill library can tell this skill apart from its neighbors.
allowed-tools: tool_one tool_two
metadata:
  title: Human Readable Name
  category: valuation|fundamentals|qualitative|market|macro|custom
  version: "1"
---

## Purpose
2-4 sentences: what this skill investigates and why it matters to an investor.

## Method
1. Ordered analysis steps, each concrete and checkable.

## Verdict Anchors
- Anchor phrased as a checkable claim — weight N     (weight 1-10, default 5)

## Charts
- type: line | title: Chart title | data: series tokens   (optional; types: line, bar, candlestick, table; tokens: price, volume, sma20, sma50, sma200, rsi14)

## Output Template
What the analyst must state first, and what to mark INSUFFICIENT when data is missing.

Web search (when available):
- If the user names an investor, fund, or a named methodology (e.g. "Peter Lynch skill", "QGLP framework"), web_search it FIRST and base Purpose/Method/anchors on what the sources actually describe — not a caricature. In your reply, name in one line what the top source showed and carry its vocabulary into the anchors.
- Never invent a methodology's rules; if search is unavailable or unhelpful, say so and build from the user's description, asking when unclear.

Rules for good skills:
- Anchors must be checkable claims about evidence, not vague qualities ("has a durable moat evidenced by stable margins", not "is a good company").
- allowed-tools lists only tools that actually exist for this platform, space-separated on ONE line: {TOOL_LIST}
- The name field is the slug: lowercase letters, digits and single hyphens, 1-64 chars, no leading/trailing/double hyphen. It becomes the skill's directory name, so it must be a valid identifier. Put the human-readable title in metadata.title instead.
- Method steps reference real data the tools return. No step may require data no tool provides.
- 3-6 anchors per skill. Weights reflect relative importance within the skill. Phrase each anchor so YES / PARTIAL / NO / INSUFFICIENT are all reachable outcomes.
- INSUFFICIENT is an honest outcome: the Output Template should say what to do when data is missing rather than guessing.

- Respond with conversational text FIRST (what you built and why, questions if requirements are unclear), then the full skill markdown in a fenced \`\`\`markdown code block. If the user is still clarifying requirements and no draft is possible yet, just reply conversationally with 2-4 focused questions.`;

/** AI skill authoring: chat → validated skill markdown. */
export async function skillDraftTurn(req: SkillDraftRequest): Promise<SkillDraftResponse> {
  const { apiKey, keyRef } = keyPool.pickKey(req.model_id, req.llm_keys as Record<string, string | undefined>);
  const model = buildModel(req.model_id, req.llm_keys, apiKey);
  const provider = req.model_id.split("/")[0];

  const toolList = getToolCatalog().map((t) => t.name).join(", ");
  const system = SKILL_AUTHOR_SYSTEM_PROMPT.replace("{TOOL_LIST}", toolList);

  const conversation = req.messages
    .map((m) => `${m.role === "assistant" ? "Assistant" : "User"}: ${m.content}`)
    .join("\n\n");

  const promptParts: string[] = [];
  if (conversation) promptParts.push(`## Conversation so far\n${conversation}`);
  if (req.current_draft) promptParts.push(`## Current draft (refine this; output the FULL updated skill)\n\`\`\`markdown\n${req.current_draft}\n\`\`\``);
  promptParts.push(`## User's latest requirements\n${req.requirements || "(no new input)"}`);
  promptParts.push("\nRespond now.");

  const searchRequested = req.web_search !== false;
  const tools: StructuredTool[] = searchRequested ? webSearchTool({ tavilyKey: req.llm_keys.tavily }) : [];

  const searchResults: { query: string; title: string; url: string }[] = [];
  const trace: TraceEvent[] = [];
  const onEvent = (ev: TraceEvent) => {
    trace.push(ev);
    if (ev.type === "tool_result" && ev.tool === "web_search") {
      for (const r of ((ev.result as any)?.results ?? []) as any[]) {
        if (r?.url) searchResults.push({ query: (ev as any).args?.query || "", title: r.title || "", url: r.url });
      }
    }
  };

  const agent = createAgent({ model, tools, systemPrompt: system });
  const mapper = new TraceMapper(onEvent);
  let finalMessages: unknown[] = [];
  try {
    const stream = await agent.stream(
      { messages: [{ role: "user", content: promptParts.join("\n\n") }] },
      { streamMode: ["updates"], recursionLimit: 6 },
    );
    for await (const chunk of stream) {
      mapper.feed(chunk);
    }
    const state = (await agent.getState({ recursionLimit: 6 } as any)) as { values?: { messages?: unknown[] } } | undefined;
    finalMessages = state?.values?.messages ?? [];
  } catch (e: any) {
    const failure = classifyModelError(e);
    throw new Error(failure.message);
  }
  keyPool.recordUsage({ provider, keyRef, modelId: req.model_id, requests: 1 });

  const text = lastText(finalMessages);
  if (!text.trim()) throw new Error("No output generated — try a different model.");

  const fenceMatch = text.match(/```(?:markdown|md)?\s*\n([\s\S]*?)```/);
  const markdown = fenceMatch?.[1]?.trim() || "";
  const message = text.replace(/```(?:markdown|md)?[\s\S]*?```/g, "").trim();

  if (markdown) {
    const { skill, issues } = parseSkillMarkdown(markdown, "custom");
    const hard = issues.filter((i) => i.severity === "error");
    if (!skill) {
      console.warn(`[skilldraft] draft failed validation: ${hard.map((i) => i.message).join("; ")}`);
      return {
        message: message || "The draft failed validation — see issues.",
        skill_markdown: markdown,
        issues,
        valid: false,
        search_results: searchResults.slice(0, 20),
      };
    }
    return {
      message: message || `Drafted skill "${skill.name}".`,
      skill_markdown: markdown,
      issues,
      valid: true,
      search_results: searchResults.slice(0, 20),
    };
  }

  return { message: message || text, valid: false, search_results: searchResults.slice(0, 20) };
}
