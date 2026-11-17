/**
 * Run orchestration: one place that knows how to execute a harness agent
 * against a symbol and persist the run into `analysis_runs`.
 *
 * Shared by POST /analysis (fire-and-forget) and POST /harness/agents/:id/run
 * (synchronous). index.ts owns HTTP; this module owns the run lifecycle:
 * compile → tools → key/model fallback loop → throttled snapshots → persist.
 * Interrupts pause the run row (RUNNING + note); POST /analysis/:id/resume
 * applies decisions via resumeAgent.
 */

import { randomUUID } from "node:crypto";
import { keyPool } from "./keypool.js";
import { fetchUserKeys } from "./provision.js";
import { log } from "./logger.js";
import type { TraceEvent } from "../harness/types.js";
import type { TraceRowEvent } from "../harness/trace.js";
import { TraceCollector } from "../harness/trace.js";
import { insertRunRow, updateRunRow, getRunRow, failStaleRunRows } from "../db/repo.js";
import {
  getAgent,
  listAgents,
  createAgent,
  DEFAULT_HARNESS_AGENT,
  compileAgent,
  clampBudget,
  runAgent,
  resumeAgent,
  buildRunTools,
  type ToolSourcesConfig,
  loadRunFileConfig,
  resolveRunConfig,
  getSystemPrompt,
  gradeReport,
  reportDigest,
  RETRYABLE_ERROR,
  type AgentDefinition,
  type Budget,
  type ReportDocument,
  type RunResult,
  type ResumeOptions,
  type ReviewDecision,
  type SystemPrompt,
  type TraceEvent as HarnessTraceEvent,
  type Verdict,
} from "../harness/index.js";
import { bootTracing } from "../harness/index.js";

// Tracing loads once at import time (no-op without env keys).
void bootTracing();

/** Verdict AFTER the report is already persisted — off the request's critical
 *  path (the UI shows the finished report seconds earlier; the badge lands
 *  when grading returns). Fire-and-forget; failures only cost the badge. */
async function gradeInBackground(document: ReportDocument, modelId: string, llmKeys: Record<string, string>, runId: string): Promise<void> {
  try {
    const digest = reportDigest(document);
    const { apiKey } = keyPool.pickKey(modelId, llmKeys);
    const verdict = await gradeReport({ text: digest, model: buildModel(modelId, llmKeys, apiKey) });
    if (!verdict) return;
    await updateRunRow(runId, { report: { ...document, verdict } }).catch((e: any) =>
      log.warn("harness", `background verdict failed for run ${runId}: ${e?.message || e}`),
    );
  } catch (e: any) {
    log.warn("harness", `background verdict error for run ${runId}: ${e?.message || e}`);
  }
}

// buildModel lives in the harness model layer now.
import { buildModel, type LlmKeys } from "../harness/model.js";

export interface HarnessRunResult {
  status: string;
  document: ReportDocument;
  errors: string[];
  verdict?: Verdict | null;
  runId: string;
}

/** Harness event list → the snake_case trace persisted with the run. */
export function toLegacyTrace(events: HarnessTraceEvent[]): TraceRowEvent[] {
  return events.map((e: any, i: number) => ({
    seq: i + 1,
    ts: Date.now() + i,
    type: e.type,
    key: e.taskId ?? e.tool ?? e.type,
    ...serverTraceFields(e),
  }));
}

/**
 * Final trace row carrying the run's LLM token tally — the mapper collects
 * usage_metadata that would otherwise die with the process (the run table has
 * no token columns). RunMetadata reads it to feed the cost meter and the
 * tokens-in/out rows.
 */
function usageTraceEvent(stats: { inputTokens?: number; tokens?: number; peakInput?: number; toolCalls?: number }): TraceRowEvent {
  return {
    seq: Number.MAX_SAFE_INTEGER,
    ts: Date.now(),
    type: "usage",
    key: "usage",
    value: {
      tokens_in: Math.max(0, Math.round(stats.inputTokens ?? 0)),
      tokens_out: Math.max(0, Math.round(stats.tokens ?? 0)),
      peak_input: Math.max(0, Math.round(stats.peakInput ?? 0)),
      tool_calls: Math.max(0, Math.round(stats.toolCalls ?? 0)),
    },
  };
}

/** Harness loop/canvas event → the snake_case fields every UI trace consumer reads. */
function serverTraceFields(e: any): Omit<TraceRowEvent, "seq" | "ts" | "type" | "key"> {
  return {
    text:
      e.type === "canvas_block"
        ? `${e.status === "done" ? "✓" : "✗"} ${e.taskTitle}${e.summary ? ` — ${e.summary}` : ""}`
        : e.text,
    tool: e.tool,
    tool_call_id: e.toolCallId,
    args: e.args,
    result: e.type === "canvas_block" ? { taskId: e.taskId, sectionCount: e.sectionCount, status: e.status } : e.result,
    status: e.status === "ok" ? "OK" : e.status === "error" ? "ERR" : e.status,
    duration_ms: e.durationMs,
    score: e.score,
    summary: e.summary,
    error: e.error,
    phase: e.phase,
    label: e.type === "canvas_block" ? e.taskTitle : e.label,
  };
}

interface RunHarnessOptions {
  existingRunId?: string;
  promptOverride?: string;
  skillIdsOverride?: string[];
  budgetOverride?: { maxSteps?: number; maxTokens?: number };
}

/**
 * Run a harness agent against a symbol: compile the definition, wire the data
 * tools (websearch + MCP data tools), execute the deepagents loop with key/model
 * fallback, persist the run, and return the typed document. Shared by
 * POST /analysis and POST /harness/agents/:id/run. Returns null when the
 * agent does not exist for the user.
 */
export async function runHarnessSymbol(
  userId: string,
  agentId: string,
  symbol: string,
  source: string,
  requestedModel?: string,
  requestedSystemPrompt?: string,
  o: RunHarnessOptions = {},
): Promise<HarnessRunResult | null> {
  const t0 = Date.now();
  const agent = await getAgent(userId, agentId);
  if (!agent) return null;

  // System prompt chosen by name (agent.yaml prompts.*): request override, else
  // the agent's own pick, else the default `agents` doc.
  const systemPrompt = requestedSystemPrompt || agent.systemPrompt || undefined;
  const template: SystemPrompt | null = getSystemPrompt(systemPrompt || "");
  const compiled = compileAgent(userId, agent, {
    template,
    vars: { symbol, title: symbol, date: new Date().toISOString().slice(0, 10), source, agent: agent.name },
    skillIds: o.skillIdsOverride,
  });
  const { llmKeys, webSearchProvider } = await fetchUserKeys(userId);
  let modelId = requestedModel || agent.modelId || keyPool.getDefaultModel(llmKeys);
  const budget: Budget = clampBudget({ ...compiled.budget, ...o.budgetOverride });
  // API wall-clock backstop: hard stop at 180s.
  if (!budget.maxMs) budget.maxMs = 180_000;
  const { config: cliCfg } = loadRunFileConfig();
  const resolved = resolveRunConfig(process.env, cliCfg);

  const runId = o.existingRunId ?? randomUUID();

  // Live trace: every loop event is published to the SSE hub while the run is
  // going, and a throttled copy is persisted so a restart doesn't blank the panel.
  const collector = new TraceCollector(runId, async (events) => {
    try {
      await updateRunRow(runId, { trace: events });
    } catch {
      // trace persistence is best-effort; the final write is authoritative
    }
  });

  // Throttled report + workspace snapshots mid-run (UI polls GET /analysis/:id).
  let lastCanvasFlush = 0;
  const flushCanvas = async (doc: ReportDocument, force = false) => {
    const now = Date.now();
    if (!force && now - lastCanvasFlush < 3000) return;
    lastCanvasFlush = now;
    try {
      await updateRunRow(runId, { report: doc });
    } catch (e: any) {
      log.warn("harness", `canvas snapshot failed for run ${runId}: ${e?.message || e}`);
    }
  };
  let lastWorkspaceFlush = 0;
  const flushWorkspace = async (snapshot: Record<string, string>, force = false) => {
    const now = Date.now();
    if (!force && now - lastWorkspaceFlush < 5000) return;
    lastWorkspaceFlush = now;
    try {
      await updateRunRow(runId, { workspace: snapshot });
    } catch (e: any) {
      log.warn("harness", `workspace snapshot failed for run ${runId}: ${e?.message || e}`);
    }
  };

  // Transient provider failures must not kill the run: rotate to a fresh key,
  // and if the provider stays exhausted, fall back to another model.
  let result: RunResult | undefined;
  let lastError: any;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const provider = keyPool.modelProvider(modelId);
    const { apiKey, keyRef } = keyPool.pickKey(modelId, llmKeys);
    try {
      // Re-run of an existing row: restore its workspace so the agent resumes
      // research instead of starting from nothing.
      let initialWorkspace: Record<string, string> | undefined;
      if (o.existingRunId) {
        try {
          const row = await getRunRow(userId, o.existingRunId);
          initialWorkspace = (row?.workspace as Record<string, string> | null) ?? undefined;
        } catch {
          // row unreadable — run fresh
        }
      }
      const { tools, close } = await buildRunTools((resolved.tools ?? {}) as ToolSourcesConfig, process.env, {
        symbol,
        source,
        tavilyKey: llmKeys.tavily || undefined,
        webSearchProvider,
      });
      try {
      result = await runAgent({
        runId,
        userId,
        model: buildModel(modelId, llmKeys as LlmKeys, apiKey),
        agent,
        skills: compiled.skills,
        allowedTools: compiled.allowedTools,
        tools,
        template: compiled.template,
        systemPromptName: systemPrompt,
        symbol,
        source,
        prompt: o.promptOverride || `Analyze ${symbol} (${source}). Use the tools to gather the evidence a rigorous research report needs for ${symbol}.`,
        budget,
        grade: false,
        initialWorkspace,
        onEvent: (e) => {
          const ev = e as any;
          collector.push(ev.type, ev.taskId ?? ev.tool ?? ev.type, serverTraceFields(ev));
        },
        onCanvas: (canvas) => {
          void flushCanvas(canvas.document());
        },
        onWorkspace: (snapshot) => {
          void flushWorkspace(snapshot);
        },
      });
      } finally {
        await close();
      }
      keyPool.recordUsage({ provider, keyRef, modelId, requests: 1, tokensOut: result.budgetUsed.tokens });
      break;
    } catch (e: any) {
      lastError = e;
      const msg = String(e?.message || e);
      if (attempt >= 3 || !RETRYABLE_ERROR.test(msg)) throw e;
      keyPool.markFailure(provider, keyRef);
      const next = keyPool.getDefaultModel(llmKeys);
      log.warn("harness", `run ${agent.id} attempt ${attempt}/3 failed on ${modelId}: ${msg} — falling back to ${next || "same model"}`);
      if (next && next !== modelId) modelId = next;
      await new Promise((r) => setTimeout(r, 750 * attempt));
    }
    // `close()` is called in the inner finally above once tools are built;
    // there is no close to call if buildRunTools itself threw.
  }
  if (!result) throw lastError;
  await collector.flush().catch(() => {});
  await flushCanvas(result.document, true).catch(() => {});

  // A "partial" run is still a renderable report — COMPLETED with notes, not
  // ERROR. A run paused on an interrupt stays RUNNING (resume continues it);
  // only a run that produced nothing is ERROR.
  const paused = !!result.pendingInterrupt;
  const legacyStatus = result.status === "failed" ? "ERROR" : "COMPLETED";
  const notes = [...result.errors];
  if (result.status === "partial" && !paused) notes.unshift("some report sections could not be composed (see notes below)");
  if (result.status === "failed") notes.unshift("run produced no valid sections");
  const payload = {
    status: paused ? "RUNNING" : legacyStatus,
    symbol,
    share_name: symbol,
    agent_name: agent.name,
    model: modelId,
    source,
    report: result.verdict ? { ...result.document, verdict: result.verdict } : result.document,
    trace: [...toLegacyTrace(result.trace), usageTraceEvent(result.budgetUsed)],
    workspace: result.workspace,
    duration: Math.round((Date.now() - t0) / 1000),
    error: notes.length ? notes.join("\n") : null,
    updated_at: new Date().toISOString(),
  };
  if (o.existingRunId) {
    try {
      await updateRunRow(o.existingRunId, payload);
    } catch (e: any) {
      log.warn("harness", `final run write failed for ${o.existingRunId}: ${e?.message || e}`);
    }
    if (!result.verdict && result.status !== "failed" && !paused) void gradeInBackground(result.document, modelId, llmKeys, o.existingRunId);
    return { status: paused ? "paused" : result.status, document: result.document, errors: result.errors, verdict: result.verdict, runId: o.existingRunId };
  }
  const row: Record<string, any> = {
    id: runId,
    user_id: userId,
    ...payload,
    system_prompt: systemPrompt ?? null,
    created_at: new Date().toISOString(),
  };
  try {
    await insertRunRow(row);
  } catch (e: any) {
    throw new Error(`run persist failed: ${e?.message || e}`);
  }
  if (!result.verdict && result.status !== "failed" && !paused) void gradeInBackground(result.document, modelId, llmKeys, runId);
  return { status: paused ? "paused" : result.status, document: result.document, errors: result.errors, verdict: result.verdict, runId };
}

/** Resume a paused (interrupted) run with human decisions. */
export async function resumePausedRun(
  userId: string,
  runId: string,
  decisions: ReviewDecision[],
): Promise<HarnessRunResult | null> {
  const row = await getRunRow(userId, runId);
  if (!row) return null;
  const symbol = String(row.symbol ?? "");
  const source = String(row.source ?? "SEC");
  const systemPrompt = (row.system_prompt as string | null) ?? undefined;
  // The row keeps the agent NAME (no agent_id column) — resolve by name, fall
  // back to the user's default when the agent was deleted mid-flight.
  const agentName = String(row.agent_name ?? "");
  const agent =
    (agentName ? ((await listAgents(userId)).find((a) => a.name === agentName) ?? null) : null) ??
    (await listAgents(userId))[0];
  if (!agent) return null;

  const { llmKeys, webSearchProvider } = await fetchUserKeys(userId);
  const modelId = (row.model as string) || agent.modelId || keyPool.getDefaultModel(llmKeys);
  const { apiKey } = keyPool.pickKey(modelId, llmKeys);
  const template = getSystemPrompt(systemPrompt || "");
  const compiled = compileAgent(userId, agent, { template });
  const { config: cliCfg } = loadRunFileConfig();
  const resolved = resolveRunConfig(process.env, cliCfg);
  const { tools, close } = await buildRunTools((resolved.tools ?? {}) as ToolSourcesConfig, process.env, {
    symbol,
    source,
    tavilyKey: llmKeys.tavily || undefined,
    webSearchProvider,
  });

  const collector = new TraceCollector(runId, async (events) => {
    try {
      await updateRunRow(runId, { trace: events });
    } catch {}
  });

  const t0 = Date.now();
  let result: Awaited<ReturnType<typeof resumeAgent>>;
  try {
  result = await resumeAgent(
    {
      runId,
      userId,
      model: buildModel(modelId, llmKeys as LlmKeys, apiKey),
      agent,
      skills: compiled.skills,
      tools,
      template: compiled.template,
      systemPromptName: systemPrompt ?? undefined,
      symbol,
      source,
      onEvent: (e) => {
        const ev = e as any;
        collector.push(ev.type, ev.taskId ?? ev.tool ?? ev.type, serverTraceFields(ev));
      },
    } satisfies ResumeOptions & { onEvent: (e: HarnessTraceEvent) => void },
    decisions,
  );
  } finally {
    await close();
  }
  await collector.flush().catch(() => {});

  const legacyStatus = result.status === "failed" ? "ERROR" : "COMPLETED";
  await updateRunRow(runId, {
    status: legacyStatus,
    report: result.document,
    trace: [...toLegacyTrace(result.trace), usageTraceEvent(result.budgetUsed)],
    workspace: result.workspace,
    duration: Math.round((Date.now() - t0) / 1000),
    error: result.errors.length ? result.errors.join("\n") : null,
    updated_at: new Date().toISOString(),
  }).catch((e: any) => log.warn("harness", `resume persist failed for ${runId}: ${e?.message || e}`));
  if (!result.verdict && result.status !== "failed") void gradeInBackground(result.document, modelId, llmKeys, runId);
  return { status: result.status, document: result.document, errors: result.errors, verdict: result.verdict, runId };
}

export interface StartAnalysisRunOpts {
  userId: string;
  symbol: string;
  source: string;
  /** Raw request agent_id; absent → the user's default agent. */
  agentId?: string;
  model?: string;
  systemPrompt?: string;
  prompt?: string;
  skillIds?: string[];
  budget?: { maxSteps?: number; maxTokens?: number };
}

/**
 * Insert the placeholder row and launch the run in the background; returns the
 * run id immediately (POST /analysis responds before the run finishes, and the
 * schedule ticker fires the exact same path).
 */
export async function startAnalysisRun(o: StartAnalysisRunOpts): Promise<string> {
  let agent = o.agentId ? await getAgent(o.userId, o.agentId) : null;
  if (!agent) {
    const seeded = await listAgents(o.userId);
    agent = seeded[0] ?? (await createAgent(o.userId, DEFAULT_HARNESS_AGENT));
  }

  const runId = randomUUID();
  const runRow = {
    id: runId,
    user_id: o.userId,
    status: "RUNNING",
    symbol: o.symbol,
    share_name: o.symbol,
    agent_name: agent.name,
    model: o.model || agent.modelId || null,
    source: o.source,
    skill_ids: o.skillIds ?? null,
    system_prompt: o.systemPrompt ?? null,
    started_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  await insertRunRow(runRow);

  runHarnessSymbol(
    o.userId,
    agent.id,
    o.symbol,
    o.source,
    o.model,
    o.systemPrompt,
    { existingRunId: runId, promptOverride: o.prompt, skillIdsOverride: o.skillIds, budgetOverride: o.budget },
  ).then((result) => {
    if (!result) throw new Error("run did not start: agent not found");
  }).catch(async (e: any) => {
    console.error("background analysis run failed:", e);
    await updateRunRow(runId, { status: "ERROR", error: e?.message || "run failed" }).catch(() => {});
  });
  return runId;
}

const STALE_RUN_MS = 15 * 60 * 1000;

/** Fail analysis_runs stuck in PENDING/RUNNING (in-process runs don't survive a
 *  restart, and a hung model call would otherwise leave a run "running" forever). */
export async function sweepStaleRuns(reason: string, olderThanMs: number): Promise<void> {
  try {
    failStaleRunRows(reason, olderThanMs);
  } catch (e: any) {
    log.warn("[sweeper]", `stale-run sweep error: ${e?.message || e}`);
  }
}

/** Boot + periodic calls used by the server's listen callback. */
export function startStaleRunSweeper(): void {
  void sweepStaleRuns("Server restarted while this run was in progress.", 0);
  setInterval(() => void sweepStaleRuns("Run timed out with no progress.", STALE_RUN_MS), 60_000).unref?.();
}
