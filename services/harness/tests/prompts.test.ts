import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { plannerSystemPrompt } from "../prompts.js";

const structure = readFileSync(
  new URL("../../config/skills/chartist-technical-analysis/references/report-structure.md", import.meta.url),
  "utf8",
);

describe("figure budget lives in the plan, not the sections", () => {
  it("the structure carries no per-section plot quota", () => {
    expect(structure).not.toMatch(/atleast 5 plots/);
    expect(structure).toMatch(/analysis plan determine which figures/);
  });

  it("the planner prompt assigns figures and knows the plot menu", () => {
    const skill = { name: "s", id: "s", body: "b", references: [] } as any;
    const p = plannerSystemPrompt([], skill);
    expect(p).toContain("input.figures");
    expect(p).toContain("price, volume, sma20"); // plot reference is wired in
  });
});
