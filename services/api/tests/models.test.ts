import { describe, it, expect } from "vitest";
import { getAvailableModelsForUser, getModelIds } from "../models.js";

describe("key-aware model list", () => {
  it("returns no models when no keys are configured", async () => {
    // Every provider needs a key — there is no keyless local provider anymore.
    expect(await getAvailableModelsForUser({})).toEqual([]);
  });

  it("curated list has unique ids and no stale/deprecated models", () => {
    const ids = getModelIds();
    expect(new Set(ids).size).toBe(ids.length);
    const stale = [
      "gemini/gemini-3.7-flash",
      "gemini/gemini-2.5-pro",
      "groq/llama-3.3-70b-versatile",
      "groq/qwen/qwen3-32b",
      "cerebras/llama-3.3-70b",
      "mistral/mistral-small-latest",
      "mistral/mistral-medium-latest",
      "mistral/open-mistral-nemo",
      "nvidia/nvidia/nemotron-3-super-120b-a12b",
      "nvidia/mistralai/mistral-nemotron",
      "cohere/command-a",
      "openai/gpt-5.6-luna",
      "openai/gpt-5.6-terra",
      "openai/gpt-5.6-sol",
      "anthropic/claude-haiku-4-5",
      "anthropic/claude-sonnet-4-6",
      "openrouter/nvidia/nemotron-3-super-120b-a12b:free",
      "openrouter/minimax/minimax-m3.1-flash:free",
      "openrouter/poolside/laguna-s-2.1:free",
      "openrouter/poolside/laguna-xs-2.1:free",
      "openrouter/xingchen-agi/xing4.0-29b-a4b:free",
      "openrouter/liquid/lfm-2.5-2.6b:free",
    ];
    expect(ids.filter((id) => stale.includes(id))).toEqual([]);
    // Current verified IDs are present.
    for (const id of [
      "gemini/gemini-3.8-flash",
      "groq/qwen/qwen3.8-27b",
      "mistral/mistral-small-2603",
      "cohere/command-a-plus-05-2026",
      "zai/glm-5.3-flash",
      "openai/gpt-6.2-astra",
      "anthropic/claude-sonnet-5-5",
    ]) {
      expect(ids).toContain(id);
    }
  });
});
