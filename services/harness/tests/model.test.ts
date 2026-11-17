import { describe, it, expect } from "vitest";
import { buildModel } from "../model.js";

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
