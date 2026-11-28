/**
 * Plugins — one directory per plugin, Claude plugin layout:
 *
 *   <root>/<plugin-id>/plugin.json        identity + manifest (optional on import)
 *   <root>/<plugin-id>/skills/<skill>/SKILL.md (+ references/, scripts/, assets/)
 *
 * Roots: `config/plugins` (Relativity built-ins, read-only) and
 * `data/plugins` (custom / imported, editable). Every skill in the repo lives
 * inside a plugin — a run loads ALL skills of the plugins it selects.
 *
 * Split of truth: FILES (skills, scripts, assets) live on disk and feed
 * deepagents directly (filesystem + code execution work for imported plugins
 * too). METADATA the UI edits (sources, categories, version, disclaimer…) is
 * the `plugins` DB row — the row wins on read; plugin.json seeds it on import.
 *
 * Security note: import paths (zip/URL) are untrusted — everything is
 * normalized before it reaches data/plugins, and reads reject traversal.
 */

import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  MY_SKILLS_PLUGIN_ID,
  RELATIVITY_PLUGINS_DIR,
  customPluginsDir,
  parseSkillMarkdown,
  type HarnessSkill,
} from "./skills.js";
import {
  deletePluginRow,
  getPluginRowSync,
  listAlertRulesMissingPlugins,
  listPluginRows,
  listPluginRowsSync,
  listRunsMissingPlugins,
  setAlertRulePluginIds,
  setRunPluginIds,
  upsertPluginRow,
  type PluginRow,
} from "../db/repo.js";
import { listAgents } from "./store.js";

const execFileAsync = promisify(execFile);

/** The disclaimer shown on every Relativity plugin's detail page. */
export const RELATIVITY_SAFETY =
  "Relativity scans every plugin for safety and security, but can't guarantee this plugin will work as intended or won't change.";

/** The GitHub repo seeded Relativity plugins point their Sources link at. */
const RELATIVITY_SOURCE = { label: "github.com/relativityAI/relativity-markets", url: "https://github.com/relativityAI/relativity-markets" };

/** Seeded metadata for Relativity plugins (read-only in the UI). */
const SEEDED_META: Record<string, Partial<PluginRow> & { agent_category?: string | null }> = {
  chartist: {
    display_name: "Chartist",
    description: "Technical-analysis playbook for equities — chart patterns, indicators, levels and the report structure every chartist run follows.",
    listed_date: "November 2026",
    version: "v7.0.2",
    version_date: "Nov 12",
    license: "MIT",
    categories: ["Technical analysis", "Equities", "Department: Investing"],
    sources: [RELATIVITY_SOURCE],
  },
  "nifty-indices": {
    display_name: "Nifty Indices",
    description: "Index-level analysis for NSE benchmarks — breadth, rotation and index constituents.",
    listed_date: "November 2026",
    version: "v2.1.0",
    version_date: "Nov 12",
    license: "MIT",
    categories: ["Indices", "India", "Department: Investing"],
    country: "IN",
    sources: [RELATIVITY_SOURCE],
  },
};

// ── Paths & discovery ───────────────────────────────────────────────────────

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

export function pluginDir(id: string): string | null {
  const custom = join(customPluginsDir(), id);
  if (isDir(custom)) return custom;
  const relativity = join(RELATIVITY_PLUGINS_DIR, id);
  if (isDir(relativity)) return relativity;
  return null;
}

export function pluginOrigin(id: string): "relativity" | "custom" | null {
  if (isDir(join(customPluginsDir(), id))) return "custom";
  if (isDir(join(RELATIVITY_PLUGINS_DIR, id))) return "relativity";
  return null;
}

/** The skills dir of a plugin (where deepagents mounts its skill sources). */
export function pluginSkillsDir(id: string): string | null {
  const dir = pluginDir(id);
  if (!dir) return null;
  const skills = join(dir, "skills");
  return isDir(skills) ? skills : null;
}

/** Skill directories inside a plugin (each has a SKILL.md). */
function skillSubdirs(skillsDir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(skillsDir).sort();
  } catch {
    return [];
  }
  return entries.filter((e) => existsSync(join(skillsDir, e, "SKILL.md")));
}

interface ManifestData {
  name?: string;
  description?: string;
  version?: string;
  displayName?: string;
  listed?: string;
  versionDate?: string;
  license?: string;
  verified?: boolean;
  safety?: string;
  developerUrl?: string;
  sources?: { label: string; url: string }[];
  categories?: string[];
  /** Which run-form category this plugin serves: "equity" | "industry" (absent = any). */
  agentCategory?: string;
  /** Optional ISO-2 country the plugin targets (absent = any). */
  country?: string;
  /** Custom avatar image URL (absent = generated avatar). */
  avatar?: string;
}

function readManifest(dir: string): ManifestData | null {
  const file = join(dir, "plugin.json");
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    return parsed && typeof parsed === "object" ? (parsed as ManifestData) : null;
  } catch {
    return null;
  }
}

function humanize(id: string): string {
  return id.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** A plugin dir that exists but has no DB row yet → metadata from its manifest. */
function metaFromDisk(
  id: string,
  dir: string,
  origin: "relativity" | "custom",
): Partial<PluginRow> & { agent_category?: string | null } {
  const m = readManifest(dir) ?? {};
  const seeded = origin === "relativity" ? (SEEDED_META[id] ?? {}) : {};
  const base: Partial<PluginRow> & { agent_category?: string | null } = {
    id,
    name: m.name ?? id,
    display_name: m.displayName ?? seeded.display_name ?? (origin === "relativity" ? humanize(id) : humanize(id)),
    description: m.description ?? seeded.description ?? "",
    origin,
    verified: (m.verified ?? (origin === "relativity" ? 1 : 0)) ? 1 : 0,
    listed_date: m.listed ?? seeded.listed_date ?? null,
    version: m.version ?? seeded.version ?? null,
    version_date: m.versionDate ?? seeded.version_date ?? null,
    license: m.license ?? seeded.license ?? null,
    safety: m.safety ?? (origin === "relativity" ? RELATIVITY_SAFETY : RELATIVITY_SAFETY),
    sources: m.sources ?? seeded.sources ?? [],
    categories: m.categories ?? seeded.categories ?? [],
    agent_category: m.agentCategory ?? seeded.agent_category ?? null,
    developer_url: m.developerUrl ?? null,
    country: m.country ?? seeded.country ?? null,
    avatar: m.avatar ?? seeded.avatar ?? null,
  };
  return base;
}

/** Every plugin directory on disk with its DB row (row wins; disk supplies the rest). */
export interface PluginRecord extends PluginRow {
  dir: string;
  skill_count: number;
  /** Manifest-only: which run-form category this plugin serves. */
  agent_category?: string | null;
}

function recordFor(id: string, dir: string, origin: "relativity" | "custom", row: PluginRow | null, skillCount: number): PluginRecord {
  const disk = metaFromDisk(id, dir, origin);
  const merged: PluginRow = {
    id,
    name: row?.name ?? disk.name ?? id,
    display_name: row?.display_name ?? disk.display_name ?? humanize(id),
    description: row?.description ?? disk.description ?? "",
    origin,
    verified: row?.verified ?? disk.verified ?? 0,
    listed_date: row?.listed_date ?? disk.listed_date ?? null,
    version: row?.version ?? disk.version ?? null,
    version_date: row?.version_date ?? disk.version_date ?? null,
    license: row?.license ?? disk.license ?? null,
    safety: row?.safety ?? disk.safety ?? RELATIVITY_SAFETY,
    sources: row?.sources?.length ? row.sources : (disk.sources ?? []),
    categories: row?.categories?.length ? row.categories : (disk.categories ?? []),
    developer_url: row?.developer_url ?? disk.developer_url ?? null,
    // Row wins only once edited — "" (cleared) beats the manifest, NULL falls through.
    country: row?.country ?? disk.country ?? null,
    avatar: row?.avatar ?? disk.avatar ?? null,
    install_source: row?.install_source ?? null,
    created_at: row?.created_at,
    updated_at: row?.updated_at,
  };
  // agent_category is manifest-only (never persisted) — plugin.json is the
  // single source of truth for which run-form category a plugin serves.
  return { ...merged, dir, skill_count: skillCount, agent_category: disk.agent_category };
}

function scanRoot(root: string, origin: "relativity" | "custom"): { id: string; dir: string; skills: string }[] {
  let entries: string[];
  try {
    entries = readdirSync(root).sort();
  } catch {
    return [];
  }
  const out: { id: string; dir: string; skills: string }[] = [];
  for (const id of entries) {
    const dir = join(root, id);
    if (!isDir(dir)) continue;
    const skills = join(dir, "skills");
    const count = isDir(skills) ? skillSubdirs(skills).length : 0;
    // A plugin is a dir with a manifest or at least one skill.
    if (!count && !existsSync(join(dir, "plugin.json"))) continue;
    out.push({ id, dir, skills });
  }
  return out;
}

export function listPlugins(): PluginRecord[] {
  const rows = new Map<string, PluginRow>();
  for (const r of listPluginRowsSync()) rows.set(r.id, r);
  const out: PluginRecord[] = [];
  for (const [root, origin] of [
    [RELATIVITY_PLUGINS_DIR, "relativity"],
    [customPluginsDir(), "custom"],
  ] as const) {
    for (const d of scanRoot(root, origin)) {
      out.push(recordFor(d.id, d.dir, origin, rows.get(d.id) ?? null, skillSubdirs(d.skills).length));
    }
  }
  return out;
}

export function getPlugin(id: string): PluginRecord | null {
  return listPlugins().find((p) => p.id === id) ?? null;
}

/** All skills of one plugin, parsed from disk. */
export function pluginSkills(id: string): HarnessSkill[] {
  const dir = pluginSkillsDir(id);
  if (!dir) return [];
  const origin = pluginOrigin(id) ?? "custom";
  const source = origin === "relativity" ? "builtin" : "custom";
  const out: HarnessSkill[] = [];
  for (const slug of skillSubdirs(dir)) {
    try {
      const skillDir = join(dir, slug);
      const { skill, issues } = parseSkillMarkdown(readFileSync(join(skillDir, "SKILL.md"), "utf8"), source, slug, skillDir);
      if (skill) out.push(skill);
      else console.warn(`[plugins] ${id}/${slug} failed to parse: ${issues.map((i) => i.message).join("; ")}`);
    } catch (e: any) {
      console.warn(`[plugins] ${id}/${slug} read failed: ${e?.message}`);
    }
  }
  return out;
}

export function pluginSkillIds(id: string): string[] {
  const dir = pluginSkillsDir(id);
  return dir ? skillSubdirs(dir) : [];
}

/**
 * Which skills a run uses: an explicit selection (New Run's skill checkboxes,
 * filtered to what the selected plugins actually contain) — else every skill
 * of the plugins. With no plugins (legacy rows) the requested ids pass
 * through as-is; a selection that resolves to nothing self-heals to "all"
 * rather than silently running bare.
 */
export function selectRunSkills(pluginIds: string[], requested?: string[] | null): string[] {
  const all = [...new Set(pluginIds.flatMap((p) => pluginSkillIds(p)))];
  if (!requested?.length) return all;
  const selected = [...new Set(pluginIds.length ? requested.filter((s) => all.includes(s)) : requested)];
  return selected.length ? selected : all;
}

// ── Resolution helpers (run path) ───────────────────────────────────────────

/** skill id → owning plugin id (disk scan; used for legacy backfill). */
export function skillToPluginIndex(): Map<string, string> {
  const index = new Map<string, string>();
  for (const p of listPlugins()) for (const s of pluginSkillIds(p.id)) if (!index.has(s)) index.set(s, p.id);
  return index;
}

/** Which plugins own these skills (unknown skills are dropped). */
export function pluginsForSkills(skillIds: string[]): string[] {
  const index = skillToPluginIndex();
  const out = new Set<string>();
  for (const id of skillIds) {
    const plugin = index.get(id);
    if (plugin) out.add(plugin);
  }
  return [...out];
}

// ── Metadata writes (custom plugins only) ───────────────────────────────────

const META_FIELDS = [
  "display_name", "description", "listed_date", "version", "version_date",
  "license", "safety", "sources", "categories", "developer_url", "verified",
  "country", "avatar",
] as const;

export type PluginMetaPatch = Partial<Record<(typeof META_FIELDS)[number], unknown>>;

/** Update editable metadata. Relativity plugins are read-only → null. */
export async function updatePluginMeta(id: string, patch: PluginMetaPatch): Promise<PluginRecord | null> {
  if (pluginOrigin(id) !== "custom") return null;
  const current = getPlugin(id);
  if (!current) return null;
  // Start from the whole current row: upsertPluginRow INSERT OR REPLACEs, so a
  // patch carrying only its own keys would rebuild the row without the NOT NULL
  // columns (name) and reset every field the patch didn't mention.
  // agent_category is manifest-only — never persisted.
  const { dir: _dir, skill_count: _skillCount, agent_category: _ac, ...fields } = current;
  const clean: Record<string, unknown> = { ...fields, id, updated_at: new Date().toISOString() };
  for (const field of META_FIELDS) {
    if (!(field in patch)) continue;
    const v = patch[field];
    if (field === "verified") clean[field] = v ? 1 : 0;
    else if (field === "sources") {
      if (!Array.isArray(v)) return null;
      clean[field] = v
        .filter((s: any) => s && typeof s.url === "string" && /^https?:\/\//.test(s.url))
        .map((s: any) => ({ label: String(s.label || s.url), url: String(s.url) }));
    } else if (field === "categories") {
      clean[field] = Array.isArray(v) ? v.map(String).slice(0, 24) : [];
    } else if (field === "country") {
      // ISO-2 only; anything else (or cleared) = "" = all countries.
      const code = String(v ?? "").toUpperCase().replace(/[^A-Z]/g, "");
      clean[field] = /^[A-Z]{2}$/.test(code) ? code : "";
    } else if (field === "avatar") {
      // Image URL only — a non-http(s) value (javascript:, junk) clears it.
      const url = String(v ?? "").trim();
      clean[field] = /^https?:\/\/\S+$/i.test(url) ? url.slice(0, 2000) : "";
    } else {
      clean[field] = v == null ? null : String(v).slice(0, 2000);
    }
  }
  const row = await upsertPluginRow(clean);
  const dir = pluginDir(id)!;
  return recordFor(id, dir, "custom", row, skillSubdirs(join(dir, "skills")).length);
}

/** Delete a custom plugin (dir + row). Relativity plugins → false. */
export function deletePlugin(id: string): boolean {
  if (pluginOrigin(id) !== "custom") return false;
  const dir = pluginDir(id);
  if (dir) rmSync(dir, { recursive: true, force: true });
  void deletePluginRow(id);
  return true;
}

// ── Files (the navigator) ───────────────────────────────────────────────────

const SKIP_DIRS = new Set(["node_modules", ".git", "__pycache__", ".venv"]);
const MAX_READ_BYTES = 512 * 1024;

/** Whole plugin as a flat path → content map (text files only, traversal-safe). */
export function readPluginFiles(id: string): { files: Record<string, string>; skipped: string[] } {
  const dir = pluginDir(id);
  const files: Record<string, string> = {};
  const skipped: string[] = [];
  if (!dir) return { files, skipped };
  const walk = (base: string, rel: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(base).sort();
    } catch {
      return;
    }
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry)) continue;
      const p = join(base, entry);
      const relPath = rel ? `${rel}/${entry}` : entry;
      try {
        const st = statSync(p);
        if (st.isDirectory()) walk(p, relPath);
        else if (st.size > MAX_READ_BYTES) skipped.push(relPath);
        else {
          const buf = readFileSync(p);
          // Null byte in the head → binary; show it as skipped, not garbage.
          if (buf.subarray(0, 1024).includes(0)) skipped.push(relPath);
          else files[relPath] = buf.toString("utf8");
        }
      } catch {
        skipped.push(relPath);
      }
    }
  };
  walk(dir, "");
  return { files, skipped };
}

/** Validate an untrusted flat file map: no absolute paths, no `..`, strings only. */
export function normalizePluginFiles(raw: unknown): Record<string, string> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: Record<string, string> = {};
  for (const [path, content] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof content !== "string") return null;
    if (!path || path.startsWith("/") || path.includes("\\")) return null;
    const segments = path.split("/");
    if (path.endsWith("/")) segments.pop();
    if (!segments.length || segments.some((s) => s === "" || s === "." || s === "..")) return null;
    if (path.endsWith("/") && content !== "") return null;
    out[path] = content;
  }
  return Object.keys(out).length ? out : null;
}

/** Write files into a custom plugin (merge). Returns false when read-only/invalid. */
export function writePluginFiles(id: string, files: Record<string, string>, deleted: string[] = []): boolean {
  if (pluginOrigin(id) !== "custom") return false;
  const dir = pluginDir(id);
  if (!dir) return false;
  const root = resolve(dir);
  for (const path of deleted) {
    if (!path || path.startsWith("/") || path.includes("..") || path.includes("\\")) continue;
    const target = resolve(join(root, path));
    if (!target.startsWith(root + sep)) continue;
    rmSync(target, { recursive: true, force: true });
  }
  for (const [path, content] of Object.entries(files)) {
    const target = resolve(join(root, path));
    if (!target.startsWith(root + sep)) return false;
    mkdirSync(join(target, ".."), { recursive: true });
    writeFileSync(target, content);
  }
  return true;
}

// ── Import (upload / URL) ───────────────────────────────────────────────────

function slugify(input: string): string {
  return input.toLowerCase().replace(/\.git$/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "plugin";
}

const MAX_IMPORT_FILES = 2000;
const MAX_IMPORT_BYTES = 64 * 1024 * 1024;

/** Refuse absurd trees before copying them anywhere. */
function importLooksReasonable(src: string): { ok: boolean; error?: string } {
  let files = 0;
  let bytes = 0;
  const walk = (base: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(base);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry)) continue;
      const p = join(base, entry);
      try {
        const st = statSync(p);
        if (st.isDirectory()) walk(p);
        else {
          files++;
          bytes += st.size;
          if (files > MAX_IMPORT_FILES || bytes > MAX_IMPORT_BYTES) return;
        }
      } catch {
        // unreadable — ignore
      }
    }
  };
  walk(src);
  if (files > MAX_IMPORT_FILES) return { ok: false, error: `too many files (${files} > ${MAX_IMPORT_FILES})` };
  if (bytes > MAX_IMPORT_BYTES) return { ok: false, error: `plugin too large (${Math.round(bytes / 1024 / 1024)} MB > 64 MB)` };
  return { ok: true };
}

/** The plugin root inside a fetched tree: the dir itself, or one level down. */
function findPluginRoot(base: string): string | null {
  const looksLikePlugin = (d: string) => existsSync(join(d, "plugin.json")) || isDir(join(d, "skills"));
  if (looksLikePlugin(base)) return base;
  let entries: string[];
  try {
    entries = readdirSync(base);
  } catch {
    return null;
  }
  for (const entry of entries) {
    const d = join(base, entry);
    if (isDir(d) && looksLikePlugin(d)) return d;
  }
  return null;
}

export interface ImportResult {
  plugin?: PluginRecord;
  error?: string;
}

/** Copy a plugin tree into data/plugins/<id> (re-import overwrites the dir). */
export async function importPluginFromDir(src: string, installSource?: string): Promise<ImportResult> {
  const root = findPluginRoot(src);
  if (!root) return { error: "No plugin.json or skills/ directory found — that folder isn't a plugin." };
  const size = importLooksReasonable(root);
  if (!size.ok) return { error: size.error! };

  const manifest = readManifest(root);
  const id = slugify(manifest?.name || root.split("/").pop() || "plugin");
  const dest = join(customPluginsDir(), id);
  const hadSkills = skillSubdirs(join(dest, "skills")).length;
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(customPluginsDir(), { recursive: true });
  cpSync(root, dest, { recursive: true });

  // A skills-only folder (no manifest) is still a valid plugin — write one so
  // the dir always carries its identity.
  if (!existsSync(join(dest, "plugin.json"))) {
    writeFileSync(join(dest, "plugin.json"), JSON.stringify({ name: id, description: manifest?.description ?? "" }, null, 2));
  }

  const disk = metaFromDisk(id, dest, "custom");
  const existing = getPluginRowSync(id);
  await upsertPluginRow({
    ...(existing ?? disk),
    ...disk,
    id,
    origin: "custom",
    install_source: installSource ?? existing?.install_source ?? null,
    created_at: existing?.created_at,
  });
  const plugin = getPlugin(id);
  if (!plugin) return { error: "Import failed — the plugin could not be read back." };
  if (hadSkills && plugin.skill_count === 0) {
    // overwritten with something that has no skills — still fine, but say it
    return { plugin, error: "Imported, but no skills with SKILL.md were found." };
  }
  return { plugin };
}

const GITHUB_URL = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/;

/** Import from a GitHub repo URL (git clone --depth 1 into a temp dir). */
export async function importPluginFromUrl(url: string): Promise<ImportResult> {
  const match = url.trim().match(GITHUB_URL);
  if (!match) return { error: "Only GitHub repository URLs are supported (https://github.com/owner/repo)." };
  const tmp = mkdtempSync(join(tmpdir(), "plugin-import-"));
  try {
    await execFileAsync("git", ["clone", "--depth", "1", "--quiet", url.trim()], { timeout: 60_000, cwd: tmp });
    const repoDir = join(tmp, match[2].replace(/\.git$/, ""));
    return await importPluginFromDir(existsSync(repoDir) ? repoDir : tmp, url.trim());
  } catch (e: any) {
    return { error: `Clone failed: ${e?.message || e}` };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** Extract an uploaded zip (system unzip) and import from it. */
export async function importPluginFromZip(buffer: Buffer): Promise<ImportResult> {
  const tmp = mkdtempSync(join(tmpdir(), "plugin-zip-"));
  const zip = join(tmp, "plugin.zip");
  try {
    writeFileSync(zip, buffer);
    // unzip refuses ".." entries by default — no zip-slip out of tmp.
    await execFileAsync("unzip", ["-o", "-q", zip, "-d", join(tmp, "x")], { timeout: 30_000 });
    return await importPluginFromDir(join(tmp, "x"), "upload");
  } catch (e: any) {
    return { error: `Could not read that zip: ${e?.message || e}` };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// ── Boot tasks (idempotent, cheap after the first run) ──────────────────────

/** Ensure every plugin dir has a metadata row (seeded Relativity defaults). */
export async function seedPluginMeta(): Promise<void> {
  const rows = new Map((await listPluginRows()).map((r) => [r.id, r]));
  for (const p of listPlugins()) {
    if (rows.has(p.id)) continue;
    const disk = metaFromDisk(p.id, p.dir, p.origin);
    await upsertPluginRow({ ...disk, id: p.id, origin: p.origin, install_source: p.origin === "relativity" ? "seed" : null });
  }
}

/** Move legacy data/skills/<user>/<skill>/ trees into the my-skills plugin. */
export function migrateLegacyCustomSkills(): void {
  const legacyRoot = join(process.cwd(), "data", "skills");
  if (!isDir(legacyRoot)) return;
  const destRoot = join(customPluginsDir(), MY_SKILLS_PLUGIN_ID, "skills");
  for (const user of readdirSync(legacyRoot)) {
    const userDir = join(legacyRoot, user);
    if (!isDir(userDir)) continue;
    for (const skill of readdirSync(userDir)) {
      const src = join(userDir, skill);
      if (!isDir(src) || !existsSync(join(src, "SKILL.md"))) continue;
      const dest = join(destRoot, skill);
      if (existsSync(dest)) continue;
      mkdirSync(destRoot, { recursive: true });
      try {
        renameSync(src, dest);
      } catch {
        cpSync(src, dest, { recursive: true });
      }
    }
  }
}

/**
 * Backfill plugin_ids for runs / alert rules created before plugins existed.
 * Maps each row's skill_ids (and a legacy agent's skill list) through the
 * skill→plugin index. Rows stay NULL only when nothing maps — the UI then
 * falls back to the stored agent_name with a "Legacy" chip. Re-runs each boot
 * but only ever sees the shrinking NULL set.
 */
export function backfillPluginRefs(): void {
  try {
    const index = skillToPluginIndex();
    // Legacy agent files → their skill ids → plugins. Keyed by BOTH name and
    // id: runs stored the name, alert rules stored the agent id.
    const agentSkills = new Map<string, string[]>();
    try {
      for (const userId of readdirSync(join(process.cwd(), "data", "agents"))) {
        for (const a of listAgents(userId)) {
          agentSkills.set(a.name, a.skillIds);
          agentSkills.set(a.id, a.skillIds);
        }
      }
    } catch {
      // no legacy agent files — skills-only mapping
    }
    const mapRow = (skillIds: string[] | null, ...agentKeys: (string | null | undefined)[]): string[] => {
      const ids = [...(skillIds ?? [])];
      for (const key of agentKeys) {
        if (key && agentSkills.has(key)) ids.push(...(agentSkills.get(key) ?? []));
      }
      const plugins = new Set<string>();
      for (const s of ids) {
        const p = index.get(s);
        if (p) plugins.add(p);
      }
      return [...plugins];
    };

    for (const run of listRunsMissingPlugins()) {
      setRunPluginIds(run.id, mapRow(run.skill_ids, run.agent_name));
    }
    for (const rule of listAlertRulesMissingPlugins()) {
      setAlertRulePluginIds(rule.id, mapRow(rule.skill_ids, rule.agent_id));
    }
  } catch (e: any) {
    console.warn(`[plugins] backfill failed: ${e?.message || e}`);
  }
}

/** One call at server boot: legacy moves, seeded rows, run/rule backfill. */
export async function initPlugins(): Promise<void> {
  try {
    migrateLegacyCustomSkills();
    await seedPluginMeta();
    backfillPluginRefs();
  } catch (e: any) {
    console.warn(`[plugins] init failed: ${e?.message || e}`);
  }
}
