import { describe, it, expect } from "vitest";
import { modelProvider, modelLogoAsset } from "../lib/modelLogos";

describe("model icon follows the model family, not the provider prefix", () => {
    it("uses the DeepSeek logo for opencode/deepseek-*", () => {
        const id = "opencode/deepseek-v4.1-flash";
        expect(modelProvider(id)).toBe("deepseek");
        expect(modelLogoAsset(id)?.src).toContain("data:image/svg+xml");
    });

    it("uses the OpenCode mark for other opencode-routed models", () => {
        // opencode/ is a real provider now (Settings card + Go gateway), so the
        // prefix models get its mark; the deepseek family still outranks it above.
        expect(modelProvider("opencode/other-model")).toBe("opencode");
        expect(modelLogoAsset("opencode/other-model")?.src).toBeTruthy();
        expect(modelLogoAsset("opencode")?.src).toBeTruthy();
    });
});
