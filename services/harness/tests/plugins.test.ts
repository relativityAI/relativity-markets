import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getPlugin,
  listPlugins,
  normalizePluginFiles,
  pluginSkillIds,
  pluginSkills,
  pluginsForSkills,
  readPluginFiles,
  selectRunSkills,
  skillToPluginIndex,
  updatePluginMeta,
  writePluginFiles,
} from "../plugins.js";

describe("plugins store", () => {
  it("lists the seeded Relativity plugins with their skills", () => {
    const ids = listPlugins().map((p) => p.id);
    expect(ids).toContain("chartist");
    expect(ids).toContain("nifty-indices");

    const chartist = getPlugin("chartist")!;
    expect(chartist.origin).toBe("relativity");
    expect(chartist.verified).toBe(1);
    expect(chartist.safety).toMatch(/Relativity scans every plugin/);
    expect(chartist.skill_count).toBeGreaterThan(0);
    expect(chartist.sources[0]?.url).toMatch(/^https:\/\//);
    // Country: Nifty is India-only, Chartist ships without one (all countries).
    expect(getPlugin("nifty-indices")?.country).toBe("IN");
    expect(chartist.country ?? "").toBe("");
    // Neither ships a custom image → the generated avatar stands.
    expect(chartist.avatar ?? "").toBe("");
  });

  it("parses every skill of a plugin and indexes skill → plugin", () => {
    const skills = pluginSkills("chartist");
    expect(skills.length).toBe(pluginSkillIds("chartist").length);
    expect(skills.every((s) => s.description && s.body)).toBe(true);

    const index = skillToPluginIndex();
    for (const id of pluginSkillIds("chartist")) expect(index.get(id)).toBe("chartist");
    expect(pluginsForSkills(pluginSkillIds("nifty-indices"))).toEqual(["nifty-indices"]);
    expect(pluginsForSkills(["no-such-skill"])).toEqual([]);
  });

  it("rejects metadata edits on Relativity plugins", async () => {
    const updated = await updatePluginMeta("chartist", { display_name: "Hacked" });
    expect(updated).toBeNull();
    expect(getPlugin("chartist")?.display_name).not.toBe("Hacked");
  });

  it("runs an explicit skill subset, else every plugin skill", () => {
    const all = pluginSkillIds("chartist");
    expect(all).toEqual(["chartist-playbook"]);
    // No request → everything the plugins contain.
    expect(selectRunSkills(["chartist"])).toEqual(all);
    // An explicit choice wins — exactly those skills.
    expect(selectRunSkills(["chartist"], [all[0]])).toEqual([all[0]]);
    // Ids outside the selected plugins are filtered out…
    expect(selectRunSkills(["chartist"], ["no-such-skill"])).toEqual(all);
    // Two plugins: a subset keeps the requested order, drops foreign ids.
    const both = [...pluginSkillIds("chartist"), ...pluginSkillIds("nifty-indices")];
    expect(both.length).toBeGreaterThan(1);
    expect(selectRunSkills(["chartist", "nifty-indices"], [both[1], both[0]])).toEqual([both[1], both[0]]);
    expect(selectRunSkills(["chartist", "nifty-indices"], ["no-such-skill", both[1]])).toEqual([both[1]]);
    // Legacy rows with no plugins keep their raw skill ids.
    expect(selectRunSkills([], ["chartist-playbook"])).toEqual(["chartist-playbook"]);
  });

  it("normalizes file maps and refuses traversal", () => {
    expect(normalizePluginFiles({ "skills/a/SKILL.md": "x", "plugin.json": "{}" })).toEqual({
      "skills/a/SKILL.md": "x",
      "plugin.json": "{}",
    });
    expect(normalizePluginFiles({ "../escape.md": "x" })).toBeNull();
    expect(normalizePluginFiles({ "/abs.md": "x" })).toBeNull();
    expect(normalizePluginFiles({ "a.md": 42 })).toBeNull();
    expect(normalizePluginFiles({})).toBeNull();
  });

  describe("custom plugin files", () => {
    let workdir: string;
    let original: string;
    beforeEach(() => {
      original = process.cwd();
      workdir = mkdtempSync(join(tmpdir(), "plugin-files-"));
      process.chdir(workdir); // customPluginsDir() resolves against cwd at call time
      mkdirSync("data/plugins/demo/skills/demo-skill", { recursive: true });
      writeFileSync("data/plugins/demo/skills/demo-skill/SKILL.md", "---\nname: demo-skill\ndescription: demo\n---\n\nBody.");
      writeFileSync("data/plugins/demo/plugin.json", JSON.stringify({ name: "demo" }));
    });
    afterEach(() => {
      process.chdir(original);
      rmSync(workdir, { recursive: true, force: true });
    });

    it("reads and writes custom plugin files (merge + delete)", () => {
      expect(getPlugin("demo")?.skill_count).toBe(1);
      expect(writePluginFiles("demo", { "notes.md": "hello" }, [])).toBe(true);

      const { files } = readPluginFiles("demo");
      expect(files["notes.md"]).toBe("hello");
      expect(files["skills/demo-skill/SKILL.md"]).toContain("name: demo-skill");

      writePluginFiles("demo", {}, ["notes.md"]);
      expect(existsSync(join(workdir, "data/plugins/demo/notes.md"))).toBe(false);
      // Relativity plugins refuse writes.
      expect(writePluginFiles("chartist", { "x.md": "y" }, [])).toBe(false);
    });

    it("normalizes country and custom image on a custom plugin", async () => {
      // Not a 2-letter code / not an http(s) URL → both clear to "" (any/generated).
      const bad = await updatePluginMeta("demo", { country: "India", avatar: "javascript:alert(1)" });
      expect(bad?.country).toBe("");
      expect(bad?.avatar).toBe("");

      const ok = await updatePluginMeta("demo", { country: "in", avatar: " https://example.com/icon.png " });
      expect(ok?.country).toBe("IN");
      expect(ok?.avatar).toBe("https://example.com/icon.png");

      // Clearing wins over anything plugin.json declares.
      const cleared = await updatePluginMeta("demo", { country: null, avatar: null });
      expect(cleared?.country).toBe("");
      expect(cleared?.avatar).toBe("");
    });
  });
});
