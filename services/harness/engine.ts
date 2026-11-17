/**
 * The engine — deepagents IS the harness now.
 *
 * One `createDeepAgent` per run: the agent researches AND writes via its own
 * loop — domain tools, native filesystem (per-run dir on disk), skills by
 * progressive disclosure (pinned for the run), planning via write_todos, and
 * human-in-the-loop interrupts from the agent definition. The old plan/
 * canvas/loop choreography is gone; what survives is the CONTRACT this
 * module keeps: RunOptions in, RunResult out (status/document/errors/trace/
 * budgetUsed/verdict/workspace), with the exact TraceEvent vocabulary the
 * client timeline already renders.
 *
 * Report assembly is a plain stitch, exactly as before: the agent's
 * `report_write` calls land schema-validated sections on the ReportCanvas;
 * attachChartData + renderFigures finish the document.
 */

import { join } from "node:path";
import { mkdirSync, readFileSync, readdirSync, writeFileSync, statSync, existsSync } from "node:fs";
import { createDeepAgent, FilesystemBackend, CompositeBackend } from "deepagents";
import { createMiddleware, todoListMiddleware } from "langchain";
import { Command } from "@langchain/langgraph";
import type { BaseLanguageModel } from "@langchain/core/language_models/base";
import type { StructuredTool } from "@langchain/core/tools";
import { HumanMessage, ToolMessage } from "@langchain/core/messages";
import { promptDoc, shouldSaveWorkspace } from "./config.js";
import { applyVariables, datedPrompt, hasSeriesTool, type SystemPrompt } from "./prompts.js";
import { sectionContractMarkdown, plotReferenceMarkdown } from "./report/reference.js";
import { reportStructureOf, skillSourceDirs, type HarnessSkill } from "./skills.js";
import type { AgentDefinition, InterruptOn } from "./store.js";
import type { Budget, TraceEvent } from "./types.js";
import { friendlyError } from "./types.js";
import { TraceMapper, type RunStats } from "./trace.js";
import { langfuseCallbacks } from "./tracing.js";
import { getCheckpointer } from "./checkpointer.js";
import { ReportCanvas, validateComposed } from "./report/canvas.js";
import { reportWriteTool } from "./tools/report-write.js";
import { allBlocks, countCharts, sectionHeadings, type ReportDocument } from "./report/document.js";
import { attachChartData, renderFigures } from "./report/builder.js";
import { getPriceHistory } from "./marketdata.js";
import { gradeReport, reportDigest, type Verdict } from "./report/verdict.js";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

export interface RunOptions {
  runId: string;
  userId: string;
  model: BaseChatModel;
  agent: AgentDefinition;
  /** Resolved skills (max 1) — pinned into the run. */
  skills: HarnessSkill[];
  /** Tool allowlist (empty = all). */
  allowedTools: string[];
  /** Domain tools (LangChain StructuredTool[]), built by the composition root. */
  tools: StructuredTool[];
  template: SystemPrompt | null;
  /** Named system prompt (agent.yaml prompts.<name>); absent/unknown → default. */
  systemPromptName?: string;
  symbol: string;
  source: string;
  prompt: string;
  budget: Budget;
  /** Grade the verdict AFTER the stitch (default true). API passes false and grades later. */
  grade?: boolean;
  /** Previous run's workspace snapshot — restored into the run dir first. */
  initialWorkspace?: Record<string, string>;
  saveWorkspace?: boolean;
  onEvent?: (event: TraceEvent) => void;
  /** Fires after every report_write with the live document (caller throttles). */
  onCanvas?: (canvas: ReportCanvas) => void;
  /** Fires once at run end with the compacted workspace snapshot. */
  onWorkspace?: (snapshot: Record<string, string>) => void;
  abortSignal?: AbortSignal;
}

export type RunStatus = "completed" | "partial" | "failed";

export interface RunResult {
  status: RunStatus;
  document: ReportDocument;
  errors: string[];
  trace: TraceEvent[];
  budgetUsed: RunStats & { kbFiles: number };
  canvas: ReportCanvas;
  rejectedSections: number;
  verdict: Verdict | null;
  workspace: Record<string, string>;
  workspaceFull?: Record<string, string>;
  /** Set when the run ended on a human-in-the-loop interrupt. */
  pendingInterrupt?: { tool: string; args: unknown }[];
}

// ── Run filesystem ──────────────────────────────────────────────────────────

export function runWorkspaceDir(runId: string): string {
  return join(process.cwd(), "data", "runs", runId, "workspace");
}

const SPILL_THRESHOLD = 16_000;

/** Compact a workspace dir → {path: content}; large files keep their head. */
export function compactWorkspace(dir: string, full = false): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (base: string, rel: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(base);
    } catch {
      return;
    }
    for (const entry of entries) {
      const p = join(base, entry);
      const relPath = rel ? `${rel}/${entry}` : entry;
      try {
        if (statSync(p).isDirectory()) walk(p, relPath);
        else if (statSync(p).size <= SPILL_THRESHOLD || full) out[`/${relPath}`] = readFileSync(p, "utf8");
        else out[`/${relPath}`] = `${readFileSync(p, "utf8").slice(0, 2_000)}\n… [truncated — use read_file]`;
      } catch {
        // unreadable — skip
      }
    }
  };
  walk(dir, "");
  return out;
}

function hydrateWorkspace(dir: string, snapshot: Record<string, string>): void {
  for (const [path, content] of Object.entries(snapshot)) {
    const rel = path.replace(/^\/+/, "");
    if (!rel || rel.includes("..")) continue;
    const dest = join(dir, rel);
    try {
      mkdirSync(join(dest, ".."), { recursive: true });
      writeFileSync(dest, content);
    } catch {
      // skip unwritable entries — the run continues fresh
    }
  }
}

// ── deepagent assembly (shared by run + resume) ─────────────────────────────

let langfuseHandlers: unknown[] = [];

/**
 * Tool errors are RESULTS, not loop crashes — a flaky MCP endpoint (or a
 * tool bug) must surface to the model as an error ToolMessage and the loop
 * keeps going, exactly like the old registry's behavior. The domain tools
 * already return error-shaped objects; this guard catches the ones that
 * still throw (network failures, upstream 500s).
 */
const toolErrorGuard = createMiddleware({
  name: "ToolErrorGuard",
  wrapToolCall: async (request, handler) => {
    try {
      return await handler(request);
    } catch (e: any) {
      const text = `Error: ${friendlyError(e?.message || String(e))}`;
      console.warn(`[engine] tool ${request.toolCall?.name} failed: ${text}`);
      return new ToolMessage({
        content: text,
        tool_call_id: request.toolCall?.id ?? "",
        name: request.toolCall?.name,
        status: "error",
      });
    }
  },
});

/**
 * Time-pressure nudges — the old prepareStep deadline escalation, as
 * middleware. Half the budget gone with nothing on the canvas → "start
 * writing"; 80% gone → final warning. Fires once per threshold, only when
 * the agent hasn't written a single section.
 */
function createTimePressureMiddleware(canvas: ReportCanvas, budgetMs: number, t0: number) {
  const fired = { half: false, final: false };
  return createMiddleware({
    name: "TimePressure",
    beforeModel: () => {
      if (canvas.sectionCount() > 0) return undefined;
      const elapsed = Date.now() - t0;
      // Persistent trailing reminder, like the old harness's prepareStep: the
      // model sees it on EVERY model call past the threshold until it writes.
      if (elapsed >= budgetMs * 0.8) {
        if (!fired.final) console.log("[engine] time-pressure: final phase reminder active");
        fired.final = true;
        return {
          messages: [new HumanMessage("⏳ REMINDER (final phase): the run is nearly out of time and no sections are written. Your next tool calls should be report_write calls with the evidence you have — partial sections beat no report.")],
        };
      }
      if (elapsed >= budgetMs * 0.5) {
        if (!fired.half) console.log("[engine] time-pressure: half-budget reminder active");
        fired.half = true;
        return {
          messages: [new HumanMessage("⏳ REMINDER: half the budget is used and no sections are written yet. Stop researching — call report_write now with the evidence you have.")],
        };
      }
      return undefined;
    },
  });
}

/** Knowledge-base archiver — the pass the old workspace module ran per tool
 *  call, now one post-run sweep: every non-fs tool result lands under
 *  /knowledge_base/sources/ so compactWorkspace() has files to persist and
 *  the run's Knowledge Base section has content to show. Best-effort. */
export function hydrateKnowledgeBase(workspaceDir: string, trace: TraceEvent[]): void {
  try {
    const skip = /^(report_write|write_todos|read_file|write_file|edit_file|ls|glob|grep|view)/;
    const kbDir = join(workspaceDir, "knowledge_base", "sources");
    let n = 0;
    for (const ev of trace) {
      if (ev.type !== "tool_result") continue;
      // In-memory events say "ok"|"error"; persisted rows say "OK"|"ERR".
      if (ev.status === "error" || (ev.status as string) === "ERR") continue;
      if (skip.test(ev.tool)) continue;
      if (ev.result == null) continue;
      const body = typeof ev.result === "string" ? ev.result : JSON.stringify(ev.result, null, 2);
      if (body.length < 40) continue; // echoes and empty payloads aren't knowledge
      // ponytail: 40 files × 20 KB cap — enough for a run's evidence; raise if runs exceed it.
      if (n >= 40) break;
      mkdirSync(kbDir, { recursive: true });
      writeFileSync(join(kbDir, `${ev.tool.replace(/[^\w.-]/g, "_")}_${++n}.json`), body.length > 20_000 ? `${body.slice(0, 20_000)}…` : body);
    }
  } catch {
    // KB hydration is best-effort — never fail a run over it.
  }
}

function backendFor(userId: string, workspaceDir: string) {
  const fs = new FilesystemBackend({ rootDir: workspaceDir, virtualMode: true });
  const sources = skillSourceDirs(userId);
  if (!sources.length) return { backend: fs, skills: [] as string[] };
  const routes: Record<string, FilesystemBackend> = {};
  for (const s of sources) routes[s.route] = new FilesystemBackend({ rootDir: s.dir, virtualMode: true });
  return { backend: new CompositeBackend(fs, routes), skills: sources.map((s) => s.route) };
}

function buildSystemPrompt(o: {
  agent: AgentDefinition;
  skills: HarnessSkill[];
  template: SystemPrompt | null;
  toolNames: string[];
  budget: Budget;
}): string {
  const agentsDoc = promptDoc((o as { systemPromptName?: string }).systemPromptName ?? "agents") || promptDoc("agents");
  const seriesOk = hasSeriesTool(o.toolNames);
  const slots: Record<string, string | undefined> = {
    section_contract: sectionContractMarkdown(),
    plot_reference: plotReferenceMarkdown(seriesOk),
  };
  const fill = (text: string) => applyVariables(text, slots);
  const generated = [
    /\{\{\s*section_contract\s*\}\}/.test(agentsDoc)
      ? ""
      : `## Report sections\nreport_write accepts only these typed section blocks — any other type is rejected:\n${sectionContractMarkdown()}`,
    /\{\{\s*plot_reference\s*\}\}/.test(agentsDoc) ? "" : `## Plots\n${plotReferenceMarkdown(seriesOk)}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  const structureParts = o.skills
    .map((s) => {
      const text = reportStructureOf(s);
      return text ? `### ${s.id}\n${text}` : null;
    })
    .filter((x): x is string => !!x);
  const structure = structureParts.length
    ? [
        "The report this run produces MUST follow this structure and these writing standards. They override any default formatting habit — including section shapes suggested elsewhere in the skill body. Where the skill body and this structure disagree on presentation, THIS STRUCTURE WINS: present the same findings the way the structure prescribes.",
        "",
        ...structureParts,
      ].join("\n\n")
    : "";
  const skillNote = o.skills.length
    ? `## Skill\nYour operating skill for this run: ${o.skills.map((s) => s.id).join(", ")}. Its full SKILL.md is pinned below and its reference files live under its skill directory on the filesystem — read them with read_file when the instructions call for them.`
    : "";
  const budgetNote = [
    "## Run budget",
    `You have about ${o.budget.maxSteps} tool rounds and ${Math.round((o.budget.maxMs ?? 180_000) / 60_000)} minutes for the whole run. Research efficiently — batch your tool calls — and begin writing sections with report_write once you have enough evidence. Reserve the final third of the budget for writing: an unreported analysis is a failed run.`,
    "Keep the plan current: call write_todos to mark an item completed (and the next one in_progress) as soon as you finish it — the live plan display reads those updates and shows nothing until you do.",
  ].join("\n");
  // No soul/philosophy block: an agent's behavior comes from the prompt doc,
  // its skill, and the budget — persona prose no longer reaches the run.
  return [fill(agentsDoc), structure, skillNote, budgetNote, generated].filter(Boolean).join("\n\n");
}

async function createRunAgent(o: RunOptions, toolNames: string[], canvas: ReportCanvas, notify: () => void) {
  const { backend, skills } = backendFor(o.userId, runWorkspaceDir(o.runId));
  const interruptOn: InterruptOn | undefined = o.agent.interruptOn;
  return createDeepAgent({
    model: o.model,
    systemPrompt: buildSystemPrompt({ ...o, toolNames }),
    tools: [...o.tools, reportWriteTool({ canvas, notify })],
    backend,
    ...(skills.length ? { skills } : {}),
    middleware: [todoListMiddleware(), toolErrorGuard, createTimePressureMiddleware(canvas, o.budget.maxMs ?? 180_000, Date.now())],
    checkpointer: await getCheckpointer(),
    name: o.agent.name,
    ...(interruptOn && Object.keys(interruptOn).length ? { interruptOn } : {}),
  });
}

function runConfig(o: { runId: string; budget: Budget; abortSignal?: AbortSignal }): Record<string, unknown> {
  return {
    configurable: { thread_id: o.runId },
    // LangGraph recursionLimit counts graph super-steps: one tool round-trip
    // = model node + tools node (2), plus the final model-only step.
    recursionLimit: o.budget.maxSteps * 2 + 2,
    callbacks: langfuseHandlers,
    ...(o.budget.maxMs ? { signal: o.abortSignal ?? undefined } : {}),
  };
}

/** Load the Langfuse handler once (async) — call at server boot. */
export async function bootTracing(): Promise<void> {
  langfuseHandlers = await langfuseCallbacks();
}

// ── The run ─────────────────────────────────────────────────────────────────

/**
 * Chart `data` tokens resolve from structured tool results; MCP tools return
 * text/tables/images, so the server fetches the price series itself at
 * assembly (keyless Yahoo chart client — same data the old built-in tool
 * returned). Best-effort: no history = tokens stay unresolved.
 */
async function chartPreload(o: { symbol: string; source: string }): Promise<unknown[]> {
  try {
    const h = await getPriceHistory(o.symbol, "2y", o.source);
    return h ? [h] : [];
  } catch {
    return [];
  }
}

export async function runAgent(o: RunOptions): Promise<RunResult> {
  const trace: TraceEvent[] = [];
  const emit = (e: TraceEvent) => {
    trace.push(e);
    o.onEvent?.(e);
  };
  const canvas = new ReportCanvas(o.symbol);
  const workspaceDir = runWorkspaceDir(o.runId);
  mkdirSync(workspaceDir, { recursive: true });
  if (o.initialWorkspace && Object.keys(o.initialWorkspace).length) {
    hydrateWorkspace(workspaceDir, o.initialWorkspace);
  }
  const agentsDoc = promptDoc(o.systemPromptName ?? "agents") || promptDoc("agents");
  const agentsPath = join(workspaceDir, "AGENTS.md");
  if (agentsDoc && !existsSync(agentsPath)) {
    try {
      writeFileSync(agentsPath, agentsDoc);
    } catch {
      // seeding is best-effort
    }
  }

  emit({ type: "phase", phase: "run", label: "Agent", detail: "One deep agent loop: gather evidence, plan with todos, write the report" });

  const toolNames = o.tools.map((t) => t.name);
  const baseTools: StructuredTool[] = o.allowedTools.length
    ? o.tools.filter((t) => o.allowedTools.includes(t.name))
    : o.tools;
  const notify = () => o.onCanvas?.(canvas);

  const agent = await createRunAgent({ ...o, tools: baseTools }, toolNames, canvas, notify);
  const mapper = new TraceMapper(emit);

  const userPrompt = datedPrompt(
    `Analyze ${o.symbol} (${o.source}). Use the tools to gather the evidence a rigorous research report needs for ${o.symbol}.`,
  );
  const input = {
    messages: [{ role: "user" as const, content: o.prompt || userPrompt }],
    ...(o.skills.length ? { pinnedSkills: o.skills.map((s) => s.id) } : {}),
  };

  const budgetUsed = { steps: 0, tokens: 0, inputTokens: 0, peakInput: 0, toolCalls: 0, kbFiles: 0 };
  let endedOnInterrupt = false;
  // Wall-clock backstop: budget.maxMs aborts the stream mid-run; the stitch
  // below keeps whatever the agent already wrote (partial run).
  const wallClock = new AbortController();
  const wallClockTimer = o.budget.maxMs ? setTimeout(() => wallClock.abort(), o.budget.maxMs) : null;
  try {
    const stream = await agent.stream(input, runConfig({ ...o, abortSignal: o.abortSignal ?? wallClock.signal }) as never);
    for await (const chunk of stream) {
      // streamMode arrays yield [mode, data] tuples; a single mode yields raw data.
      const [mode, data] = Array.isArray(chunk) && typeof chunk[0] === "string" ? chunk : ([undefined, chunk] as const);
      if (mode !== undefined && mode !== "updates") continue;
      const interrupts = (data as Record<string, unknown>)?.["__interrupt__"];
      if (Array.isArray(interrupts) && interrupts.length) endedOnInterrupt = true;
      mapper.feed(data);
    }
    budgetUsed.steps = mapper.stats.steps;
    budgetUsed.tokens = mapper.stats.tokens;
    budgetUsed.inputTokens = mapper.stats.inputTokens;
    budgetUsed.peakInput = mapper.stats.peakInput;
    budgetUsed.toolCalls = mapper.stats.toolCalls;
  } catch (e: any) {
    const aborted = wallClock.signal.aborted || e?.name === "AbortError";
    emit({ type: "log", text: aborted ? "run hit the wall-clock budget — keeping what was written" : `agent loop crashed — ${friendlyError(e?.message || String(e))}` });
    if (!aborted && e?.stack) console.error("[engine] crash stack:", e.stack);
  } finally {
    if (wallClockTimer) clearTimeout(wallClockTimer);
  }
  Object.assign(budgetUsed, mapper.stats);
  notify();

  // ── STITCH — sections land exactly as the agent wrote them. ───────────────
  const document = canvas.document();
  attachChartData(document, trace, undefined, await chartPreload(o));
  renderFigures(document);

  const loopErrors: string[] = [];
  if (endedOnInterrupt) loopErrors.push("run paused for human approval (interrupt) — resume with POST /analysis/:id/resume");

  // Completion gate — open todo items ship PARTIAL, never "completed".
  const gate: string[] = [];
  try {
    const state = (await agent.getState(runConfig(o) as any)) as { values?: { todos?: { content: string; status: string }[] } } | undefined;
    const todos = state?.values?.todos ?? [];
    const open = todos.filter((t) => t.status !== "completed");
    if (todos.length && open.length) {
      gate.push(`completion gate: ${open.length} todo item(s) still open — ${open.map((t) => t.content.slice(0, 60)).join("; ")}`);
    }
  } catch {
    // state unreadable — skip the gate
  }

  const errors = [...loopErrors, ...gate];
  const rejectedSections = trace
    .filter((e) => e.type === "tool_result" && e.tool === "report_write" && e.status === "ok")
    .filter((e) => {
      const r = (e as any).result ?? {};
      return (r.rejected?.length ?? 0) > 0 && !(r.added > 0);
    })
    .reduce((n, e) => n + (((e as any).result?.rejected as unknown[] | undefined)?.length ?? 0), 0);
  const wroteAny = canvas.sectionCount() > 0;
  if (!wroteAny && rejectedSections) {
    errors.push(`every report_write was rejected (${rejectedSections} section(s)) — no valid section reached the canvas`);
  }
  if (!wroteAny && !errors.length) errors.push("agent finished without writing any sections");
  const status: RunStatus = endedOnInterrupt
    ? "partial"
    : !wroteAny
      ? "failed"
      : rejectedSections > 0 || gate.length > 0
        ? "partial"
        : "completed";
  emit({ type: "log", text: `Report stitched — ${document.sections.length} sections, ${status}` });

  let verdict: Verdict | null = null;
  if (o.grade !== false && wroteAny && !o.abortSignal?.aborted) {
    const digest = reportDigest(document);
    verdict = await gradeReport({ text: digest, model: o.model, abortSignal: o.abortSignal });
    emit({ type: "log", text: verdict ? `report verdict: ${verdict}` : "report verdict unavailable" });
  }

  const saveFull = shouldSaveWorkspace(o.saveWorkspace);
  hydrateKnowledgeBase(workspaceDir, trace);
  const workspace = compactWorkspace(workspaceDir);
  const workspaceFull = saveFull ? compactWorkspace(workspaceDir, true) : undefined;
  o.onWorkspace?.(workspace);

  return {
    status,
    document,
    errors,
    trace,
    budgetUsed,
    canvas,
    rejectedSections,
    verdict,
    workspace,
    workspaceFull,
    ...(endedOnInterrupt ? { pendingInterrupt: lastInterruptRequests(trace) } : {}),
  };
}

/** The pending action requests from the trace (for the resume UI). */
export function lastInterruptRequests(trace: TraceEvent[]): { tool: string; args: unknown }[] {
  // The mapper narrates interrupts as ONE phase event whose detail is the
  // full JSON actionRequests array. The LAST one is this run's pending set.
  for (let i = trace.length - 1; i >= 0; i--) {
    const e = trace[i];
    if (e.type === "phase" && e.label.startsWith("Awaiting approval")) {
      try {
        const parsed = JSON.parse(e.detail ?? "[]") as { name: string; args: unknown }[];
        return parsed.map((req) => ({ tool: req.name, args: req.args }));
      } catch {
        return [];
      }
    }
  }
  return [];
}

// ── Human-in-the-loop resume ────────────────────────────────────────────────

export interface ResumeOptions {
  runId: string;
  userId: string;
  model: BaseChatModel;
  agent: AgentDefinition;
  skills: HarnessSkill[];
  tools: StructuredTool[];
  template: SystemPrompt | null;
  systemPromptName?: string;
  symbol: string;
  source: string;
  onEvent?: (event: TraceEvent) => void;
  onCanvas?: (canvas: ReportCanvas) => void;
  onWorkspace?: (snapshot: Record<string, string>) => void;
  abortSignal?: AbortSignal;
}

/** One decision per pending actionRequest, in order. */
export type ReviewDecision =
  | { type: "approve" }
  | { type: "reject"; message?: string }
  | { type: "edit"; editedAction: { name: string; args: Record<string, unknown> } }
  | { type: "respond"; message?: string };

/** Resume a paused run with human decisions and drive it to completion. */
export async function resumeAgent(o: ResumeOptions, decisions: ReviewDecision[]): Promise<RunResult> {
  const trace: TraceEvent[] = [];
  const emit = (e: TraceEvent) => {
    trace.push(e);
    o.onEvent?.(e);
  };
  const canvas = new ReportCanvas(o.symbol);
  const notify = () => o.onCanvas?.(canvas);
  const agent = await createRunAgent(
    {
      runId: o.runId,
      userId: o.userId,
      model: o.model,
      agent: o.agent,
      skills: o.skills,
      allowedTools: [],
      tools: o.tools,
      template: o.template,
      systemPromptName: o.systemPromptName,
      symbol: o.symbol,
      source: o.source,
      prompt: "",
      budget: { maxSteps: 100, maxTokens: 2_000_000, cbSessions: 1, cbSessionSteps: 1 },
      grade: false,
    },
    o.tools.map((t) => t.name),
    canvas,
    notify,
  );
  emit({ type: "phase", phase: "run", label: "Resumed", detail: "Human decisions applied — continuing the run" });
  const mapper = new TraceMapper(emit);
  try {
    const stream = await agent.stream(new Command({ resume: { decisions } }), runConfig({ ...o, runId: o.runId, budget: { maxSteps: 100, maxTokens: 2_000_000, cbSessions: 1, cbSessionSteps: 1 } }) as never);
    for await (const chunk of stream) {
      mapper.feed(chunk);
    }
  } catch (e: any) {
    emit({ type: "log", text: `resume crashed — ${friendlyError(e?.message || String(e))}` });
  }
  notify();

  const document = canvas.document();
  attachChartData(document, trace, undefined, await chartPreload(o));
  renderFigures(document);

  const wroteAny = canvas.sectionCount() > 0;
  const status: RunStatus = !wroteAny ? "failed" : "completed";
  const workspace = compactWorkspace(runWorkspaceDir(o.runId));
  o.onWorkspace?.(workspace);
  emit({ type: "log", text: `Report stitched — ${document.sections.length} sections, ${status}` });
  return {
    status,
    document,
    errors: wroteAny ? [] : ["resumed run wrote no sections"],
    trace,
    budgetUsed: { ...mapper.stats, kbFiles: 0 },
    canvas,
    rejectedSections: 0,
    verdict: null,
    workspace,
  };
}

// Keep the helpers the old barrel exported (same vocabulary, deepagents loop).
export { validateComposed, countCharts, sectionHeadings, allBlocks };
