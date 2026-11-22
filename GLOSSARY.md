# Glossary

Domain language for the Relativity codebase. Architecture vocabulary (module,
interface, depth, seam, adapter, leverage, locality) comes from the
codebase-design skill, not from here.

## Harness (the research runtime)

- **Harness** — the research module at `services/harness/`, built ON the
  [DeepAgents SDK](https://docs.langchain.com/oss/javascript/deepagents/overview)
  (`createDeepAgent`): the SDK owns the tool-calling loop, the virtual
  filesystem, skills (progressive disclosure), planning (`write_todos`),
  summarization/context offloading, and human-in-the-loop interrupts. Our code
  wraps it: the model factory, the domain tools, the report contract, and the
  run lifecycle. One public interface: `services/harness/index.ts` (the barrel).
- **Engine** — `harness/engine.ts`: one deep agent per run (`createDeepAgent`
  with the run's model, tools, skills, per-run filesystem backend, SQLite
  checkpointer) + the stitch (canvas → `ReportDocument`) and the completion
  gates. `runAgent` / `resumeAgent` are the seams; `relativity/report.v2` in
  the report schema and `*-v2` skill ids are unrelated.
- **Planning** — the SDK's `todoListMiddleware` (`write_todos`): the agent
  authors and maintains its own task list; the completion gate ships a run
  whose todos are still open as PARTIAL.
- **Verdict** — the five-band run rating (Very Poor … Excellent) from one LLM
  grading call (`gradeReport`) after the stitch; the API grades in the
  background once the report is already persisted.
- **Canvas** — the in-memory report (`report/canvas.ts`): section-groups are
  appended via the agent's `report_write` tool calls, validated by
  `validateComposed`; `canvas.document()` assembles the ReportDocument.
- **Workspace** — the run's filesystem: `data/runs/<runId>/workspace/` through
  the SDK's `FilesystemBackend` (native `ls/read_file/write_file/edit_file/
  glob/grep`). Large tool results offload automatically (`/large_tool_results/`);
  the compacted snapshot persists into `analysis_runs.workspace`.
- **Evidence** — sourced facts backing a number. A note cites `[src:id]`; a
  chart needs a series-bearing tool result. Coverage is assessed from evidence,
  never from the model's own TODO list.
- **Trace** — the ordered event stream a run emits (thought, tool_call,
  tool_result, phase, canvas_block, log), mapped from the SDK's stream by
  `harness/trace.ts`. `canvas_block` = a section written to the report. The
  timeline UI and the report builder both consume it.
- **Budget** — per-run limits (`types.ts`): `maxSteps` → the graph's
  recursion limit (×2+2 for model+tools super-steps), `maxTokens`, and the
  API's `maxMs` wall-clock backstop. Time-pressure reminders (middleware)
  push the agent from research to writing at 50%/80%.

### Persistence

- **Plugins** — one directory per plugin (`harness/plugins.ts`):
  `config/plugins/<id>/` (Relativity built-ins, read-only) and
  `data/plugins/<id>/` (custom/imported). Layout is the Claude plugin shape —
  `plugin.json` + `skills/<skill>/SKILL.md`. Editable metadata (sources, tags,
  version, disclaimer) lives in the `plugins` SQLite row; files stay on disk
  and mount as the run's deepagents skill sources. Every skill in the app
  lives inside a plugin; custom saves land in the implicit `my-skills` plugin.
- **Runs** — `analysis_runs.plugin_ids` records the plugins a run used
  (`skill_ids` mirrors their skills); `mcp_enabled` records the per-run MCP
  allowlist. Rows predating plugins are backfilled from their skill ids once
  at boot (`initPlugins`).
- **Checkpointer** — SQLite (`data/checkpoints.db`) via LangGraph: runs are
  resumable, interrupts survive a restart. Legacy runs live in
  `analysis_runs` (SQLite) as before.
- **Export** — `npm run export-legacy-store` copies legacy DB agents/skills
  into the file store, one-time and idempotent.

### Adjacent, not the harness

- **Output template** — a named presentation spec (`harness/assets/prompts/*.md`:
  structure, tone, min_charts, section_order). Format only — it never changes
  the analysis.
- **Skill** — an agentskills.io `SKILL.md`: tool mechanics the agent may use.
  Distinct from the soul prompt (judgment) and the output template (format).
- **Tracing** — Langfuse via `@langfuse/langchain`'s callback handler
  (`harness/tracing.ts`): attached to every run when env keys are present,
  zero overhead otherwise; self-hostable.
