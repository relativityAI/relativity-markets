import { describe, it, expect } from "vitest";
import { buildModel, customProviders, type LlmKeys } from "../model.js";

describe("buildModel provider matrix", () => {
  it("builds every provider offered by /api/models", () => {
    for (const provider of ["cerebras", "cohere", "gemini", "groq", "mistral", "nvidia", "openrouter", "zai"]) {
      expect(() => buildModel(`${provider}/test`, { [provider]: "fake-key" } as any)).not.toThrow();
    }
  });

  it("throws a clear error when a provider has no key", () => {
    expect(() => buildModel("groq/test", {})).toThrow(/No API key configured/);
    expect(() => buildModel("gemini/test", {})).toThrow(/No API key configured/);
  });
});

describe("custom OpenAI-compatible providers", () => {
  const keys = (models: string[]): LlmKeys => ({
    __custom: JSON.stringify([{ id: "myprov", name: "My Prov", baseURL: "http://localhost:11434/v1", models }]),
  });

  it("parses the bundle off the keys record, tolerating junk", () => {
    expect(customProviders(keys(["llama3.2"]))).toHaveLength(1);
    expect(customProviders({})).toEqual([]);
    expect(customProviders({ __custom: "not json" })).toEqual([]);
  });

  it("builds without a key — local servers need no credential", () => {
    expect(() => buildModel("myprov/llama3.2", keys(["llama3.2"]))).not.toThrow();
  });

  it("routes to the declared base URL, not the built-in gateway map", () => {
    const model = buildModel("myprov/llama3.2", keys(["llama3.2"])) as any;
    expect(model.lc_kwargs?.configuration?.baseURL).toContain("localhost:11434");
    // Keyless providers must not hand the OpenAI client an empty apiKey —
    // configuration.apiKey spreads over the top-level "not-required" and
    // the client then dies with "Missing credentials" on first invoke.
    expect(model.lc_kwargs?.configuration?.apiKey).toBeUndefined();
    // An unknown id still falls through to the fixed gateway map and dies there.
    expect(() => buildModel("nope/test", { ...keys([]), nope: "k" } as unknown as LlmKeys)).toThrow(/Unknown model provider/);
    expect(() => buildModel("nope/test", keys([]))).toThrow(/No API key configured/);
  });
});
