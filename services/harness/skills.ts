/**
 * Skill catalog — built-ins shipped on disk plus user-created custom skills,
 * backed by the FILESYSTEM (deepagents convention: a skill is a directory
 * with a SKILL.md).
 *
 * Built-ins: `services/config/skills/<name>/SKILL.md` (agentskills.io layout),
 * cached after first load. Custom skills: `services/data/skills/<userId>/<skillId>/`
 * — one directory per skill (SKILL.md + optional reference files), no
 * database. The same paths feed deepagents' SkillsMiddleware: the engine
 * routes `/skills/builtin/` and `/skills/custom/` backend prefixes here.
 *
 * Parsing/validation stays here (it defines what a skill IS); the filesystem
 * is the storage.
 *
 * Spec: https://agentskills.io/specification
 */

import { mkdirSync, readdirSync, readFileSync, existsSync, statSync, writeFileSync, rmSync, cpSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

export const SPEC_NAME_RE = /^(?!.*--)[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
export const SPEC_NAME_ERR =
  "name must be 1-64 chars of lowercase letters, digits and single hyphens (no leading, trailing or doubled hyphen)";

export type SkillSource = "builtin" | "custom";

export interface HarnessSkill {
  id: string;
  name: string;
  description: string;
  category: string;
  version: number;
  source: SkillSource;
  /** Tools this skill may call, from frontmatter allowed-tools. */
  allowedTools: string[];
  /** Frontmatter `citations: inline` — report-structure forbids footnotes. */
  citations?: "inline";
  /** User labels from frontmatter `metadata.tags` (comma-separated). */
  tags: string[];
  /** ISO created-at, from the skill file's birthtime where available. */
  created_at?: string;
  /** Markdown body (opaque instructions). */
  body: string;
  /** Skill directory on disk (built-ins always; customs resolve to their dir). */
  dir: string | null;
  /** On-demand reference files, loaded by the agent when needed. */
  references: { path: string; text: string }[];
}

export interface SkillIssue {
  line: number;
  message: string;
  severity: "error" | "warn";
}

export interface SkillParseResult {
  skill: HarnessSkill | null;
  issues: SkillIssue[];
}

// ── Paths ───────────────────────────────────────────────────────────────────

export const BUILTIN_SKILLS_DIR = join(process.cwd(), "config", "skills");
/** Custom skills: services/data/skills/<userId>/<skillId>/. */
export function customSkillsDir(userId: string): string {
  return join(process.cwd(), "data", "skills", userId);
}
export function customSkillDir(userId: string, skillId: string): string {
  return join(customSkillsDir(userId), skillId);
}

// ── Parsing (agentskills.io) ────────────────────────────────────────────────

function readFrontmatter(src: string): { frontmatter: Record<string, unknown>; body: string } {
  const normalized = src.startsWith("\uFEFF") ? src.slice(1) : src;
  const match = normalized.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/);
  if (!match) throw new Error("SKILL.md must start with YAML frontmatter delimited by ---");
  const parsed: unknown = parseYaml(match[1]);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("YAML frontmatter must be a mapping");
  }
  return { frontmatter: parsed as Record<string, unknown>, body: match[2] || "" };
}

function humanizeName(name: string): string {
  return name.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Filesystem birth time as an ISO string; unavailable on some platforms/FS. */
function fileCreatedAt(file: string): string | undefined {
  try {
    return statSync(file).birthtime.toISOString();
  } catch {
    return undefined;
  }
}

function readReferences(dir: string): { path: string; text: string }[] {
  const refDir = join(dir, "references");
  if (!existsSync(refDir)) return [];
  const out: { path: string; text: string }[] = [];
  for (const entry of readdirSync(refDir).sort()) {
    const file = join(refDir, entry);
    try {
      if (statSync(file).isFile()) out.push({ path: `references/${entry}`, text: readFileSync(file, "utf8") });
    } catch {
      // unreadable reference — skip
    }
  }
  return out;
}

export function parseSkillMarkdown(
  src: string,
  source: SkillSource = "custom",
  expectedName?: string,
  dir: string | null = null,
): SkillParseResult {
  const issues: SkillIssue[] = [];
  let frontmatter: Record<string, unknown>;
  let body: string;
  try {
    ({ frontmatter, body } = readFrontmatter(src));
  } catch (error) {
    return {
      skill: null,
      issues: [{ line: 1, message: error instanceof Error ? error.message : "Invalid YAML frontmatter", severity: "error" }],
    };
  }

  const name = frontmatter.name;
  const description = frontmatter.description;
  if (typeof name !== "string" || !SPEC_NAME_RE.test(name)) {
    issues.push({ line: 1, message: typeof name === "string" ? SPEC_NAME_ERR : "frontmatter name is required", severity: "error" });
  }
  if (typeof description !== "string" || description.length < 1 || description.length > 1024) {
    issues.push({
      line: 1,
      message: typeof description !== "string" || !description ? "frontmatter description is required" : "description must be 1024 characters or fewer",
      severity: "error",
    });
  }
  if (frontmatter.license !== undefined && typeof frontmatter.license !== "string") {
    issues.push({ line: 1, message: "license must be a string", severity: "error" });
  }
  if (frontmatter.compatibility !== undefined &&
      (typeof frontmatter.compatibility !== "string" || frontmatter.compatibility.length > 500)) {
    issues.push({ line: 1, message: "compatibility must be a string of 500 characters or fewer", severity: "error" });
  }
  if (frontmatter["allowed-tools"] !== undefined && typeof frontmatter["allowed-tools"] !== "string") {
    issues.push({ line: 1, message: "allowed-tools must be a space-separated string", severity: "error" });
  }
  if (frontmatter.citations !== undefined && frontmatter.citations !== "inline" && frontmatter.citations !== "footnotes") {
    issues.push({ line: 1, message: 'citations must be "inline" or "footnotes"', severity: "error" });
  }
  const metadata = frontmatter.metadata;
  if (metadata !== undefined && (!metadata || typeof metadata !== "object" || Array.isArray(metadata) ||
      Object.values(metadata as Record<string, unknown>).some((v) => typeof v !== "string"))) {
    issues.push({ line: 1, message: "metadata must be a map of string keys to string values", severity: "error" });
  }
  if (expectedName && typeof name === "string" && name !== expectedName) {
    issues.push({ line: 1, message: `frontmatter name "${name}" must match skill directory "${expectedName}"`, severity: "error" });
  }

  if (issues.some(({ severity }) => severity === "error")) return { skill: null, issues };

  const fmMetadata = (metadata || {}) as Record<string, string>;
  const allowedTools = typeof frontmatter["allowed-tools"] === "string"
    ? frontmatter["allowed-tools"].split(/\s+/).filter(Boolean)
    : [];
  const tags = typeof fmMetadata.tags === "string"
    ? fmMetadata.tags.split(",").map((t) => t.trim()).filter(Boolean)
    : [];

  return {
    skill: {
      id: name as string,
      name: fmMetadata.title || humanizeName(name as string),
      description: description as string,
      category: fmMetadata.category || "custom",
      version: Number(fmMetadata.version) > 0 ? Number(fmMetadata.version) : 1,
      source,
      allowedTools,
      ...(frontmatter.citations === "inline" ? { citations: "inline" as const } : {}),
      tags,
      body: body.trim(),
      dir,
      references: dir ? readReferences(dir) : [],
    },
    issues,
  };
}

// ── Built-ins ───────────────────────────────────────────────────────────────

let builtinCache: HarnessSkill[] | null = null;

function builtinSkillFiles(): { slug: string; file: string }[] {
  const out: { slug: string; file: string }[] = [];
  let entries: string[];
  try {
    entries = readdirSync(BUILTIN_SKILLS_DIR);
  } catch {
    return out;
  }
  for (const entry of entries.sort()) {
    const dir = join(BUILTIN_SKILLS_DIR, entry);
    try {
      if (!statSync(dir).isDirectory()) continue;
    } catch {
      continue;
    }
    const file = join(dir, "SKILL.md");
    if (existsSync(file)) out.push({ slug: entry, file });
  }
  return out;
}

export function loadBuiltinSkills(): HarnessSkill[] {
  if (builtinCache) return builtinCache;
  const out: HarnessSkill[] = [];
  for (const { slug, file } of builtinSkillFiles()) {
    try {
      const { skill, issues } = parseSkillMarkdown(readFileSync(file, "utf8"), "builtin", slug, join(BUILTIN_SKILLS_DIR, slug));
      if (skill) out.push({ ...skill, created_at: fileCreatedAt(file) });
      else console.warn(`[skills] builtin ${slug} failed to parse: ${issues.map((i) => i.message).join("; ")}`);
    } catch (e: any) {
      console.warn(`[skills] builtin ${slug} read failed: ${e?.message}`);
    }
  }
  builtinCache = out;
  return out;
}

export function getBuiltinSkill(id: string): HarnessSkill | null {
  return loadBuiltinSkills().find((s) => s.id === id) || null;
}

// ── Custom skills — files under services/data/skills/<userId>/<skillId>/ ────

export interface CustomSkillRecord {
  skillId: string;
  markdown: string;
  /** Extra files (path → content) beyond SKILL.md, e.g. references/*.md. */
  files: Record<string, string>;
  createdAt?: string;
  updatedAt?: string;
}

function readCustomRecord(userId: string, skillId: string): CustomSkillRecord | null {
  const dir = customSkillDir(userId, skillId);
  const file = join(dir, "SKILL.md");
  if (!existsSync(file)) return null;
  const files: Record<string, string> = {};
  // Files beyond SKILL.md: reference dirs and loose files, one level deep.
  for (const entry of readdirSync(dir)) {
    if (entry === "SKILL.md") continue;
    const p = join(dir, entry);
    try {
      if (statSync(p).isFile()) files[entry] = readFileSync(p, "utf8");
      else if (statSync(p).isDirectory()) {
        for (const sub of readdirSync(p)) {
          const sp = join(p, sub);
          if (statSync(sp).isFile()) files[`${entry}/${sub}`] = readFileSync(sp, "utf8");
        }
      }
    } catch {
      // unreadable — skip
    }
  }
  const stats = statSync(file);
  return {
    skillId,
    markdown: readFileSync(file, "utf8"),
    files,
    createdAt: fileCreatedAt(file),
    updatedAt: stats.mtime.toISOString(),
  };
}

export function listCustomSkillIds(userId: string): string[] {
  const dir = customSkillsDir(userId);
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries
    .filter((e) => existsSync(join(dir, e, "SKILL.md")))
    .sort();
}

export function listCustomSkills(userId: string): HarnessSkill[] {
  const out: HarnessSkill[] = [];
  for (const id of listCustomSkillIds(userId)) {
    const rec = readCustomRecord(userId, id);
    if (!rec) continue;
    const { skill } = parseSkillMarkdown(rec.markdown, "custom", id, join(customSkillDir(userId, id)));
    if (skill) out.push({ ...skill, created_at: rec.createdAt });
  }
  return out;
}

export function getCustomSkill(userId: string, skillId: string): HarnessSkill | null {
  const rec = readCustomRecord(userId, skillId);
  if (!rec) return null;
  const { skill } = parseSkillMarkdown(rec.markdown, "custom", skillId, customSkillDir(userId, skillId));
  return skill ? { ...skill, id: skillId, source: "custom", created_at: rec.createdAt } : null;
}

export function getCustomSkillFiles(userId: string, skillId: string): CustomSkillRecord | null {
  return readCustomRecord(userId, skillId);
}

export function getBuiltinSkillFiles(id: string): CustomSkillRecord | null {
  const skill = getBuiltinSkill(id);
  if (!skill?.dir) return null;
  const files: Record<string, string> = {};
  const base = skill.dir;
  try {
    for (const entry of readdirSync(base)) {
      const p = join(base, entry);
      if (statSync(p).isFile() && entry !== "SKILL.md") files[entry] = readFileSync(p, "utf8");
      else if (statSync(p).isDirectory()) {
        for (const sub of readdirSync(p)) {
          const sp = join(p, sub);
          if (statSync(sp).isFile()) files[`${entry}/${sub}`] = readFileSync(sp, "utf8");
        }
      }
    }
  } catch {
    // best effort
  }
  return { skillId: id, markdown: readFileSync(join(base, "SKILL.md"), "utf8"), files };
}

/** Save (upsert) a custom skill as a directory: SKILL.md + extra files. */
export function saveCustomSkill(
  userId: string,
  markdown: string,
  files: Record<string, string> = {},
): { skill: HarnessSkill | null; issues: SkillIssue[] } {
  const { skill, issues } = parseSkillMarkdown(markdown, "custom");
  if (!skill) return { skill: null, issues };
  const dir = customSkillDir(userId, skill.id);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), markdown);
  for (const [path, content] of Object.entries(files)) {
    const dest = join(dir, path);
    if (dest.startsWith(dir) && !path.includes("..")) {
      mkdirSync(join(dest, ".."), { recursive: true });
      writeFileSync(dest, content);
    }
  }
  return { skill: { ...skill, dir, source: "custom", created_at: fileCreatedAt(join(dir, "SKILL.md")) }, issues: [] };
}

export function deleteCustomSkill(userId: string, skillId: string): boolean {
  const dir = customSkillDir(userId, skillId);
  if (!existsSync(dir)) return false;
  rmSync(dir, { recursive: true, force: true });
  return true;
}

export function resolveSkill(userId: string, skillId: string): HarnessSkill | null {
  return getCustomSkill(userId, skillId) ?? getBuiltinSkill(skillId);
}

/** A custom skill may shadow a builtin id; builtins always keep their id. */
export function listAllSkillsForUser(userId: string): HarnessSkill[] {
  const builtins = loadBuiltinSkills();
  const customs = listCustomSkills(userId);
  const customIds = new Set(customs.map((c) => c.id));
  return [...builtins.filter((b) => !customIds.has(b.id)), ...customs];
}

/** Import a downloaded skill directory into the user's custom library. */
export function importSkillDir(userId: string, srcDir: string, skillId?: string): HarnessSkill | null {
  const file = join(srcDir, "SKILL.md");
  if (!existsSync(file)) return null;
  const markdown = readFileSync(file, "utf8");
  const { skill } = parseSkillMarkdown(markdown, "custom");
  if (!skill) return null;
  const id = skillId || skill.id;
  const dest = customSkillDir(userId, id);
  cpSync(srcDir, dest, { recursive: true });
  return getCustomSkill(userId, id);
}

// ── deepagents wiring — the ENGINE builds backend routes from these paths ───

/** Skill dirs this run exposes to the agent (route → real dir); the engine
 *  turns them into a CompositeBackend. One home for the layout convention:
 *  built-ins at config/skills, customs at data/skills/<userId>. */
export interface SkillSourceDir {
  route: string;
  dir: string;
}

export function skillSourceDirs(userId: string): SkillSourceDir[] {
  const out: SkillSourceDir[] = [];
  if (existsSync(BUILTIN_SKILLS_DIR)) out.push({ route: "/skills/builtin/", dir: BUILTIN_SKILLS_DIR });
  if (existsSync(customSkillsDir(userId))) out.push({ route: "/skills/custom/", dir: customSkillsDir(userId) });
  return out;
}

/** The skill's report-structure reference — its binding presentation spec.
 *  Matched by path (report-structure.md), never inlined into harness code:
 *  the skill owns the structure, the harness only surfaces it. */
export function reportStructureOf(skill: HarnessSkill): string | null {
  const ref = skill.references.find((r) => /report[-_ ]?structure/i.test(r.path));
  return ref?.text?.trim() || null;
}

export { slugifySkillName, humanizeName } from "./skill-meta.js";

// ── Editor helpers (untrusted input at the API trust boundary) ──────────────

/**
 * A skill's directory as a flat path -> content map (agentskills.io layout).
 * Folder keys end with "/" and hold "" so empty dirs survive the round-trip.
 */
export type SkillFiles = Record<string, string>;

/**
 * Validate an untrusted file map from a request body. Returns null when the
 * tree is unusable: SKILL.md must exist and be non-empty, every value must be
 * a string, folders (trailing "/") must be empty, and no path may be absolute
 * or escape the skill directory.
 */
export function normalizeSkillFiles(raw: unknown): SkillFiles | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: SkillFiles = {};
  for (const [path, content] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof content !== "string") return null;
    if (!path || path.startsWith("/") || path.includes("\\")) return null;
    const segments = path.split("/");
    if (path.endsWith("/")) segments.pop(); // the trailing "" is the folder marker
    if (!segments.length || segments.some((s) => s === "" || s === "." || s === "..")) return null;
    if (path.endsWith("/") && content !== "") return null;
    out[path] = content;
  }
  if (!out["SKILL.md"]?.trim()) return null;
  return out;
}

/**
 * Repair a skill document so the parser accepts it. Conservative: preserves
 * the body and every readable frontmatter value, and only rewrites the bits
 * that failed validation. Returns null when nothing could be improved.
 */
export function fixSkillMarkdown(src: string, fallbackName?: string): string | null {
  let raw = src.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  if (!raw.trim()) return null;
  let frontmatter: Record<string, unknown> = {};
  let body = raw;
  let salvaged = false;

  if (raw.startsWith("---")) {
    const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/);
    if (m) {
      try {
        const parsed = parseYaml(m[1]);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          frontmatter = parsed as Record<string, unknown>;
          body = m[2] ?? "";
        }
      } catch {
        salvaged = true;
        for (const line of m[1].split("\n")) {
          const kv = line.match(/^([^:]+):\s*(.*)$/);
          if (kv) frontmatter[kv[1].trim()] = kv[2].trim();
        }
        body = m[2] ?? "";
      }
    } else {
      salvaged = true;
      const lines = raw.split("\n");
      let i = 1;
      for (; i < lines.length; i++) {
        const t = lines[i].trim();
        if (t === "---") { i++; break; }
        const kv = t.match(/^([^:]+):\s*(.*)$/);
        if (kv) frontmatter[kv[1].trim()] = kv[2].trim();
        else if (t) break;
      }
      body = lines.slice(i).join("\n");
    }
  } else {
    salvaged = true;
  }

  const slugify = (name: string): string =>
    name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64) || "custom-skill";

  const final: Record<string, unknown> = {};
  const rawName = frontmatter.name;
  final.name = typeof rawName === "string" && SPEC_NAME_RE.test(rawName)
    ? rawName
    : slugify(typeof rawName === "string" ? rawName : (fallbackName || "custom-skill"));

  const rawDesc = frontmatter.description;
  if (typeof rawDesc === "string" && rawDesc.length >= 1 && rawDesc.length <= 1024) {
    final.description = rawDesc;
  } else {
    const first = body.split("\n").map((l) => l.trim()).find((l) => l && !/^#{1,6}\s/.test(l));
    final.description = String(first ?? rawDesc ?? "(no description)").slice(0, 1024);
  }

  for (const [k, v] of Object.entries(frontmatter)) {
    if (k === "name" || k === "description") continue;
    if (k === "license" || k === "compatibility") { final[k] = typeof v === "string" ? v : String(v); continue; }
    if (k === "allowed-tools") { final[k] = Array.isArray(v) ? v.map(String).join(" ") : String(v); continue; }
    if (k === "metadata") {
      if (v && typeof v === "object" && !Array.isArray(v)) {
        final[k] = Object.fromEntries(
          Object.entries(v as Record<string, unknown>).map(([kk, vv]) => [kk, String(vv)]),
        );
      }
      continue;
    }
    final[k] = v;
  }

  const recognized = ["name", "description", "license", "compatibility", "allowed-tools", "metadata"];
  const changed = salvaged || recognized.some((k) => final[k] !== frontmatter[k]);
  if (!changed) return null;

  const out = `---\n${stringifyYaml(final).trimEnd()}\n---\n\n${body.replace(/^\n+/, "").trimEnd()}\n`;
  return out.trim() === raw.trim() ? null : out.trimEnd();
}
