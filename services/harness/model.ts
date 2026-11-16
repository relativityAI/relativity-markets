/**
 * Model layer — `provider/model` ids → LangChain chat models.
 *
 * Same provider matrix the old harness served, rebuilt on @langchain/*.
 * Every OpenAI-compatible gateway (cerebras, groq, openrouter, mistral,
 * nvidia, cohere, zai, ollama, opencode) collapses into ChatOpenAI with a
 * custom baseURL, so the whole matrix is one map + two first-class clients.
 *
 * The caller owns key selection: it passes the picked key (usually from the
 * API's key pool) and we fail LOUDLY when a provider has none — otherwise the
 * call goes out with no Authorization header, the provider answers 401, and a
 * run burns its whole time budget retrying a request that can never succeed.
 */
import { randomUUID } from "node:crypto";
import { ChatOpenAI } from "@langchain/openai";
import { ChatAnthropic } from "@langchain/anthropic";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

export interface LlmKeys {
  openai?: string;
  gemini?: string;
  anthropic?: string;
  cerebras?: string;
  groq?: string;
  openrouter?: string;
  mistral?: string;
  nvidia?: string;
  cohere?: string;
  zai?: string;
  opencode?: string;
  tavily?: string;
}

export function providerFor(modelId: string): string {
  return modelId.slice(0, Math.max(modelId.indexOf("/"), 0));
}

export function modelNameFor(modelId: string): string {
  return modelId.slice(modelId.indexOf("/") + 1);
}

const PROVIDER_LABELS: Record<string, string> = {
  openai: "OpenAI",
  gemini: "Gemini",
  anthropic: "Anthropic",
  cerebras: "Cerebras",
  groq: "Groq",
  openrouter: "OpenRouter",
  mistral: "Mistral",
  nvidia: "NVIDIA NIM",
  cohere: "Cohere",
  zai: "Z.AI",
  ollama: "Ollama",
  opencode: "OpenCode",
};

export function assertProviderKeyAvailable(provider: string, key: string | undefined): void {
  if (provider === "ollama") return;
  if (!key || !String(key).trim()) {
    throw new Error(
      `No API key configured for "${PROVIDER_LABELS[provider] || provider}" — add one in Settings or pick a model from a provider that has a key.`,
    );
  }
}

/**
 * OpenCode Console gateway. The Go plan REQUIRES an `x-opencode-session`
 * header — without it every request 400s with MissingSessionID. One id per
 * process keeps routed conversations on their prompt cache.
 *
 * ponytail: one session id per process; per-run ids if prompt-cache reuse
 * across a long-lived server ever matters.
 */
const opencodeSessionId = process.env.OPENCODE_SESSION_ID || `ses_${randomUUID()}`;

function openCodeConfiguration(key: string) {
  const base = (process.env.OPENCODE_BASE_URL || "https://opencode.ai/inference/go").replace(/\/+$/, "");
  return {
    baseURL: `${base}/openai/v1`,
    apiKey: key,
    defaultHeaders: {
      "x-opencode-session": opencodeSessionId,
      "User-Agent": "relativity-agents/1.0",
    },
  };
}

// Legacy single-key env fallbacks (superseded by the key pool, kept safe).
export const ENV_KEYS: Record<string, string | undefined> = {
  openai: process.env.OPENAI_API_KEY,
  gemini: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY,
  anthropic: process.env.ANTHROPIC_API_KEY,
  cerebras: process.env.CEREBRAS_API_KEY,
  groq: process.env.GROQ_API_KEY,
  openrouter: process.env.OPENROUTER_API_KEY,
  mistral: process.env.MISTRAL_API_KEY,
  nvidia: process.env.NVIDIA_API_KEY || process.env.NVIDIA_NIM_API_KEY,
  cohere: process.env.COHERE_API_KEY || process.env.COHERE_API_TOKEN,
  zai: process.env.ZAI_API_KEY || process.env.Z_AI_API_KEY,
  opencode: process.env.OPENCODE_API_KEY,
};

interface OpenAiCompatGateway {
  baseURL?: string;
}

/** OpenAI-compatible gateways that ride ChatOpenAI with a custom baseURL. */
const GATEWAYS: Record<string, OpenAiCompatGateway> = {
  cerebras: { baseURL: "https://api.cerebras.ai/v1" },
  groq: { baseURL: "https://api.groq.com/openai/v1" },
  openrouter: { baseURL: "https://openrouter.ai/api/v1" },
  mistral: { baseURL: "https://api.mistral.ai/v1" },
  nvidia: { baseURL: "https://integrate.api.nvidia.com/v1" },
  cohere: { baseURL: "https://api.cohere.ai/compatibility/v1" },
  zai: { baseURL: "https://api.z.ai/api/paas/v4" },
  ollama: { baseURL: process.env.OLLAMA_URL || "http://localhost:11434/v1" },
};

export function buildModel(modelId: string, keys: LlmKeys, apiKey?: string, temperature = 0, maxTokens?: number): BaseChatModel {
  const provider = providerFor(modelId);
  const name = modelNameFor(modelId);
  const key = apiKey || keys[provider as keyof LlmKeys] || ENV_KEYS[provider];
  assertProviderKeyAvailable(provider, key);
  const opts = { model: name, temperature, ...(maxTokens ? { maxTokens } : {}) };
  switch (provider) {
    case "openai":
      return new ChatOpenAI({ ...opts, apiKey: key });
    case "anthropic":
      return new ChatAnthropic({ ...opts, apiKey: key });
    case "opencode":
      return new ChatOpenAI({ ...opts, configuration: openCodeConfiguration(key!) });
    default: {
      const gateway = GATEWAYS[provider];
      if (!gateway) throw new Error(`Unknown model provider: ${provider}`);
      return new ChatOpenAI({
        ...opts,
        apiKey: key,
        configuration: { baseURL: gateway.baseURL, apiKey: key },
      });
    }
  }
}
