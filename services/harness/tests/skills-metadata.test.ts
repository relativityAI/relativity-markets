import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listCustomSkills, parseSkillMarkdown, saveCustomSkill } from "../skills.js";

const DOC = `---
name: momentum-skill
description: A skill with tags.
metadata:
  title: Momentum Skill
  category: market
  tags: technical, momentum
---

Body.
`;

describe("skill metadata in the library payload", () => {
  it("parses metadata.tags into a tag list", () => {
    const { skill, issues } = parseSkillMarkdown(DOC);
    expect(issues).toEqual([]);
    expect(skill?.tags).toEqual(["technical", "momentum"]);
  });

  it("uses an empty tag list when metadata.tags is absent", () => {
    const { skill } = parseSkillMarkdown(DOC.replace(/  tags: .*\n/, ""));
    expect(skill?.tags).toEqual([]);
  });

  let original: string;
  let workdir: string;
  beforeEach(() => {
    original = process.cwd();
    workdir = mkdtempSync(join(tmpdir(), "relativity-skills-"));
    process.chdir(workdir);
  });
  afterEach(() => {
    process.chdir(original);
    rmSync(workdir, { recursive: true, force: true });
  });

  it("attaches a created_at to saved and listed custom skills", () => {
    const { skill, issues } = saveCustomSkill("u1", DOC);
    expect(issues).toEqual([]);
    expect(skill?.created_at).toBeTruthy();
    expect(Number.isNaN(Date.parse(skill!.created_at!))).toBe(false);

    const listed = listCustomSkills("u1");
    expect(listed).toHaveLength(1);
    expect(listed[0].tags).toEqual(["technical", "momentum"]);
    expect(listed[0].created_at).toBeTruthy();
  });
});
