/**
 * Harness public entry — the module's one interface.
 *
 * deepagents IS the harness now: one deep agent per run (planning via
 * write_todos, native filesystem, skills by progressive disclosure,
 * human-in-the-loop interrupts), the report contract and domain tools kept
 * from the previous generation, persistence on the filesystem
 * (data/agents/**, data/skills/**) + SQLite checkpointer (data/checkpoints.db).
 *
 * Callers own the model (buildModel + key pool), the tool sources, and run
 * persistence; the same path serves the API and the CLI.
 */

// ── Engine — the run seam ───────────────────────────────────────────────────
export {
  runAgent,
  resumeAgent,
  bootTracing,
  runWorkspaceDir,
  compactWorkspace,
  lastInterruptRequests,
  type RunOptions,
  type RunResult,
  type RunStatus,
  type ResumeOptions,
  type ReviewDecision,
} from "./engine.js";

// ── Model layer (provider/model ids → LangChain models) ─────────────────────
export {
  buildModel,
  providerFor,
  modelNameFor,
  assertProviderKeyAvailable,
  type LlmKeys,
} from "./model.js";

// ── Agent definitions (file-backed) ─────────────────────────────────────────
export {
  listAgents,
  getAgent,
  createAgent,
  updateAgent,
  deleteAgent,
  harnessToView,
  viewToHarnessPatch,
  loadDefaultAgents,
  DEFAULT_AGENTS,
  DEFAULT_HARNESS_AGENT,
  HARNESS_VERSION,
  type AgentDefinition,
  type AgentInput,
  type InterruptOn,
} from "./store.js";
export { compileAgent, type CompiledAgent, type CompileOptions } from "./compile.js";
export {
  parseAgentMd,
  serializeAgentMd,
  fixAgentMarkdown,
  validateAgentV3,
  agentSchemaV3,
  type AgentConfigV3,
} from "./agentmd.js";

// ── Skills (built-ins on disk + customs as directories) ─────────────────────
export {
  loadBuiltinSkills,
  getBuiltinSkill,
  listCustomSkills,
  getCustomSkill,
  getCustomSkillFiles,
  getBuiltinSkillFiles,
  saveCustomSkill,
  deleteCustomSkill,
  resolveSkill,
  listAllSkillsForUser,
  parseSkillMarkdown,
  fixSkillMarkdown,
  normalizeSkillFiles,
  reportStructureOf,
  slugifySkillName,
  SPEC_NAME_RE,
  skillSourceDirs,
  type HarnessSkill,
  type CustomSkillRecord,
  type SkillFiles,
} from "./skills.js";
export { listRepoSkills, fetchSkillMarkdown, listSkillRepos, resolveSkillPath } from "./skill-repos.js";

// ── System prompts ──────────────────────────────────────────────────────────
export { loadSystemPrompts, getSystemPrompt, applyVariables, type SystemPrompt } from "./prompts.js";

// ── Types / trace vocabulary ────────────────────────────────────────────────
export { DEFAULT_BUDGET, clampBudget, RETRYABLE_ERROR, friendlyError, type Budget, type TraceEvent, type RunPhase } from "./types.js";
export {
  TraceMapper,
  TraceHub,
  TraceCollector,
  nextSeq,
  traceHub,
  type RunStats,
  type TraceEventType,
  type TraceRowEvent,
} from "./trace.js";

// ── Report contract + stitch ────────────────────────────────────────────────
export {
  ReportCanvas,
  validateComposed,
  type CanvasEntry,
} from "./report/canvas.js";
export {
  attachChartData,
  renderFigures,
  extractJson,
} from "./report/builder.js";
export { gradeReport, reportDigest, VERDICTS, type Verdict } from "./report/verdict.js";
export { sectionContractMarkdown, plotReferenceMarkdown } from "./report/reference.js";
export { dumpMarkdown } from "./dump.js";
export * from "./report/document.js";

// ── Tools (domain toolset + sources wiring) ─────────────────────────────────
export * from "./tools/index.js";

// ── One-shot LLM features (builder / drafters) ──────────────────────────────
export {
  processBuilderTurn,
  extractDocumentSignals,
  draftParameters,
  skillDraftTurn,
  parseJsonObject,
  type BuilderRequest,
  type BuilderResponse,
  type SkillDraftRequest,
  type SkillDraftResponse,
} from "./drafts.js";

// ── Config + market data + identity ─────────────────────────────────────────
export { loadAgentConfig, promptDoc, shouldSaveWorkspace, type AgentConfig } from "./config.js";
export { loadRunFileConfig, resolveRunConfig, type RunFileConfig, type ResolvedRunConfig, CONFIG_FILENAME } from "./run-config.js";
export { getPriceHistory, toYahooSymbol } from "./marketdata.js";
export { agentChipPng, agentSeed } from "./identity.js";

// ── Agent schema descriptor (GET /agent-schema) ─────────────────────────────
export { getSchemaDescriptor } from "./schema.js";
