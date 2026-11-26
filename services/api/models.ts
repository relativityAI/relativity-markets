import { readFileSync } from "node:fs";
import YAML from "yaml";
import { config } from "./config.js";
import { log } from "./logger.js";
import { CUSTOM_KEY, customProviders } from "../harness/model.js";

export interface ModelEntry {
  id: string;
  provider: string;
  name: string;
  priority: number;
}

let cache: ModelEntry[] | null = null;

export function getModels(): ModelEntry[] {
  if (!cache) {
    const raw = readFileSync(config.modelsFile, "utf8");
    const parsed = YAML.parse(raw) as { models: ModelEntry[] };
    cache = (parsed.models || [])
      .slice()
      .sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999));
  }
  return cache;
}

export function getModelIds(): string[] {
  return getModels().map((m) => m.id);
}

// Every provider needs an API key added in Settings. "Free tier" means no
// credit card, not no key — with no keys added, no models are available.

// ── Dynamic model discovery ──────────────────────────────────────────

/**
 * OpenRouter `:free` models that exist in the catalog but are unusable here,
 * excluded from both the curated YAML list and live free-tier discovery:
 *   * thinkingmachines/inkling* — HTTP 403, restricted to OpenRouter's own
 *     agentic harness apps (coding agents / productivity apps on openrouter.ai)
 *   * nvidia/nemotron-3.5-content-safety — guardrail/moderation model, not a
 *     general chat model
 */
const OPENROUTER_FREE_EXCLUDED = new Set([
  "thinkingmachines/inkling:free",
  "thinkingmachines/inkling-small:free",
  "thinkingmachines/inkling-2-small:free",
  "nvidia/nemotron-3.5-content-safety:free",
]);

const PROVIDER_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const providerModelCache = new Map<string, { models: string[]; fetchedAt: number }>();

interface ProviderEndpoint {
  url: string;
  headers: (apiKey: string) => Record<string, string>;
  extractModels: (data: any) => string[];
  prefix: string;
}

const PROVIDER_ENDPOINTS: Record<string, ProviderEndpoint> = {
  openai: {
    url: "https://api.openai.com/v1/models",
    headers: (k) => ({ Authorization: `Bearer ${k}` }),
    extractModels: (d) =>
      (d?.data || [])
        .filter((m: any) => m.id && !m.id.includes("embedding") && !m.id.includes("tts") && !m.id.includes("whisper") && !m.id.includes("dall-e") && !m.id.includes("moderation"))
        .map((m: any) => m.id),
    prefix: "openai",
  },
  gemini: {
    url: "https://generativelanguage.googleapis.com/v1beta/models",
    headers: () => ({}),
    extractModels: (d) =>
      (d?.models || [])
        .filter((m: any) => m.name && m.supportedGenerationMethods?.includes("generateContent"))
        .map((m: any) => {
          const name = String(m.name).replace(/^models\//, "");
          return name;
        }),
    prefix: "gemini",
  },
  groq: {
    url: "https://api.groq.com/openai/v1/models",
    headers: (k) => ({ Authorization: `Bearer ${k}` }),
    extractModels: (d) => (d?.data || []).map((m: any) => m.id),
    prefix: "groq",
  },
  cerebras: {
    url: "https://api.cerebras.ai/v1/models",
    headers: (k) => ({ Authorization: `Bearer ${k}` }),
    extractModels: (d) => (d?.data || []).map((m: any) => m.id),
    prefix: "cerebras",
  },
  openrouter: {
    url: "https://openrouter.ai/api/v1/models",
    headers: (k) => ({ Authorization: `Bearer ${k}` }),
    extractModels: (d) => (d?.data || []).map((m: any) => m.id),
    prefix: "openrouter",
  },
  anthropic: {
    url: "https://api.anthropic.com/v1/models",
    headers: (k) => ({
      "x-api-key": k,
      "anthropic-version": "2023-06-01",
    }),
    extractModels: (d) => (d?.data || []).map((m: any) => m.id),
    prefix: "anthropic",
  },
  // Free-tier providers (no credit card needed for an API key).
  mistral: {
    url: "https://api.mistral.ai/v1/models",
    headers: (k) => ({ Authorization: `Bearer ${k}` }),
    extractModels: (d) =>
      (d?.data || [])
        .filter((m: any) => m.id && !m.id.includes("embed") && !m.id.includes("ocr") && !m.id.includes("moderation") && m.capabilities?.completion_chat !== false)
        .map((m: any) => m.id),
    prefix: "mistral",
  },
  nvidia: {
    url: "https://integrate.api.nvidia.com/v1/models",
    headers: (k) => ({ Authorization: `Bearer ${k}` }),
    extractModels: (d) =>
      (d?.data || [])
        .filter((m: any) => {
          const id = String(m.id || "");
          // NIM serves embedding/rerank/vision-only endpoints too; keep chat models.
          return id && !/embed|rerank|nv-embed|clip|ocr|guard|nemoretriever/i.test(id);
        })
        .map((m: any) => m.id),
    prefix: "nvidia",
  },
  cohere: {
    url: "https://api.cohere.ai/compatibility/v1/models",
    headers: (k) => ({ Authorization: `Bearer ${k}` }),
    extractModels: (d) =>
      (d?.data || [])
        .filter((m: any) => m.id && !/embed|rerank/i.test(String(m.id)))
        .map((m: any) => m.id),
    prefix: "cohere",
  },
  zai: {
    url: "https://api.z.ai/api/paas/v4/models",
    headers: (k) => ({ Authorization: `Bearer ${k}` }),
    extractModels: (d) =>
      (d?.data || d?.models || [])
        .map((m: any) => String(m.id || m.model || ""))
        .filter(Boolean),
    prefix: "zai",
  },
};

async function fetchProviderModels(
  provider: string,
  apiKey: string,
  opts: {
    /** Keep only raw (unprefixed) model ids matching this predicate. */
    filter?: (id: string) => boolean;
    /** Cache key when one provider is fetched with different filters. */
    cacheKey?: string;
  } = {},
): Promise<string[]> {
  const endpoint = PROVIDER_ENDPOINTS[provider];
  if (!endpoint) return [];

  const cacheKey = opts.cacheKey ?? provider;
  // Check cache
  const cached = providerModelCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < PROVIDER_CACHE_TTL_MS) {
    return cached.models;
  }

  try {
    let url = endpoint.url;
    // Gemini uses query param for auth
    if (provider === "gemini") {
      url += `?key=${apiKey}`;
    }

    const res = await fetch(url, {
      headers: {
        ...endpoint.headers(apiKey),
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      log.warn("[models]", `${provider} model list failed: ${res.status}`);
      return [];
    }

    const data = await res.json();
    const rawIds = endpoint.extractModels(data).filter((id) => !opts.filter || opts.filter(id));

    // Add provider prefix if not already present
    const prefixed = rawIds.map((id: string) =>
      id.startsWith(`${endpoint.prefix}/`) ? id : `${endpoint.prefix}/${id}`,
    );

    providerModelCache.set(cacheKey, { models: prefixed, fetchedAt: Date.now() });
    log.info("[models]", `${cacheKey}: discovered ${prefixed.length} models`);
    return prefixed;
  } catch (e: any) {
    log.warn("[models]", `${provider} model list error: ${e?.message || e}`);
    return [];
  }
}

/**
 * Get available models for a user based on the keys they added in Settings.
 * With no keys, the list is empty. Each keyed provider contributes its curated
 * models plus live discovery from that provider's /models API. Curated models
 * come first (priority order), then live-only models (alphabetical).
 * Server-side key pools are still supported when configured via env, but this
 * deployment keeps no default keys.
 */
export async function getAvailableModelsForUser(
  llmKeys: Record<string, string>,
): Promise<string[]> {
  // User-added OpenAI-compatible providers: their declared model list, prefixed
  // with the id so they route exactly like a built-in provider.
  const custom = customProviders(llmKeys);

  const userProviders = Object.entries(llmKeys)
    .filter(([k, v]) => k !== CUSTOM_KEY && !!v)
    .map(([k]) => k);
  const serverProviders = Object.keys(config.serverKeys).filter((p) => config.serverKeys[p]?.length);
  const allProviders = [...new Set([...serverProviders, ...userProviders, ...custom.map((c) => c.id)])];

  // No keys anywhere — nothing is runnable. Every provider needs a key, so
  // don't expose models the user cannot call yet.
  if (!allProviders.length) return [];

  // Provider models for a keyed provider: explicit PROVIDER_MODELS env list,
  // else the curated YAML entries for that provider (in priority order).
  const explicitModels: string[] = [];
  const curatedModels: string[] = [];
  for (const provider of allProviders) {
    const declared = custom.find((c) => c.id === provider);
    if (declared) {
      explicitModels.push(...declared.models.map((m) => (m.includes("/") ? m : `${provider}/${m}`)));
      continue;
    }
    const envList = config.serverModels[provider];
    if (envList?.length) {
      explicitModels.push(...envList);
      continue;
    }
    curatedModels.push(
      ...getModels()
        .filter((m) => m.id.split("/")[0] === provider)
        .map((m) => m.id),
    );
  }

  // Live discovery only for providers the USER is keyed for (their key queries the API).
  const fetches = userProviders.map(async (provider) => {
    const key = llmKeys[provider];
    if (!key) return [];
    return fetchProviderModels(provider, key);
  });

  // If a server-side OpenRouter key is configured via env, also discover its
  // `:free` catalog (it churns weekly while models.yaml is hand-maintained).
  // This deployment keeps no server key, so users with their own OpenRouter key
  // get discovery from the full catalog fetch above. Unusable models are
  // filtered out (OPENROUTER_FREE_EXCLUDED); an explicit OPENROUTER_MODELS env
  // list wins over discovery.
  const serverOpenrouterKey = config.serverKeys.openrouter?.[0];
  if (serverOpenrouterKey && !userProviders.includes("openrouter") && !config.serverModels.openrouter?.length) {
    fetches.push(
      fetchProviderModels("openrouter", serverOpenrouterKey, {
        filter: (id) => id.endsWith(":free") && !OPENROUTER_FREE_EXCLUDED.has(id),
        cacheKey: "openrouter:free",
      }),
    );
  }

  const liveResults = await Promise.all(fetches);
  const liveModels = new Set(liveResults.flat());

  // Dedupe and keep ordering: explicit env models first, curated by priority,
  // live-only models alphabetical.
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const id of [...explicitModels, ...curatedModels]) {
    if (seen.has(id)) continue;
    seen.add(id);
    ordered.push(id);
  }
  for (const id of [...liveModels].filter((id) => !seen.has(id)).sort()) {
    ordered.push(id);
  }
  return ordered;
}
