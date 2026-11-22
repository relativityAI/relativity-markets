/**
 * CLI — run a harness agent against a symbol from the terminal.
 *
 *   npx tsx harness/cli.ts --symbol RELIANCE [--model id] [--skill id]
 *                          [--source NSE|SEC] [--system-prompt name]
 *                          [--max-steps N] [--max-tokens N] [--save-workspace]
 *
 * Config precedence: flags > HARNESS_* env > harness.config.json > built-ins.
 * Output: runs/<runId>/<runId>.md + trace.json (+ workspace/ when saving).
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { buildModel, ENV_KEYS, type LlmKeys } from "./model.js";
import { runAgent, bootTracing, compactWorkspace } from "./engine.js";
import { compileAgent, type CompileProfile } from "./compile.js";
import { loadBuiltinSkills, resolveSkill } from "./skills.js";
import { pluginsForSkills } from "./plugins.js";
import { buildRunTools, type ToolSourcesConfig } from "./tools/index.js";
import { loadRunFileConfig, resolveRunConfig } from "./run-config.js";
import { getSystemPrompt } from "./prompts.js";
import { clampBudget } from "./types.js";
import { dumpMarkdown } from "./dump.js";
import { agentSeed } from "./identity.js";

// Tracing (no-op without env keys).
void bootTracing();

function parseFlags(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) out[key] = true;
    else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv);
  const symbol = String(flags.symbol ?? "").trim();
  if (!symbol) {
    console.error("usage: npx tsx harness/cli.ts --symbol <TICKER> [--model id] [--skill id] [--source NSE|SEC]");
    process.exit(1);
  }
  const { config: fileCfg } = loadRunFileConfig();
  const env = process.env;
  const resolved = resolveRunConfig(env, fileCfg);

  const modelId = String(flags.model ?? resolved.model);
  const source = String(flags.source ?? resolved.source).toUpperCase();
  const skillId = String(flags.skill ?? resolved.skills[0] ?? "").trim() || undefined;
  const systemPromptName = flags["system-prompt"] ? String(flags["system-prompt"]) : undefined;

  // Keys: env only (server pools belong to the API).
  const llmKeys: LlmKeys = {
    openai: ENV_KEYS.openai,
    gemini: ENV_KEYS.gemini,
    anthropic: ENV_KEYS.anthropic,
    cerebras: ENV_KEYS.cerebras,
    groq: ENV_KEYS.groq,
    openrouter: ENV_KEYS.openrouter,
    mistral: ENV_KEYS.mistral,
    nvidia: ENV_KEYS.nvidia,
    cohere: ENV_KEYS.cohere,
    zai: ENV_KEYS.zai,
    opencode: ENV_KEYS.opencode,
  };

  const userId = "cli";
  // Skills: --skill flag, else the config default list. The CLI is
  // plugin-agnostic — skill → plugin resolution mounts the right routes.
  const skillIds = skillId ? [skillId] : resolved.skills;
  const firstResolved = skillId ? resolveSkill(userId, skillId) : null;
  if (skillId && !firstResolved) {
    const known = loadBuiltinSkills().map((s) => s.id).join(", ");
    throw new Error(`skill "${skillId}" not found — built-ins: ${known}`);
  }

  const profile: CompileProfile = {
    name: "cli",
    skillIds,
    allowedTools: [],
    budget: clampBudget({
      ...(flags["max-steps"] ? { maxSteps: Number(flags["max-steps"]) } : {}),
      ...(flags["max-tokens"] ? { maxTokens: Number(flags["max-tokens"]) } : {}),
    }),
  };

  const runId = randomUUID();
  const seed = agentSeed(profile.name);

  const compiled = compileAgent(userId, profile, {
    template: getSystemPrompt(systemPromptName ?? ""),
    vars: { symbol, title: symbol, date: new Date().toISOString().slice(0, 10), source, agent: profile.name },
  });
  const pluginIds = pluginsForSkills(compiled.skills.map((s) => s.id));
  console.log(`run ${runId} — ${profile.name} · ${modelId} · ${symbol} (${source})${compiled.skills.length ? ` · skills ${compiled.skills.map((s) => s.id).join(", ")}` : ""} · seed ${seed}`);
  const { tools, close } = await buildRunTools((resolved.tools ?? {}) as ToolSourcesConfig, env, { symbol, source });
  try {
  const result = await runAgent({
    runId,
    userId,
    model: buildModel(modelId, llmKeys),
    agent: { name: profile.name },
    pluginIds,
    skills: compiled.skills,
    allowedTools: compiled.allowedTools,
    tools,
    template: compiled.template,
    systemPromptName,
    symbol,
    source,
    prompt: `Analyze ${symbol} (${source}). Use the tools to gather the evidence a rigorous research report needs for ${symbol}.`,
    budget: profile.budget,
    saveWorkspace: flags["save-workspace"] === true,
    onEvent: (e) => {
      const t = e.type;
      if (t === "tool_call") console.log(`  → ${e.tool}(${JSON.stringify(e.args).slice(0, 120)})`);
      else if (t === "tool_result") console.log(`  ← ${e.tool} ${e.status === "ok" ? "ok" : "ERR"} ${e.durationMs}ms`);
      else if (t === "canvas_block") console.log(`  ■ ${e.summary ?? "sections written"}`);
      else if (t === "log") console.log(`  · ${e.text}`);
    },
  });

  const dir = join(process.cwd(), "runs", runId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${runId}.md`), dumpMarkdown(result.document));
  writeFileSync(join(dir, `${runId}.json`), JSON.stringify(result.document, null, 2));
  if (result.workspaceFull) {
    for (const [path, content] of Object.entries(result.workspaceFull)) {
      const dest = join(dir, "workspace", path.replace(/^\/+/, ""));
      mkdirSync(join(dest, ".."), { recursive: true });
      writeFileSync(dest, content);
    }
  } else {
    for (const [path, content] of Object.entries(result.workspace)) {
      const dest = join(dir, "workspace", path.replace(/^\/+/, ""));
      mkdirSync(join(dest, ".."), { recursive: true });
      writeFileSync(dest, content);
    }
  }
  console.log(`\nstatus: ${result.status}${result.errors.length ? ` — ${result.errors.join(" | ")}` : ""}`);
  if (result.verdict) console.log(`verdict: ${result.verdict}`);
  console.log(`stats: ${result.budgetUsed.steps} steps · ${result.budgetUsed.toolCalls} tool calls · ${result.budgetUsed.tokens} out tokens`);
  console.log(`output: ${join(dir, `${runId}.md`)}`);
  } finally {
    await close();
  }
}

main().catch((e) => {
  console.error(e?.message || e);
  process.exit(1);
});
