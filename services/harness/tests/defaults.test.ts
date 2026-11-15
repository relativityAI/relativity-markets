import { describe, expect, it } from "vitest";
import { DEFAULT_AGENTS, DEFAULT_HARNESS_AGENT } from "../agents/defaults.js";
import { getBuiltinSkill } from "../skills/catalog.js";
import { reportStructureOf } from "../skills/activate.js";

describe("default agents", () => {
  it("every default agent binds one resolvable builtin skill with a report structure", () => {
    expect(DEFAULT_AGENTS.length).toBeGreaterThan(0);
    for (const agent of DEFAULT_AGENTS) {
      expect(agent.skillIds, agent.name).toHaveLength(1);
      const skill = getBuiltinSkill(agent.skillIds![0]);
      expect(skill, `${agent.name} → skill "${agent.skillIds![0]}"`).not.toBeNull();
      expect(reportStructureOf(skill!), `${agent.name} report-structure`).toBeTruthy();
    }
  });

  it("the seed-on-empty agent is the first default", () => {
    expect(DEFAULT_HARNESS_AGENT).toBe(DEFAULT_AGENTS[0]);
  });
});
