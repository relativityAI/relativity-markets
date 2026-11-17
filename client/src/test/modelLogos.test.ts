import { describe, it, expect } from "vitest";
import { modelProvider, modelLogoAsset } from "../lib/modelLogos";

describe("model icon follows the model family, not the provider prefix", () => {
    it("uses the DeepSeek logo for opencode/deepseek-*", () => {
        const id = "opencode/deepseek-v4.1-flash";
        expect(modelProvider(id)).toBe("deepseek");
        expect(modelLogoAsset(id)?.src).toContain("data:image/svg+xml");
    });

    it("keeps other opencode models on the provider fallback", () => {
        expect(modelProvider("opencode/other-model")).toBe("opencode");
        expect(modelLogoAsset("opencode/other-model")).toBeNull();
    });
});
