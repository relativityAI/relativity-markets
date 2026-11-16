/**
 * deepagents/LangGraph stream → TraceEvent mapping.
 *
 * One mapper per run. Feed it every `agent.stream(..., { streamMode:
 * "updates" })` chunk; it emits the same event vocabulary the old harness
 * produced (thought / tool_call / tool_result / canvas_block), so the SSE
 * hub, the persisted trace, and every client timeline keep working unchanged.
 *
 * Interrupt chunks (human-in-the-loop) surface as a phase event naming the
 * pending tool — the API layer reads `__interrupt__` itself for the resume
 * flow; the trace only narrates it.
 */

import { AIMessage, ToolMessage } from "@langchain/core/messages";
import type { TraceEvent } from "./types.js";
export type { TraceEvent };

export interface RunStats {
  steps: number;
  /** Output tokens (budget currency). */
  tokens: number;
  inputTokens: number;
  /** Highest single-step input. */
  peakInput: number;
  toolCalls: number;
}

export class TraceMapper {
  readonly events: TraceEvent[] = [];
  private readonly pending = new Map<string, { tool: string; t0: number; args: unknown }>();
  private lastThoughtText = "";
  stats: RunStats = { steps: 0, tokens: 0, inputTokens: 0, peakInput: 0, toolCalls: 0 };

  constructor(private readonly emit: (e: TraceEvent) => void) {}

  /** Consume one updates-mode chunk (or any chunk shape carrying messages). */
  feed(chunk: unknown): void {
    if (!chunk || typeof chunk !== "object") return;

    // Interrupt: narrate the pending approval(s) for the timeline — ONE event
    // carrying the full actionRequests array (the resume flow parses it back).
    const interrupt = (chunk as Record<string, unknown>)["__interrupt__"];
    if (Array.isArray(interrupt)) {
      const requests: { name: string; args: unknown }[] = [];
      for (const it of interrupt) {
        for (const req of (it as any)?.value?.actionRequests ?? []) {
          requests.push({ name: String(req?.name ?? "tool"), args: req?.args });
        }
      }
      if (requests.length) {
        this.push({
          type: "phase",
          phase: "run",
          label: `Awaiting approval — ${requests.map((r) => r.name).join(", ")}`,
          // Full JSON — lastInterruptRequests() parses this back for the resume UI.
          detail: JSON.stringify(requests),
        });
      }
      return;
    }

    // updates mode: { [nodeName]: { messages: [...] } } — walk every node value.
    for (const value of Object.values(chunk as Record<string, unknown>)) {
      if (!value || typeof value !== "object") continue;
      const messages = (value as { messages?: unknown[] }).messages;
      if (!Array.isArray(messages)) continue;
      for (const message of messages) {
        if (message instanceof AIMessage) this.aiMessage(message);
        else if (message instanceof ToolMessage) this.toolMessage(message);
      }
    }
  }

  private aiMessage(msg: AIMessage): void {
    this.stats.steps += 1;
    const usage = msg.usage_metadata as { input_tokens?: number; output_tokens?: number } | undefined;
    if (usage) {
      const inTok = Number(usage.input_tokens ?? 0);
      const outTok = Number(usage.output_tokens ?? 0);
      this.stats.inputTokens += inTok;
      this.stats.tokens += outTok;
      if (inTok > this.stats.peakInput) this.stats.peakInput = inTok;
    }
    const text = typeof msg.content === "string" ? msg.content.trim() : textFromBlocks(msg.content);
    if (text && text !== this.lastThoughtText) {
      this.lastThoughtText = text;
      this.push({ type: "thought", text: text.slice(0, 4_000) });
    }
    for (const call of msg.tool_calls ?? []) {
      if (!call?.id || !call?.name) continue;
      this.pending.set(call.id, { tool: call.name, t0: Date.now(), args: call.args });
      this.stats.toolCalls += 1;
      this.push({ type: "tool_call", tool: call.name, toolCallId: call.id, args: call.args });
    }
  }

  private toolMessage(msg: ToolMessage): void {
    const call = this.pending.get(msg.tool_call_id);
    const tool = (msg as { name?: string }).name || call?.tool || msg.tool_call_id;
    const durationMs = call ? Date.now() - call.t0 : 0;
    this.pending.delete(msg.tool_call_id);
    const result = parseResult(msg.content);
    const status: "ok" | "error" = msg.status === "error" ? "error" : "ok";
    this.push({
      type: "tool_result",
      tool,
      toolCallId: msg.tool_call_id,
      status,
      result,
      durationMs,
      ...(status === "error" ? { summary: friendlyToolError(result) } : {}),
    });
    // report_write lands sections on the canvas — same event vocabulary the
    // old canvas engine emitted so both read identically on a timeline.
    if (tool === "report_write" && status === "ok" && (result as any)?.added > 0) {
      const r = result as { added: number; rejected?: unknown[] };
      this.push({
        type: "canvas_block",
        taskId: tool,
        taskTitle: "report section",
        status: "done",
        sectionCount: r.added,
        summary: r.rejected?.length ? `${r.added} sections · ${r.rejected.length} rejected` : `${r.added} sections written`,
      });
    }
  }

  private push(e: TraceEvent): void {
    this.events.push(e);
    this.emit(e);
  }
}

function textFromBlocks(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .map((b) => (b && typeof b === "object" && (b as any).type === "text" ? String((b as any).text ?? "") : ""))
    .join("")
    .trim();
}

/** ToolMessage content → the JSON the trace/report builder expects. */
function parseResult(content: unknown): unknown {
  if (typeof content !== "string") return content;
  try {
    return JSON.parse(content);
  } catch {
    return content;
  }
}

function friendlyToolError(result: unknown): string {
  const text = typeof result === "string" ? result : JSON.stringify(result ?? "");
  return text.slice(0, 300);
}

// ── SSE plumbing (the API's live timeline) ──────────────────────────────────

import { EventEmitter } from "node:events";

export type TraceEventType =
  | "thought"
  | "tool_call"
  | "tool_result"
  | "decision"
  | "step"
  | "log"
  | "phase"
  | "kb"
  | "canvas_block"
  | "usage";

/** The persisted/SSE trace row shape (snake_case) the client timeline reads. */
export interface TraceRowEvent {
  seq: number;
  ts: number;
  type: TraceEventType;
  key: string;
  text?: string;
  tool?: string;
  tool_call_id?: string;
  args?: unknown;
  result?: unknown;
  status?: "pending" | "running" | "completed" | "degraded" | "failed" | "skipped" | "OK" | "ERR";
  duration_ms?: number;
  score?: number;
  value?: unknown;
  label?: string;
  summary?: string;
  error?: string;
  phase?: string;
}

const BUFFER_CAP = 1024;

/**
 * In-process pub/sub that relays trace events to SSE subscribers. Keeps a
 * small per-run ring buffer so a subscriber connecting mid-run can replay
 * events it should not miss.
 */
export class TraceHub {
  private readonly emitter = new EventEmitter();
  private readonly buffers = new Map<string, TraceRowEvent[]>();

  subscribe(runId: string, listener: (event: TraceRowEvent) => void): () => void {
    const buffered = this.buffers.get(runId);
    if (buffered) {
      for (const ev of buffered) listener(ev);
    }
    this.emitter.on(runId, listener);
    return () => this.emitter.off(runId, listener);
  }

  publish(runId: string, event: TraceRowEvent): void {
    let buf = this.buffers.get(runId);
    if (!buf) {
      buf = [];
      this.buffers.set(runId, buf);
    }
    buf.push(event);
    if (buf.length > BUFFER_CAP) buf.splice(0, buf.length - BUFFER_CAP);
    this.emitter.emit(runId, event);
  }

  reset(runId: string): void {
    this.buffers.delete(runId);
    this.emitter.removeAllListeners(runId);
  }
}

export const traceHub = new TraceHub();

let seq = 0;
export function nextSeq(): number {
  return ++seq;
}

/**
 * Per-run trace collector: keeps the full event list in memory, publishes
 * every event to the hub for live SSE delivery, and persists to the DB on a
 * throttle (so a burst of reasoning deltas doesn't hammer SQLite) plus on
 * finalize.
 */
export class TraceCollector {
  private readonly events: TraceRowEvent[] = [];
  private dirty = false;
  private timer: NodeJS.Timeout | null = null;
  private lastPersist = 0;
  private persistTail: Promise<void> = Promise.resolve();

  constructor(
    private readonly runId: string,
    private readonly persist: (events: TraceRowEvent[]) => Promise<void>,
    private readonly throttleMs = 1500,
  ) {}

  push(
    type: TraceEventType,
    key: string,
    fields: Omit<TraceRowEvent, "seq" | "ts" | "type" | "key"> = {},
  ): TraceRowEvent {
    const event: TraceRowEvent = { seq: nextSeq(), ts: Date.now(), type, key, ...fields };
    this.events.push(event);
    traceHub.publish(this.runId, event);
    this.schedulePersist();
    return event;
  }

  snapshot(): TraceRowEvent[] {
    return this.events.slice();
  }

  private schedulePersist(): void {
    this.dirty = true;
    if (this.timer) return;
    const elapsed = Date.now() - this.lastPersist;
    const wait = Math.max(0, this.throttleMs - elapsed);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, wait);
  }

  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.dirty) return;
    this.dirty = false;
    this.lastPersist = Date.now();
    const snapshot = this.snapshot();
    this.persistTail = this.persistTail.catch(() => {}).then(() => this.persist(snapshot));
    await this.persistTail;
  }
}
