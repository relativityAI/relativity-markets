import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── server-side LLM key pools (multiple keys per provider for rotation) ──
// No keys are configured by default: users add their own in Settings. These
// env vars remain available for optional server-side pools.

export const LLM_PROVIDERS = [
  "openai",
  "gemini",
  "anthropic",
  "cerebras",
  "groq",
  "openrouter",
  // Free-tier providers (no credit card needed) — supported in buildModel +
  // discovery so users can add a free key in Settings instead of a paid one:
  "mistral", // La Plateforme free "Experiment" tier (~1 req/s)
  "nvidia", // NVIDIA NIM free tier (40 RPM, 1k free credits on signup)
  "cohere", // Cohere trial keys (20 RPM, 1k calls/month)
  "zai", // Z.AI GLM Flash models (free, ~1k RPD)
  "opencode", // OpenCode Console (Go subscription or pay-as-you-go credits)
] as const;

/** Parse a comma-separated env value into a trimmed, non-empty array. */
export function parseCsv(value: string | undefined): string[] {
  return (value || "").split(",").map((s) => s.trim()).filter(Boolean);
}

/**
 * Server-provided LLM keys per provider. Sources, in order:
 *   PROVIDER_API_KEYS  -> "k1,k2" (multiple keys → rotation/quota pool)
 *   PROVIDER_API_KEY   -> legacy single-key fallback
 */
export function parseServerKeys(env: Record<string, string | undefined> = process.env as any): Record<string, string[]> {
  const pools: Record<string, string[]> = {};
  for (const p of LLM_PROVIDERS) {
    const upper = p.toUpperCase();
    const keys = parseCsv(env[`${upper}_API_KEYS`]);
    const legacy = env[`${upper}_API_KEY`];
    if (keys.length) pools[p] = keys;
    else if (legacy) pools[p] = [legacy];
  }
  return pools;
}

/**
 * Explicit model lists for keyed providers (PROVIDER_MODELS). When empty for a
 * keyed provider, the curated models.yaml entries for that provider are used.
 */
export function parseServerModels(env: Record<string, string | undefined> = process.env as any): Record<string, string[]> {
  const models: Record<string, string[]> = {};
  for (const p of LLM_PROVIDERS) {
    const list = parseCsv(env[`${p.toUpperCase()}_MODELS`]);
    if (list.length) models[p] = list;
  }
  return models;
}

export const DEFAULT_DAILY_REQUESTS: Record<string, number> = {
  gemini: 1500,
  groq: 7200,
  cerebras: 1440,
  openrouter: 1000,
  openai: 500,
  anthropic: 500,
  // Free-tier providers (no credit card). Caps mirror each provider's
  // published free-tier daily limits (researched Sep 2026).
  mistral: 20000, // ~1 req/s free Experiment tier
  nvidia: 5000, // 40 RPM free tier (~1,000 free credits)
  cohere: 33, // trial key: 1,000 calls/month ≈ 33/day
  zai: 1000, // GLM Flash free tier
  opencode: 5000, // Go plan: DeepSeek V4.1 Flash ~173k req/month allowance
};

/** Per-provider daily request caps used by the quota algorithm ({PROVIDER}_DAILY_REQUESTS). */
export function parseDailyCaps(env: Record<string, string | undefined> = process.env as any): Record<string, number> {
  const caps: Record<string, number> = {};
  for (const p of LLM_PROVIDERS) {
    const n = Number(env[`${p.toUpperCase()}_DAILY_REQUESTS`]);
    caps[p] = Number.isFinite(n) && n > 0 ? n : DEFAULT_DAILY_REQUESTS[p];
  }
  return caps;
}

export const config = {
  port: Number(process.env.PORT || 8501),
  // Scoring must be deterministic (plan 0.4/A6): the LLM quant judge is OFF
  // unless explicitly enabled with QUANT_LLM_JUDGE=1. Lazy so tests and
  // late-set env vars are honored.
  get quantLlmJudge() {
    return process.env.QUANT_LLM_JUDGE === "1";
  },
  // Quant soft-decay change (D3): spread = max(|t|×0.5, metric.minSpread),
  // default OFF until sign-off. Keeps v1 decay (|t|×0.5 only) when unset.
  get quantSpreadV2() {
    return process.env.QUANT_SPREAD_V2 === "1";
  },
  // Rubric compiler model (plan D1): strong LLM that decomposes qualitative
  // parameters into atomic criteria. Unset → strongest configured model.
  get rubricCompilerModel() {
    return process.env.RUBRIC_COMPILER_MODEL || "";
  },
  // Local-first storage: one SQLite file (env SQLITE_PATH; relative = services/ cwd).
  sqlitePath: process.env.SQLITE_PATH || "data/relativity.db",
  // AUTH_MODE: "local" is the default (single default user, no sign-in).
  // "supabase" opts back into the legacy cloud login (JWT via JWKS).
  authMode: (process.env.AUTH_MODE as "local" | "supabase") || "local",
  localUser: {
    id: process.env.LOCAL_USER_ID || "local",
    email: "default@localhost",
    name: "Default User",
  },
  // Supabase (auth only — JWT verification via JWKS; data lives in Postgres)
  supabaseProjectUrl: process.env.SUPABASE_PROJECT_URL || "",
  supabaseUrl: process.env.SUPABASE_URL || "",
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
  // AES-256-GCM key for encrypting stored API keys (64 hex chars = 32 bytes)
  encryptionKey: process.env.ENCRYPTION_KEY || "",
  // Server-side LLM key pools + model lists + daily caps (multiple keys per provider)
  serverKeys: parseServerKeys(),
  serverModels: parseServerModels(),
  dailyCaps: parseDailyCaps(),
  // Paths
  assetsDir: path.resolve(__dirname, "..", "assets"),
  taxonomyDir: path.resolve(__dirname, "..", "taxonomy", "data"),
  modelsFile: path.resolve(__dirname, "..", "config", "models.yaml"),
  // The output format is the harness's one file: harness/config/prompts/AGENTS.md.
  // Limits
  maxToolSteps: 10,
  // Per-run budgets for the skill/iterative agent path (the harness path has
  // its own per-agent budget). "calls" = model steps (tool round-trips).
  agentMaxSteps: Number(process.env.AGENT_MAX_STEPS || 40),
  agentMaxTokens: Number(process.env.AGENT_MAX_TOKENS || 200_000),
  rateLimitPerMin: 10,
  // The yfinance MCP server is the harness agent's market-data toolbox
  // (streamable HTTP, tool list re-fetched each run).
  mcpYfinanceUrl: process.env.MCP_YFINANCE_URL || "",
};
