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
import { alertRunFailure } from "./alerts.js";
import {
  getPlugin,
  pluginSkillIds,
  pluginsForSkills,
  selectRunSkills,
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
  type Budget,
  type ReportDocument,
  type RunResult,
  type ResumeOptions,
  type ReviewDecision,
  type RunProfile,
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
  /** Selected plugins — their skill routes mount for the run. */
  pluginIds?: string[];
  /** Explicit skill selection (New Run's checkboxes); absent = every skill
   *  of the selected plugins. */
  skillIds?: string[];
  /** Per-run MCP allowlist (server names); absent = every configured source. */
  mcpEnabled?: string[];
  budgetOverride?: { maxSteps?: number; maxTokens?: number };
}

/** Display label for a plugin selection (raw ids as the fallback). */
export function pluginLabel(pluginIds: string[]): string {
  return pluginIds.map((id) => getPlugin(id)?.display_name ?? id).filter(Boolean).join(", ");
}

/** The compile profile for a run: name + the run's chosen skills — an exact
 *  selection when one was stored (New Run's checkboxes), else every skill of
 *  the selected plugins (legacy rows fall back to their stored skill ids). */
function compileProfile(pluginIds: string[], label: string, selected?: string[] | null) {
  const ids = selected?.length
    ? [...new Set(selected)]
    : [...new Set(pluginIds.flatMap((p) => pluginSkillIds(p)))];
  return { name: label, skillIds: ids, allowedTools: [] as string[], budget: clampBudget({}) };
}

/**
 * Run a plugin-powered analysis against a symbol: compile the profile, wire
 * the data tools (websearch + MCP data tools, per-run enabled set), execute
 * the deepagents loop with key/model fallback, persist the run, and return
 * the typed document.
 */
export async function runHarnessSymbol(
  userId: string,
  symbol: string,
  source: string,
  requestedModel?: string,
  requestedSystemPrompt?: string,
  o: RunHarnessOptions = {},
): Promise<HarnessRunResult | null> {
  const t0 = Date.now();
  const pluginIds = o.pluginIds ?? [];
  const label = pluginLabel(pluginIds) || "Run";
  const profile = compileProfile(pluginIds, label, o.skillIds);

  const systemPrompt = requestedSystemPrompt || undefined;
  const template: SystemPrompt | null = getSystemPrompt(systemPrompt || "");
  const compiled = compileAgent(userId, profile, {
    template,
    vars: { symbol, title: symbol, date: new Date().toISOString().slice(0, 10), source, agent: label },
  });
  const { llmKeys, webSearchProvider } = await fetchUserKeys(userId);
  let modelId = requestedModel || keyPool.getDefaultModel(llmKeys);
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
  // MCP sources that could not connect — the run continues without them and
  // says so (trace log + run notes).
  let toolsSkipped: string[] = [];
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
      const { tools, close, skipped } = await buildRunTools((resolved.tools ?? {}) as ToolSourcesConfig, process.env, {
        symbol,
        source,
        tavilyKey: llmKeys.tavily || undefined,
        webSearchProvider,
        mcpEnabled: o.mcpEnabled,
      });
      toolsSkipped = skipped;
      try {
      result = await runAgent({
        runId,
        userId,
        model: buildModel(modelId, llmKeys as LlmKeys, apiKey),
        agent: { name: label },
        pluginIds,
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
      log.warn("harness", `run ${runId} attempt ${attempt}/3 failed on ${modelId}: ${msg} — falling back to ${next || "same model"}`);
      if (next && next !== modelId) modelId = next;
      await new Promise((r) => setTimeout(r, 750 * attempt));
    }
    // `close()` is called in the inner finally above once tools are built;
    // there is no close to call if buildRunTools itself threw.
  }
  if (!result) throw lastError;
  if (toolsSkipped.length) {
    collector.push("log", "mcp", {
      text: `Data source${toolsSkipped.length === 1 ? "" : "s"} unavailable — continuing without ${toolsSkipped.join(", ")}`,
    });
  }
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
  if (toolsSkipped.length) notes.push(`unavailable data sources: ${toolsSkipped.join(", ")} — the run continued without them`);
  const payload = {
    status: paused ? "RUNNING" : legacyStatus,
    symbol,
    share_name: symbol,
    agent_name: label,
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
    // A dead run is an alert even with no verdict to report (deduped per run).
    if (payload.status === "ERROR") void alertRunFailure(userId, o.existingRunId);
    return { status: paused ? "paused" : result.status, document: result.document, errors: result.errors, verdict: result.verdict, runId: o.existingRunId };
  }
  const row: Record<string, any> = {
    id: runId,
    user_id: userId,
    ...payload,
    plugin_ids: pluginIds,
    skill_ids: compiled.skills.map((s) => s.id),
    mcp_enabled: o.mcpEnabled ?? null,
    system_prompt: systemPrompt ?? null,
    created_at: new Date().toISOString(),
  };
  try {
    await insertRunRow(row);
  } catch (e: any) {
    throw new Error(`run persist failed: ${e?.message || e}`);
  }
  if (payload.status === "ERROR") void alertRunFailure(userId, runId);
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
  // Plugin selection is persisted on the row; rows from before plugins fall
  // back to their skill_ids (and the stored label for display continuity).
  const pluginIds = row.plugin_ids?.length ? row.plugin_ids : pluginsForSkills(row.skill_ids ?? []);
  const label = String(row.agent_name ?? "") || pluginLabel(pluginIds) || "Run";
  const profile = compileProfile(pluginIds, label, row.skill_ids);

  const { llmKeys, webSearchProvider } = await fetchUserKeys(userId);
  const modelId = (row.model as string) || keyPool.getDefaultModel(llmKeys);
  const { apiKey } = keyPool.pickKey(modelId, llmKeys);
  const template = getSystemPrompt(systemPrompt || "");
  const compiled = compileAgent(userId, profile, { template });
  const { config: cliCfg } = loadRunFileConfig();
  const resolved = resolveRunConfig(process.env, cliCfg);
  const { tools, close, skipped } = await buildRunTools((resolved.tools ?? {}) as ToolSourcesConfig, process.env, {
    symbol,
    source,
    tavilyKey: llmKeys.tavily || undefined,
    webSearchProvider,
    mcpEnabled: row.mcp_enabled ?? undefined,
  });
  if (skipped.length) {
    log.warn("harness", `resume ${runId} continuing without: ${skipped.join(", ")}`);
  }

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
      agent: { name: label },
      pluginIds,
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
  if (legacyStatus === "ERROR") void alertRunFailure(userId, runId);
  if (!result.verdict && result.status !== "failed") void gradeInBackground(result.document, modelId, llmKeys, runId);
  return { status: result.status, document: result.document, errors: result.errors, verdict: result.verdict, runId };
}

export interface StartAnalysisRunOpts {
  userId: string;
  symbol: string;
  source: string;
  /** Selected plugins (the UI requires ≥1). */
  pluginIds?: string[];
  /** Legacy skill ids — used to derive plugins when pluginIds is absent
   *  (old alert rules) and kept on the row for display. */
  skillIds?: string[];
  /** Per-run MCP allowlist (server names); absent = all configured. */
  mcpEnabled?: string[];
  model?: string;
  systemPrompt?: string;
  prompt?: string;
  budget?: { maxSteps?: number; maxTokens?: number };
}

/**
 * Insert the placeholder row and launch the run in the background; returns the
 * run id immediately (POST /analysis responds before the run finishes, and the
 * schedule ticker fires the exact same path).
 */
export async function startAnalysisRun(o: StartAnalysisRunOpts): Promise<string> {
  // Old alert rules carry skills, not plugins — derive their plugins here so
  // scheduled legacy runs keep loading the right skills.
  const pluginIds = o.pluginIds?.length ? o.pluginIds : pluginsForSkills(o.skillIds ?? []);
  const label = pluginLabel(pluginIds) || "Legacy";
  // The requested skills are the run's selection (filtered to the plugins);
  // absent → every skill of the plugins.
  const skillIds = selectRunSkills(pluginIds, o.skillIds);

  const runId = randomUUID();
  const runRow = {
    id: runId,
    user_id: o.userId,
    status: "RUNNING",
    symbol: o.symbol,
    share_name: o.symbol,
    agent_name: label,
    model: o.model || null,
    source: o.source,
    skill_ids: skillIds.length ? skillIds : (o.skillIds ?? null),
    plugin_ids: pluginIds,
    mcp_enabled: o.mcpEnabled ?? null,
    system_prompt: o.systemPrompt ?? null,
    started_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  await insertRunRow(runRow);

  runHarnessSymbol(
    o.userId,
    o.symbol,
    o.source,
    o.model,
    o.systemPrompt,
    { existingRunId: runId, promptOverride: o.prompt, pluginIds, skillIds, mcpEnabled: o.mcpEnabled, budgetOverride: o.budget },
  ).then((result) => {
    if (!result) throw new Error("run did not start");
  }).catch(async (e: any) => {
    console.error("background analysis run failed:", e);
    await updateRunRow(runId, { status: "ERROR", error: e?.message || "run failed" }).catch(() => {});
    void alertRunFailure(o.userId, runId);
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
