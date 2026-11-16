import { describe, expect, it } from "vitest";
import { getAgentCategories, isValidAgentCategory } from "../categories.js";

describe("agent categories", () => {
  it("reads the config file and validates membership", () => {
    expect(getAgentCategories().length).toBeGreaterThan(0);
    expect(getAgentCategories()).toContain("equity");
    expect(isValidAgentCategory("equity")).toBe(true);
    expect(isValidAgentCategory("not-a-category")).toBe(false);
    expect(isValidAgentCategory(undefined)).toBe(false);
  });
});
