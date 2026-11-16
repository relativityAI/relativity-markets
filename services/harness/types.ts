/**
 * Shared run types — the TraceEvent union is the SSE/trace contract the
 * client's timeline renders; Budget is the step/token/wall-clock cap shape.
 */

export interface Budget {
  /** Max agent loop steps (model<->tool round trips) → LangGraph recursionLimit. */
  maxSteps: number;
  /** Max output tokens across the run. */
  maxTokens: number;
  /** Wall-clock cap in ms; absent/0 = off. */
  maxMs?: number;
  /** Legacy fields — no longer used by the deepagents engine, kept so old
   *  agent rows/requests parse. */
  cbSessions: number;
  cbSessionSteps: number;
}

export const DEFAULT_BUDGET: Budget = {
  maxSteps: 20,
  maxTokens: 200_000,
  cbSessions: 3,
  cbSessionSteps: 8,
};

function clampNum(value: number | undefined, def: number, lo: number, hi: number): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return def;
  return Math.min(hi, Math.max(lo, n));
}

export function clampBudget(partial: Partial<Budget> | undefined): Budget {
  const b = { ...DEFAULT_BUDGET, ...(partial ?? {}) };
  return {
    maxSteps: clampNum(b.maxSteps, DEFAULT_BUDGET.maxSteps, 1, 200),
    maxTokens: clampNum(b.maxTokens, DEFAULT_BUDGET.maxTokens, 1_000, 2_000_000),
    ...(b.maxMs && b.maxMs > 0 ? { maxMs: b.maxMs } : {}),
    cbSessions: clampNum(b.cbSessions, DEFAULT_BUDGET.cbSessions, 1, 10),
    cbSessionSteps: clampNum(b.cbSessionSteps, DEFAULT_BUDGET.cbSessionSteps, 1, 20),
  };
}

/** Pipeline phase — groups the live timeline into human-readable stages. */
export type RunPhase = "run";

/** A single evidence event emitted by the loop; the report builder consumes these. */
export type TraceEvent =
  | { type: "thought"; text: string; agent?: string }
  | { type: "tool_call"; tool: string; toolCallId: string; args: unknown; summary?: string; agent?: string }
  | { type: "tool_result"; tool: string; toolCallId: string; status: "ok" | "error"; result: unknown; durationMs: number; summary?: string; agent?: string }
  | { type: "log"; text: string; agent?: string }
  /** Marks a pipeline stage transition for the live timeline. */
  | { type: "phase"; phase: RunPhase; label: string; detail?: string }
  /** A report_write's sections landed (or failed) on the canvas. */
  | { type: "canvas_block"; taskId: string; taskTitle: string; status: "done" | "failed"; sectionCount: number; error?: string; durationMs?: number; summary?: string; agent?: string }
  /** Workspace file count/bytes changed after a tool call (advisory). */
  | { type: "kb"; files: number; bytes: number; agent?: string };

/** Error patterns worth a fresh key/model attempt (key rotation lives in api/runs).
 *  413/"too large" is model-specific context overflow — rotation to another model fixes it. */
export const RETRYABLE_ERROR =
  /rate[-_ ]?limit|429|quota|insufficient|timeout|timed out|ECONNRESET|ECONNREFUSED|ETIMEDOUT|fetch failed|network|socket hang up|502|503|504|529|overloaded|413|too large|context length|max tokens|maximum context/i;

/** Human-facing error message: strip provider noise, keep the actionable bit. */
export function friendlyError(message: string): string {
  return String(message)
    .replace(/\s+/g, " ")
    .replace(/^Error:\s*/i, "")
    .trim()
    .slice(0, 300);
}
