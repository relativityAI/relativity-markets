import express from "express";
import cors from "cors";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { encrypt, decrypt } from "./crypto.js";
import { getUserSettings, upsertUserSettings } from "../db/settings.js";
import {
  insertAlertRuleRow,
  listAlertRuleRows,
  deleteAlertRuleRow,
  setAlertRuleEnabled,
  listAlertRows,
  markAlertRead,
  markAllAlertsRead,
  listWatchlistRows,
  getWatchlistRow,
  insertWatchlistRow,
  updateWatchlistRow,
  deleteWatchlistRow,
  listRunRows,
  listRunSummaries,
  getRunRow,
  updateRunRowForUser,
  deleteRunRow,
  getMeta,
} from "../db/repo.js";
import { fetchUserKeys, ensureUserSettings } from "./provision.js";
import { disabledMcpNames, parseMcpPrefs, runMcpEntries } from "./mcp.js";
import { healthSources, probeAll, probeEntry } from "./datasources.js";
import type { McpSourceConfig } from "../harness/tools/sources.js";
import { getModels, getModelIds, getAvailableModelsForUser } from "./models.js";
import { getAgentCategories } from "./categories.js";
import { getSources, searchStocks } from "./discovery.js";
import { tickerLogoUrl } from "./tickerLogos.js";
import { getPriceHistory, toYahooSymbol } from "../harness/marketdata.js";
import { yf } from "./yf-client.js";
import { getMetricsCatalog, getFlatCatalog, mergeCatalogFields, normalizeQuantRules, type MetricDef } from "./metrics.js";
import { keyPool } from "./keypool.js";
import { buildModel, type LlmKeys } from "../harness/model.js";
import { classifyModelError } from "./modelcheck.js";
import { processBuilderTurn, extractDocumentSignals, skillDraftTurn, type BuilderRequest, type SkillDraftRequest } from "../harness/drafts.js";
import { getToolCatalog, MCP_LABELS } from "../harness/tools/catalog.js";
// Artifact files render workbooks per request — lazy so a bad workbook can't
// take the whole server down.
import type { WorkbookRecipe } from "../harness/artifacts/types.js";
import { getPreset, listPresets } from "./presets.js";
import {
  listAllSkillsForUser, saveCustomSkill, deleteCustomSkill, loadBuiltinSkills,
  normalizeSkillFiles, getBuiltinSkillFiles, getCustomSkillFiles, fixSkillMarkdown,
  parseSkillMarkdown, slugifySkillName,
  type SkillFiles,
} from "../harness/skills.js";
import { fetchSkillMarkdown, listRepoSkills, listSkillRepos, resolveSkillPath } from "../harness/skill-repos.js";
import {
  // Harness module — one interface (see harness/index.ts).
  listAgents as listHarnessAgents, // legacy read only: resolves old UUID agent_name in PDF exports
  loadSystemPrompts,
  loadRunFileConfig,
  resolveRunConfig,
  listPlugins,
  getPlugin,
  pluginSkills,
  updatePluginMeta,
  deletePlugin,
  readPluginFiles,
  writePluginFiles,
  normalizePluginFiles,
  importPluginFromUrl,
  importPluginFromZip,
  initPlugins,
  type PluginRecord,
  type ReportDocument,
  type Verdict,
} from "../harness/index.js";
import { resumePausedRun, retryFailedRun, startAnalysisRun, startStaleRunSweeper } from "./runs.js";
import { startAlertTicker, isValidTime, isValidTimeZone, isValidFrequency, todayInTz, occurrencesBetween } from "./schedule.js";
import { extractText } from "./upload.js";
import multer from "multer";
import { requireAuth, type AuthedRequest } from "./auth.js";
import { log, paint } from "./logger.js";
import { buildReportPdf, isUuid } from "./pdf.js";
import { traceHub, nextSeq } from "../harness/trace.js";
import type { TraceRowEvent } from "../harness/trace.js";
import { bootTracing } from "../harness/index.js";

// Langfuse tracing (callback handler) — no-op without env keys.
await bootTracing();
// Plugins: move legacy custom skills, seed metadata rows, backfill run/rule
// plugin references. Idempotent; cheap after the first run.
await initPlugins();

const METHOD_COLORS: Record<string, string> = {
  GET: "1;32",
  POST: "1;33",
  PUT: "1;34",
  PATCH: "1;35",
  DELETE: "1;31",
  OPTIONS: "1;36",
};

const normalizeEval = (ev: any): any =>
  ev ? { ...ev, quantitative: normalizeQuantRules(ev.quantitative || []) } : ev;

function methodColor(method: string): string {
  return METHOD_COLORS[method] || "37";
}

function statusColor(code: number): string {
  if (code >= 500) return "1;31";
  if (code >= 400) return "1;33";
  if (code >= 300) return "36";
  return "1;32";
}

// Harness persistence: agents and skills live as markdown on the filesystem
// (data/agents/**, data/skills/**) — no adapter installation needed.

const app = express();
app.set("trust proxy", 1);

/** A GET the SPA owns: a browser navigation (no /api prefix) must fall
 *  through to index.html — the client always calls these as /api/...,
 *  marked by the strip middleware below. */
const apiOnly = (req: express.Request, _res: express.Response, next: express.NextFunction): void => {
  (req as unknown as { apiPath?: boolean }).apiPath ? next() : next("route");
};
// Clients call /api/... — in dev vite's proxy and in docker nginx stripped the
// prefix. With UI+API in one process nothing else does, so strip it here.
// (req as any).apiPath marks stripped requests so the SPA fallback can skip them.
app.use(((req, _res, next) => {
  if (req.url === "/api" || req.url.startsWith("/api/")) {
    req.url = req.url.slice(4);
    (req as unknown as { apiPath?: boolean }).apiPath = true;
  }
  next();
}) as express.RequestHandler);
app.use(cors());
app.use(express.json({ limit: "10mb" }));

// ---- request context: id + response-body capture (for error logging) ----
app.use((req, res, next) => {
  (req as any)._reqId = randomUUID().slice(0, 8);
  res.setHeader("X-Rel-Request-Id", (req as any)._reqId);

  const json = res.json.bind(res);
  (res as any).json = (body: unknown) => {
    (res as any)._jsonBody = body;
    return json(body);
  };
  next();
});

// ---- access log: every call, every detail ----
app.use((req, res, next) => {
  const t = Date.now();
  res.on("finish", () => {
    const reqId = (req as any)._reqId || "-";
    const ms = Date.now() - t;
    const bytes = Number(res.getHeader("content-length") || 0);

    const parts = [
      paint(req.method, methodColor(req.method)),
      req.originalUrl,
      "->",
      paint(String(res.statusCode), statusColor(res.statusCode)),
      paint(`(${ms}ms, ${bytes ? (bytes / 1024).toFixed(1) + "KB" : "no body"})`, ms >= 1000 ? "1;33" : "2"),
      paint(`ip=${req.ip || "-"}`, "2"),
    ];

    if (req.method === "POST" && req.path === "/analysis") {
      const b = req.body || {};
      parts.push(
        paint(
          `body=${JSON.stringify({
            symbol: b.symbol,
            share_name: b.share_name,
            agent_name: b.agent_name,
            model: b.model,
            web_search: !!b.web_search,
            documents: (b.documents || []).length,
            web_sources: (b.web_sources || []).length,
          })}`,
          "36",
        ),
      );
    }

    const msg = parts.join(" ");

    // Keep the access log out of the default INFO stream — the UI polls
    // /health and friends constantly. Errors always log; slow calls log at
    // INFO; routine 2xx/3xx only surface with LOG_LEVEL=debug.
    if (res.statusCode >= 400) {
      const resp = (res as any)._jsonBody;
      const errStr = resp ? JSON.stringify(resp) : "";
      log.error(`[http:${reqId}]`, `${msg}${errStr ? ` ${paint(`resp=${errStr.slice(0, 500)}`, "1;35")}` : ""}`);
    } else if (ms >= 1000) {
      log.info(`[http:${reqId}]`, msg);
    } else {
      log.debug(`[http:${reqId}]`, msg);
    }
  });
  next();
});

// ---- simple per-IP rate limiter (agent runs are token-heavy) ----
const WINDOW_MS = 60_000;
const hits = new Map<string, number[]>();
app.use((req, _res, next) => {
  if (req.method === "OPTIONS") return next();
  if (req.method !== "POST" || req.path !== "/analysis") return next();
  const ip = req.ip || "unknown";
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  if (arr.length >= config.rateLimitPerMin) {
    _res.status(429).json({ error: `Rate limit reached (${config.rateLimitPerMin}/min)` });
    return;
  }
  arr.push(now);
  hits.set(ip, arr);
  next();
});



// ── routes ─────────────────────────────────────────────────────────────

// ---- health ----
app.get("/health", async (_req, res) => {
  let dbOk = false;
  try {
    dbOk = getMeta("first_run_at") != null;
  } catch {
    dbOk = false;
  }
  res.json({ ok: 1, db: dbOk });
});

// Data-source chips in the navbar — one real probe per configured MCP
// server (list derived from harness config, cached a minute; see datasources.ts).
app.get("/health/sources", async (_req, res) => {
  try {
    const { config: fileCfg } = loadRunFileConfig();
    const resolved = resolveRunConfig(process.env, fileCfg);
    res.json({ ok: 1, sources: await healthSources(resolved.tools?.mcp ?? []) });
  } catch (e: any) {
    res.status(503).json({ ok: 0, sources: {}, error: e.message });
  }
});

// ── user settings (encrypted API keys) ────────────────────────────────

app.get("/user/settings", requireAuth, async (req, res) => {
  try {
    const userId = (req as AuthedRequest).user.id;
    const data = await getUserSettings(userId);
    if (!data) return res.json({ llm_keys: {} });

    const llmKeysMasked: Record<string, string> = {};
    if (data.llm_keys_encrypted && typeof data.llm_keys_encrypted === "object") {
      for (const [k, v] of Object.entries(data.llm_keys_encrypted)) {
        // Legacy orphan: Tavily support is gone — never surface its key.
        if (k === "tavily") continue;
        try {
          const raw = decrypt(v);
          // An empty stored value is not a key — don't mask it into a truthy string.
          if (raw.trim()) llmKeysMasked[k] = raw.length > 8 ? raw.slice(0, 3) + "****" + raw.slice(-4) : "****";
        } catch {
          // Not valid ciphertext — a legacy plaintext value was stored; still counts as set.
          if (String(v).trim()) llmKeysMasked[k] = "****";
        }
      }
    }

    res.json({ llm_keys: llmKeysMasked, prefs: data.prefs ?? {} });
  } catch (e: any) {
    res.status(503).json({ error: e.message });
  }
});

app.put("/user/settings", requireAuth, async (req, res) => {
  try {
    const userId = (req as AuthedRequest).user.id;
    const { llm_keys } = req.body || {};

    const patch: Record<string, unknown> = {};
    // Merge instead of replace: llm_keys_encrypted carries unrelated keys
    // (custom MCP credentials), plus the client only ever sees masked values,
    // so a full replace would drop or corrupt them.
    if (llm_keys === null) {
      patch.llm_keys_encrypted = {};
    } else if (llm_keys !== undefined && typeof llm_keys === "object") {
      const existing = await getUserSettings(userId);
      const encrypted: Record<string, string> = { ...(existing?.llm_keys_encrypted || {}) };
      for (const [k, v] of Object.entries(llm_keys as Record<string, string>)) {
        encrypted[k] = v ? encrypt(String(v)) : "";
      }
      patch.llm_keys_encrypted = encrypted;
    }

    // Non-secret prefs (string values only) merge like keys do.
    const { prefs } = req.body || {};
    if (prefs !== undefined && typeof prefs === "object" && prefs !== null) {
      const existing = await getUserSettings(userId);
      patch.prefs = { ...(existing?.prefs || {}), ...(prefs as Record<string, string>) };
    }

    await upsertUserSettings(userId, patch as any);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(503).json({ error: e.message });
  }
});

app.delete("/user/settings/llm-key/:keyName", requireAuth, async (req, res) => {
  try {
    const userId = (req as AuthedRequest).user.id;
    const keyName = String(req.params.keyName);

    const data = await getUserSettings(userId);
    if (!data || !data.llm_keys_encrypted || !data.llm_keys_encrypted[keyName]) {
      return res.status(404).json({ error: "Key not found" });
    }

    const updated = { ...data.llm_keys_encrypted } as Record<string, string>;
    delete updated[keyName];

    await upsertUserSettings(userId, { llm_keys_encrypted: updated });
    res.json({ ok: true });
  } catch (e: any) {
    res.status(503).json({ error: e.message });
  }
});

// ---- categories (run form company-class list) ----

/** Agent class/category list (services/config/categories.yaml) — static, no auth. */
app.get("/categories", (_req, res) => {
  res.json(getAgentCategories());
});

// ---- plugins ----
// A plugin = a directory on disk (skills/ + optional plugin.json); metadata
// (sources, tags, version, disclaimer) lives in the `plugins` table.
// Relativity plugins (origin=relativity) are read-only; custom ones edit.

const pluginView = (p: PluginRecord) => {
  const { dir: _dir, ...rest } = p;
  return rest; // never leak the server-side directory path
};

/** List every plugin with its skill count (workspace directory). */
app.get("/plugins", apiOnly, (_req, res) => {
  try {
    res.json(listPlugins().map(pluginView));
  } catch (e: any) {
    res.status(503).json({ error: e.message });
  }
});

// Registered before GET /plugins/:id so "import" is never read as an id.
app.post("/plugins/import-url", requireAuth, async (req, res) => {
  try {
    const url = String(req.body?.url || "").trim();
    if (!url) return res.status(400).json({ error: "url is required" });
    const result = await importPluginFromUrl(url);
    if (!result.plugin) return res.status(400).json({ error: result.error || "Import failed" });
    res.status(201).json({ ...pluginView(result.plugin), warning: result.error });
  } catch (e: any) {
    res.status(503).json({ error: e.message });
  }
});

const pluginZipUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 64 * 1024 * 1024 } });
app.post("/plugins/import", requireAuth, pluginZipUpload.single("file"), async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: "a plugin zip file is required" });
    const result = await importPluginFromZip(file.buffer);
    if (!result.plugin) return res.status(400).json({ error: result.error || "Import failed" });
    res.status(201).json({ ...pluginView(result.plugin), warning: result.error });
  } catch (e: any) {
    res.status(503).json({ error: e.message });
  }
});

/** One plugin with its full skill list (detail page). */
app.get("/plugins/:id", apiOnly, requireAuth, async (req, res) => {
  try {
    const plugin = getPlugin(String(req.params.id));
    if (!plugin) return res.status(404).json({ error: "Plugin not found" });
    res.json({ ...pluginView(plugin), skills: pluginSkills(plugin.id) });
  } catch (e: any) {
    res.status(503).json({ error: e.message });
  }
});

/** Editable metadata — custom plugins only (Relativity → 403). */
app.put("/plugins/:id", requireAuth, async (req, res) => {
  try {
    const id = String(req.params.id);
    const plugin = getPlugin(id);
    if (!plugin) return res.status(404).json({ error: "Plugin not found" });
    if (plugin.origin === "relativity") return res.status(403).json({ error: "Relativity plugins are read-only" });
    const updated = await updatePluginMeta(id, (req.body?.meta ?? req.body) ?? {});
    if (!updated) return res.status(400).json({ error: "No valid metadata fields to update" });
    res.json(pluginView(updated));
  } catch (e: any) {
    res.status(503).json({ error: e.message });
  }
});

app.delete("/plugins/:id", requireAuth, async (req, res) => {
  try {
    const id = String(req.params.id);
    const plugin = getPlugin(id);
    if (!plugin) return res.status(404).json({ error: "Plugin not found" });
    if (plugin.origin === "relativity") return res.status(403).json({ error: "Relativity plugins cannot be deleted" });
    deletePlugin(id);
    res.json({ deleted: true });
  } catch (e: any) {
    res.status(503).json({ error: e.message });
  }
});

/** The plugin's files as a flat path→content map (the navigator). */
app.get("/plugins/:id/files", requireAuth, async (req, res) => {
  try {
    const id = String(req.params.id);
    if (!getPlugin(id)) return res.status(404).json({ error: "Plugin not found" });
    res.json(readPluginFiles(id));
  } catch (e: any) {
    res.status(503).json({ error: e.message });
  }
});

/** Write files into a custom plugin (merge; `deleted` removes paths). */
app.put("/plugins/:id/files", requireAuth, async (req, res) => {
  try {
    const id = String(req.params.id);
    const plugin = getPlugin(id);
    if (!plugin) return res.status(404).json({ error: "Plugin not found" });
    if (plugin.origin === "relativity") return res.status(403).json({ error: "Relativity plugins are read-only" });
    const files = normalizePluginFiles(req.body?.files);
    if (!files) {
      return res.status(400).json({ error: "Invalid files: values must be strings, no absolute paths, no \"..\", folders end with \"/\" and hold no content." });
    }
    const deleted = Array.isArray(req.body?.deleted) ? req.body.deleted.map(String) : [];
    if (!writePluginFiles(id, files, deleted)) return res.status(400).json({ error: "Could not write those files" });
    res.json(readPluginFiles(id));
  } catch (e: any) {
    res.status(503).json({ error: e.message });
  }
});

/** MCP servers for the Settings page and the New Run toggles: the
 *  preconfigured ones (harness config) plus the user's own, each with its
 *  url, enabled flag, live probe status and tool list.
 *  `?refresh=1` busts the one-minute probe cache (the Retry button). */
app.get("/mcp-sources", requireAuth, async (req, res) => {
  try {
    const userId = (req as AuthedRequest).user.id;
    const { config: fileCfg } = loadRunFileConfig();
    const resolved = resolveRunConfig(process.env, fileCfg);
    const configured = resolved.tools?.mcp ?? [];
    const { llmKeys, prefs } = await fetchUserKeys(userId);
    const entries = runMcpEntries(configured, prefs);
    const probes = await probeAll(entries, {
      keys: llmKeys,
      fresh: req.query.refresh === "1",
    });
    const off = disabledMcpNames(prefs);
    const catalog = getToolCatalog();
    const configuredNames = new Set(configured.map((c) => c.name));

    // What the run will see: live tools narrowed by the config's allow-list;
    // the static list (allow, else every catalog tool this name prefixes)
    // only when the probe couldn't reach the server (or, like SearXNG's
    // liveness check, reached it without a tools/list).
    const toolsFor = (entry: McpSourceConfig, probe: (typeof probes)[string] | undefined) => {
      const live = probe?.status === "up" && probe.tools.length ? probe.tools : null;
      if (!live) {
        return entry.allow?.length
          ? entry.allow
          : catalog.filter((t) => t.name.startsWith(`${entry.name}_`)).map((t) => t.name);
      }
      return entry.allow?.length ? live.filter((t) => entry.allow!.includes(t)) : live;
    };
    const row = (entry: McpSourceConfig, custom: boolean) => {
      const p = probes[entry.name];
      const keyName = entry.keyFrom ?? null;
      return {
        name: entry.name,
        label: MCP_LABELS[entry.name] ?? entry.name,
        required: entry.required ?? true,
        url: entry.url ?? (entry.urlEnv ? process.env[entry.urlEnv] ?? "" : ""),
        urlEnv: entry.urlEnv ?? "",
        enabled: !off.has(entry.name),
        custom,
        status: p?.status ?? "down",
        error: p?.error ?? null,
        lastChecked: p?.at ?? null,
        keyName,
        hasKey: keyName ? !!llmKeys[keyName] : false,
        tools: toolsFor(entry, p),
      };
    };

    res.json({
      servers: [
        ...configured.map((e) => row(e, false)),
        ...entries.filter((e) => !configuredNames.has(e.name)).map((e) => row(e, true)),
      ],
    });
  } catch (e: any) {
    res.status(503).json({ error: e.message });
  }
});

/** Test-connection for the add/edit dialog: one fresh probe of the url the
 *  user is about to save — same validation, same honest result. `key` (when
 *  the form has one) rides along as the standard static Bearer credential. */
app.post("/mcp-sources/test", requireAuth, async (req, res) => {
  try {
    const url = String(req.body?.url ?? "").trim();
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
        return res.status(400).json({ error: "URL must be http:// or https://" });
    } catch {
      return res.status(400).json({ error: "URL must be a full URL, e.g. https://example.com/mcp" });
    }
    const key = typeof req.body?.key === "string" && req.body.key.trim() ? req.body.key.trim() : "";
    res.json(
      await probeEntry(
        { name: "test", url, ...(key ? { keyFrom: "testKey" } : {}) },
        { keys: { testKey: key }, fresh: true },
      ),
    );
  } catch (e: any) {
    res.status(503).json({ error: e.message });
  }
});

// ---- skills (built-in library + per-user custom skills) ----

/** List every skill available to the user: built-ins plus their own customs. */
app.get("/skills", requireAuth, async (req, res) => {
  try {
    const userId = (req as AuthedRequest).user.id;
    const skills = await listAllSkillsForUser(userId);
    res.json(skills.map((s) => ({ ...s, markdown: undefined })));
  } catch (e: any) {
    res.status(503).json({ error: e.message });
  }
});

// ---- GitHub skill sources (config/skill-repos.json) ----
// Registered before GET /skills/:id so "repos" is never read as a skill id.

/** The configured GitHub repositories skills can be downloaded from. */
app.get("/skills/repos", requireAuth, (_req, res) => {
  res.json(listSkillRepos());
});

/** SKILL.md files a repo ships — name and description peeked from frontmatter. */
app.get("/skills/repos/:id/skills", requireAuth, async (req, res) => {
  try {
    res.json(await listRepoSkills(String(req.params.id)));
  } catch (e: any) {
    res.status(e?.status || 503).json({ error: e.message });
  }
});

/** Download one SKILL.md from a repo into the signed-in user's library. */
app.post("/skills/repos/:id/import", requireAuth, async (req, res) => {
  try {
    const userId = (req as AuthedRequest).user.id;
    const path = String(req.body?.path || "");
    const target = await resolveSkillPath(String(req.params.id), path);
    if (!target) return res.status(404).json({ error: "That skill file was not found in the repository." });

    const markdown = await fetchSkillMarkdown(target.repo, target.branch, target.path);
    let { skill, issues } = await saveCustomSkill(userId, markdown);
    let repaired = false;
    if (!skill) {
      // Foreign skills occasionally trip our spec (name case, long description)
      // — repair with the directory name as fallback, same as validate does.
      const dirName = slugifySkillName(target.path.split("/").at(-2) || "skill");
      const fixed = fixSkillMarkdown(markdown, dirName);
      if (fixed) {
        ({ skill, issues } = await saveCustomSkill(userId, fixed));
        repaired = !!skill;
      }
    }
    if (!skill) {
      return res.status(400).json({ error: "That skill file failed validation.", issues });
    }
    res.json({ skill, issues, repaired });
  } catch (e: any) {
    res.status(503).json({ error: e.message });
  }
});

/** Full markdown of one skill (builtin or custom) for the editor. */
app.get("/skills/:id", requireAuth, async (req, res) => {
  try {
    const userId = (req as AuthedRequest).user.id;
    const skills = await listAllSkillsForUser(userId);
    const skill = skills.find((s) => s.id === req.params.id);
    if (!skill) return res.status(404).json({ error: "Skill not found" });
    const record = (skill.source === "custom"
      ? getCustomSkillFiles(userId, skill.id)
      : getBuiltinSkillFiles(skill.id)) ?? { skillId: skill.id, markdown: "", files: {} };
    res.json({ ...skill, markdown: record.markdown, files: record.files });
  } catch (e: any) {
    res.status(503).json({ error: e.message });
  }
});

/** Validate skill markdown without saving (editor live-check). */
app.post("/skills/validate", requireAuth, async (req, res) => {
  try {
    const md = String(req.body?.markdown || "");
    if (!md.trim()) {
      return res.json({ valid: false, issues: [{ line: 1, message: "empty markdown", severity: "error" }] });
    }
    const { skill, issues } = parseSkillMarkdown(md, "custom");
    const hasErrors = issues.some((i) => i.severity === "error");
    const fixed = hasErrors ? fixSkillMarkdown(md, String(req.body?.fallbackName || "")) : null;
    res.json({ valid: !!skill, parsed: skill, issues, fixed });
  } catch (e: any) {
    res.status(503).json({ error: e.message });
  }
});

/** Pull {markdown, files} from a skills write body. A whole-tree `files`
 *  payload wins over a bare `markdown` one; both are rejected when unusable. */
function skillWriteBody(body: any): { ok: true; markdown: string; files?: SkillFiles } | { ok: false; error: string } {
  if (body?.files !== undefined) {
    const files = normalizeSkillFiles(body.files);
    if (!files) {
      return { ok: false, error: "Invalid files: SKILL.md is required and non-empty, folder paths end with \"/\" and hold no content, and no path may be absolute or contain \"..\"." };
    }
    return { ok: true, markdown: files["SKILL.md"], files };
  }
  const markdown = String(body?.markdown || "");
  if (!markdown.trim()) return { ok: false, error: "markdown is required" };
  return { ok: true, markdown };
}

/** Create or update a custom skill from markdown (or a whole file tree). */
app.post("/skills", requireAuth, async (req, res) => {
  try {
    const userId = (req as AuthedRequest).user.id;
    const body = skillWriteBody(req.body);
    if (!body.ok) return res.status(400).json({ error: body.error });
    const { skill, issues } = await saveCustomSkill(userId, body.markdown, body.files);
    if (!skill) {
      const hard = issues.filter((i) => i.severity === "error");
      return res.status(400).json({ error: "skill failed validation", issues: hard.length ? hard : issues });
    }
    res.status(201).json({ skill, issues });
  } catch (e: any) {
    res.status(503).json({ error: e.message });
  }
});

// Update a skill's markdown. Works for custom skills (saved in place) and
// built-ins (fork-on-save: the user's edit is stored as a custom skill with
// the same id, which shadows the builtin for this user from then on).
app.put("/skills/:id", requireAuth, async (req, res) => {
  try {
    const userId = (req as AuthedRequest).user.id;
    const id = String(req.params.id);
    const body = skillWriteBody(req.body);
    if (!body.ok) return res.status(400).json({ error: body.error });
    const markdown = body.markdown;

    const { skill: parsed, issues } = parseSkillMarkdown(markdown, "custom");
    if (!parsed) {
      const hard = issues.filter((i) => i.severity === "error");
      return res.status(400).json({ error: "skill failed validation", issues: hard.length ? hard : issues });
    }
    if (parsed.id !== id) {
      return res.status(400).json({
        error: `The document's name ("${parsed.id}") does not match the skill being edited ("${id}"). Fix the name line in the frontmatter.`,
        issues,
      });
    }
    const { skill } = await saveCustomSkill(userId, markdown, body.files);
    res.json({ skill, issues });
  } catch (e: any) {
    res.status(503).json({ error: e.message });
  }
});

app.delete("/skills/:id", requireAuth, async (req, res) => {
  try {
    const userId = (req as AuthedRequest).user.id;
    if (loadBuiltinSkills().some((s) => s.id === req.params.id)) {
      return res.status(400).json({ error: "Built-in skills cannot be deleted" });
    }
    await deleteCustomSkill(userId, String(req.params.id));
    res.json({ deleted: true });
  } catch (e: any) {
    res.status(503).json({ error: e.message });
  }
});

// ---- AI skill authoring (conversational, validated drafts) ----
app.post("/skills/draft", requireAuth, async (req, res) => {
  try {
    const userId = (req as AuthedRequest).user.id;
    const body = req.body || {};
    const { llmKeys } = await fetchUserKeys(userId);
    const draftReq: SkillDraftRequest = {
      user_id: userId,
      model_id: String(body.model_id || keyPool.getDefaultModel(llmKeys)),
      llm_keys: llmKeys,
      messages: Array.isArray(body.messages) ? body.messages : [],
      requirements: typeof body.requirements === "string" ? body.requirements : "",
      current_draft: typeof body.current_draft === "string" ? body.current_draft : "",
    };
    const out = await skillDraftTurn(draftReq);
    res.json(out);
  } catch (e: any) {
    console.error("[skills/draft] FAILED:", e?.name, e?.message);
    if (e?.stack) console.error("[skills/draft] stack:", e.stack);
    const friendly =
      /No API key|api key/i.test(String(e?.message))
        ? e.message
        : `Skill drafting failed: ${e?.message || "unknown error"}. Try again or pick a different model.`;
    res.status(503).json({ error: friendly });
  }
});

// ---- analysis runs (authenticated, scoped to the signed-in user) ----
// POST /analysis is the live analysis entry point: it runs a harness agent
// (SOUL + skills + budget) and returns the typed ReportDocument.

app.post("/analysis", requireAuth, async (req, res) => {
  try {
    const body = req.body || {};
    const symbol = String(body.symbol || "").trim();
    const source = String(body.source || "NSE").toUpperCase();
    if (!symbol) return res.status(400).json({ error: "symbol is required" });
    if (source !== "NSE" && source !== "SEC") return res.status(400).json({ error: "source must be NSE or SEC" });
    // Request contract: plugin(s) required — every skill inside them loads.
    const pluginIds = Array.isArray(body.plugin_ids) ? body.plugin_ids.map(String).filter(Boolean) : [];
    const skillIds = Array.isArray(body.skills) && body.skills.length ? body.skills.map(String) : undefined;
    if (!pluginIds.length && !skillIds?.length) {
      return res.status(400).json({ error: "plugin_ids is required — select at least one plugin" });
    }
    const mcpEnabled = Array.isArray(body.mcp_enabled) ? body.mcp_enabled.map(String).filter(Boolean) : undefined;
    const prompt = typeof body.prompt === "string" && body.prompt.trim() ? body.prompt.trim() : undefined;

    const userId = (req as AuthedRequest).user.id;

    // Budget overrides (--max-steps / --max-tokens): only present keys are
    // forwarded, so an absent flag keeps the default budget.
    const budgetOverride: { maxSteps?: number; maxTokens?: number } = {};
    for (const [key, raw] of [["maxSteps", body.max_steps], ["maxTokens", body.max_tokens]] as const) {
      if (raw == null || raw === "") continue;
      const n = Number(raw);
      if (Number.isFinite(n)) budgetOverride[key] = n;
    }

    // Placeholder row + fire-and-forget launch (runs.ts owns both); the UI
    // redirects to the result page from the returned id.
    const runId = await startAnalysisRun({
      userId,
      symbol,
      source,
      pluginIds: pluginIds.length ? pluginIds : undefined,
      skillIds,
      mcpEnabled,
      model: body.model ? String(body.model) : undefined,
      systemPrompt: body.system_prompt ? String(body.system_prompt) : undefined,
      prompt,
      budget: budgetOverride,
    });
    res.json({ id: runId, status: "RUNNING" });
  } catch (e: any) {
    console.error("POST /analysis ERROR:", e);
    res.status(503).json({ error: e?.message || "Analysis failed" });
  }
});

// Human-in-the-loop: apply approval decisions to a paused run and continue it.
// decisions: one per pending actionRequest, in order —
//   { type: "approve" } | { type: "reject", message? } | { type: "edit", editedAction: { name, args } }
app.post("/analysis/:id/resume", requireAuth, async (req, res) => {
  try {
    const userId = (req as AuthedRequest).user.id;
    const decisions = req.body?.decisions;
    if (!Array.isArray(decisions) || !decisions.length) {
      return res.status(400).json({ error: "decisions array is required (one per pending action request)" });
    }
    const result = await resumePausedRun(userId, String(req.params.id), decisions as any[]);
    if (!result) return res.status(404).json({ error: "Run not found" });
    res.json({ id: result.runId, status: result.status, document: result.document, errors: result.errors });
  } catch (e: any) {
    console.error("POST /analysis/:id/resume ERROR:", e);
    res.status(503).json({ error: e?.message || "Resume failed" });
  }
});

// A failed run retries in place: same row, fresh execution — the Retry
// button on the run result page.
app.post("/analysis/:id/retry", requireAuth, async (req, res) => {
  try {
    const userId = (req as AuthedRequest).user.id;
    const outcome = await retryFailedRun(userId, String(req.params.id));
    if (outcome === "missing") return res.status(404).json({ error: "Run not found" });
    if (outcome === "not-failed") return res.status(409).json({ error: "Only a failed run can be retried" });
    res.json({ ok: true });
  } catch (e: any) {
    console.error("POST /analysis/:id/retry ERROR:", e);
    res.status(503).json({ error: e?.message || "Retry failed" });
  }
});

// ── Alert rules ─────────────────────────────────────────────────────────────
// A rule watches one symbol on a cadence; each fired run's verdict becomes an
// alert (see the ticker in schedule.ts). Routes kept at /alert-rules.

app.post("/alert-rules", requireAuth, async (req, res) => {
  try {
    const body = req.body || {};
    const symbol = String(body.symbol || "").trim();
    const source = String(body.source || "NSE").toUpperCase();
    const time = String(body.time || "").trim();
    const timezone = String(body.timezone || "").trim();
    const frequency = String(body.frequency || "daily").trim();
    if (!symbol) return res.status(400).json({ error: "symbol is required" });
    if (source !== "NSE" && source !== "SEC") return res.status(400).json({ error: "source must be NSE or SEC" });
    if (!isValidTime(time)) return res.status(400).json({ error: "time must be HH:MM" });
    if (!isValidTimeZone(timezone)) return res.status(400).json({ error: "timezone must be a valid IANA zone" });
    if (!isValidFrequency(frequency)) return res.status(400).json({ error: "frequency must be daily, weekly, biweekly or monthly" });
    const startDate = body.start_date ? String(body.start_date).trim() : "";
    if (startDate && !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return res.status(400).json({ error: "start_date must be YYYY-MM-DD" });
    const userId = (req as AuthedRequest).user.id;

    const pluginIds = Array.isArray(body.plugin_ids) ? body.plugin_ids.map(String).filter(Boolean) : [];
    const skillIds = Array.isArray(body.skills) && body.skills.length ? body.skills.map(String) : null;
    if (!pluginIds.length && !skillIds?.length) {
      return res.status(400).json({ error: "plugin_ids is required — select at least one plugin" });
    }
    const maxSteps = body.max_steps != null && body.max_steps !== "" && Number.isFinite(Number(body.max_steps)) ? Number(body.max_steps) : null;
    const maxTokens = body.max_tokens != null && body.max_tokens !== "" && Number.isFinite(Number(body.max_tokens)) ? Number(body.max_tokens) : null;
    const data = await insertAlertRuleRow({
      user_id: userId,
      symbol,
      share_name: String(body.share_name || symbol),
      source,
      plugin_ids: pluginIds.length ? pluginIds : null,
      model: body.model ? String(body.model) : null,
      system_prompt: body.system_prompt ? String(body.system_prompt) : null,
      skill_ids: skillIds,
      max_steps: maxSteps,
      max_tokens: maxTokens,
      time,
      timezone,
      frequency,
      start_date: startDate || todayInTz(timezone),
    });
    res.json(data);
  } catch (e: any) {
    console.error("POST /alert-rules ERROR:", e);
    res.status(503).json({ error: e?.message || "Could not create the alert" });
  }
});

app.get("/alert-rules", requireAuth, async (req, res) => {
  try {
    const userId = (req as AuthedRequest).user.id;
    res.json(await listAlertRuleRows(userId));
  } catch (e: any) {
    res.status(503).json({ error: e?.message || "Could not list alerts" });
  }
});

// Occurrences of every enabled rule inside a date window, for the calendars.
app.get("/alert-rules/occurrences", requireAuth, async (req, res) => {
  try {
    const from = String(req.query.from || "");
    const to = String(req.query.to || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      return res.status(400).json({ error: "from and to must be YYYY-MM-DD" });
    }
    // One month of grid, padded a day either side — anything wider is a client bug.
    if (+new Date(`${to}T00:00:00Z`) - +new Date(`${from}T00:00:00Z`) > 400 * 86_400_000) {
      return res.status(400).json({ error: "window too large" });
    }
    const userId = (req as AuthedRequest).user.id;
    const rules = (await listAlertRuleRows(userId)).filter((r) => r.enabled);
    res.json(rules.flatMap((r) => occurrencesBetween(r, from, to).map((o) => ({ rule_id: r.id, ...o }))));
  } catch (e: any) {
    console.error("GET /alert-rules/occurrences ERROR:", e);
    res.status(503).json({ error: e?.message || "Could not list occurrences" });
  }
});

app.patch("/alert-rules/:id", requireAuth, async (req, res) => {
  try {
    const userId = (req as AuthedRequest).user.id;
    const enabled = Boolean(req.body?.enabled);
    await setAlertRuleEnabled(userId, String(req.params.id), enabled);
    res.json({ ok: true, enabled });
  } catch (e: any) {
    res.status(503).json({ error: e?.message || "Could not update the alert" });
  }
});

app.delete("/alert-rules/:id", requireAuth, async (req, res) => {
  try {
    const userId = (req as AuthedRequest).user.id;
    await deleteAlertRuleRow(userId, String(req.params.id));
    res.json({ ok: true });
  } catch (e: any) {
    res.status(503).json({ error: e?.message || "Could not delete the alert" });
  }
});

// ── Alerts (fired verdicts) ─────────────────────────────────────────────────

app.get("/alerts", requireAuth, async (req, res) => {
  try {
    const userId = (req as AuthedRequest).user.id;
    res.json(await listAlertRows(userId));
  } catch (e: any) {
    res.status(503).json({ error: e?.message || "Could not list alerts" });
  }
});

app.post("/alerts/:id/read", requireAuth, async (req, res) => {
  try {
    const userId = (req as AuthedRequest).user.id;
    await markAlertRead(userId, String(req.params.id));
    res.json({ ok: true });
  } catch (e: any) {
    res.status(503).json({ error: e?.message || "Could not mark the alert read" });
  }
});

app.post("/alerts/read-all", requireAuth, async (req, res) => {
  try {
    const userId = (req as AuthedRequest).user.id;
    await markAllAlertsRead(userId);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(503).json({ error: e?.message || "Could not mark alerts read" });
  }
});

// ── Watchlists ──────────────────────────────────────────────────────────────
// Named symbol lists on the home page. Items are `{ symbol, source?, name? }`;
// the client joins in live run data from /analysis.

app.get("/watchlists", requireAuth, async (req, res) => {
  try {
    res.json(await listWatchlistRows((req as AuthedRequest).user.id));
  } catch (e: any) {
    res.status(503).json({ error: e?.message || "Could not list watchlists" });
  }
});

app.post("/watchlists", requireAuth, async (req, res) => {
  try {
    const body = req.body || {};
    const name = String(body.name || "").trim();
    if (!name) return res.status(400).json({ error: "name is required" });
    const items = Array.isArray(body.items) ? body.items : [];
    res.json(await insertWatchlistRow({
      user_id: (req as AuthedRequest).user.id,
      name,
      items,
    }));
  } catch (e: any) {
    res.status(503).json({ error: e?.message || "Could not create watchlist" });
  }
});

app.put("/watchlists/:id", requireAuth, async (req, res) => {
  try {
    const userId = (req as AuthedRequest).user.id;
    const id = String(req.params.id);
    const body = req.body || {};
    const patch: { name?: string; items?: any[] } = {};
    if (body.name !== undefined) {
      const name = String(body.name).trim();
      if (!name) return res.status(400).json({ error: "name cannot be empty" });
      patch.name = name;
    }
    if (body.items !== undefined) {
      if (!Array.isArray(body.items)) return res.status(400).json({ error: "items must be an array" });
      patch.items = body.items;
    }
    if (!(await getWatchlistRow(userId, id))) return res.status(404).json({ error: "Watchlist not found" });
    res.json(await updateWatchlistRow(userId, id, patch));
  } catch (e: any) {
    res.status(503).json({ error: e?.message || "Could not update watchlist" });
  }
});

app.delete("/watchlists/:id", requireAuth, async (req, res) => {
  try {
    const userId = (req as AuthedRequest).user.id;
    const removed = await deleteWatchlistRow(userId, String(req.params.id));
    if (!removed) return res.status(404).json({ error: "Watchlist not found" });
    res.json({ ok: true });
  } catch (e: any) {
    res.status(503).json({ error: e?.message || "Could not delete watchlist" });
  }
});

app.get("/analysis", apiOnly, requireAuth, async (req, res) => {
  try {
    const userId = (req as AuthedRequest).user.id;
    // Summary columns only — the full report/trace stay in the DB; the list
    // surfaces the verdict extracted from the report json.
    const docs = await listRunSummaries(userId);
    res.json(docs);
  } catch (e: any) {
    res.status(503).json({ error: e.message });
  }
});

// Cancel a saved run that is still marked pending or running.
app.post("/analysis/:id/cancel", requireAuth, async (req, res) => {
  try {
    const userId = (req as AuthedRequest).user.id;
    const id = String(req.params.id);
    const row = await getRunRow(userId, id);
    if (!row) return res.status(404).json({ error: "Analysis not found" });
    const s = String(row.status || "").toUpperCase();
    if (s !== "PENDING" && s !== "RUNNING") {
      return res.status(409).json({ error: `Run already ${s.toLowerCase()}; nothing to cancel` });
    }
    await updateRunRowForUser(userId, id, { status: "CANCELED", error: "Canceled by the user." });
    res.json({ canceled: true });
  } catch (e: any) {
    res.status(503).json({ error: e.message });
  }
});

app.get("/analysis/:id", apiOnly, requireAuth, async (req, res) => {
  try {
    const userId = (req as AuthedRequest).user.id;
    const data = await getRunRow(userId, String(req.params.id));
    if (!data) return res.status(404).json({ error: "Analysis not found" });
    // Harness runs store their typed ReportDocument in `report`; the result
    // view reads `report_document`, so surface it under that name.
    if ((data as any).report?.schema === "relativity/report.v1" || (data as any).report?.schema === "relativity/report.v2") (data as any).report_document = (data as any).report;
    res.json(data);
  } catch (e: any) {
    res.status(503).json({ error: e.message });
  }
});

app.delete("/analysis/:id", requireAuth, async (req, res) => {
  try {
    const userId = (req as AuthedRequest).user.id;
    await deleteRunRow(userId, String(req.params.id));
    res.json({ deleted: true });
  } catch (e: any) {
    res.status(503).json({ error: e.message });
  }
});

// Server-generated PDF export of the analysis report (same plots as the UI).
app.get("/analysis/:id/pdf", requireAuth, async (req, res) => {
  try {
    const userId = (req as AuthedRequest).user.id;
    const data = await getRunRow(userId, String(req.params.id));
    if (!data) return res.status(404).json({ error: "Analysis not found" });
    if (!data.quantitative_analysis && !data.qualitative_analysis && !data.report) {
      return res.status(409).json({ error: "No analysis to export" });
    }
    // Legacy runs stored the agent's UUID in agent_name. Resolve it to the real
    // agent name for the report header/footer (and fall back to the masked
    // label inside the PDF builder if the agent no longer exists).
    if (data.agent_name && isUuid(data.agent_name)) {
      const agents = await listHarnessAgents(userId);
      (data as any).agent_display_name = agents.find((a) => a.id === data.agent_name)?.name || "";
    }
    const pdf = await buildReportPdf(data);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent((data.share_name || data.symbol || "analysis").replace(/\s+/g, "-"))}.pdf"`);
    res.send(Buffer.from(pdf));
  } catch (e: any) {
    log.error("[pdf]", e.message);
    res.status(503).json({ error: `PDF generation failed: ${e.message}` });
  }
});

// Download a skill artifact. The recipe is already stored with the analysis run;
// the binary is built here, per request, so no file is ever persisted or cached.
app.get("/analysis/:id/artifact/:artifactId", requireAuth, async (req, res) => {
  try {
    const userId = (req as AuthedRequest).user.id;
    const data = await getRunRow(userId, String(req.params.id));
    if (!data) return res.status(404).json({ error: "Analysis not found" });

    const outputs: any[] = Array.isArray(data.skill_outputs) ? data.skill_outputs : [];
    const skillId = String(req.params.artifactId).split(":")[0];
    const wanted = String(req.params.artifactId);
    const artifact = outputs
      .flatMap((output: any) => (Array.isArray(output?.artifacts) ? output.artifacts : []))
      .find((a: any) => a?.id === wanted || a?.skill_id === skillId);
    if (!artifact) return res.status(404).json({ error: "Artifact not found" });
    if (!artifact.recipe) {
      return res.status(409).json({ error: artifact.note || "This workbook could not be built" });
    }

    const { renderXlsx } = await import("../harness/artifacts/xlsx.js");
    const buffer = await renderXlsx(artifact.recipe as WorkbookRecipe);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Length", String(buffer.length));
    const filename = String(artifact.recipe.filename || "workbook.xlsx").replace(/[^\w.\- ]+/g, "_");
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(filename)}"`);
    res.send(buffer);
  } catch (e: any) {
    log.error("[artifact]", e.message);
    res.status(503).json({ error: `Workbook generation failed: ${e.message}` });
  }
});

// Live SSE stream of the analysis trace (reasoning thoughts, tool calls,
// decisions) for a single run. Also replays events already buffered.
app.get("/analysis/:id/stream", requireAuth, async (req, res) => {
  const runId = String(req.params.id);
  const data = await getRunRow((req as AuthedRequest).user.id, runId);
  if (!data) return res.status(404).json({ error: "Analysis not found" });

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  const send = (data: unknown) => res.write(`data: ${JSON.stringify(data)}\n\n`);
  const heartbeat = setInterval(() => res.write(": ping\n\n"), 15000);

  // Replay the persisted trace first: a subscriber that connects late (or after
  // a restart that emptied the in-memory hub) still sees the reasoning so far.
  let lastSeq = 0;
  for (const event of (data.trace || []) as { seq?: number }[]) {
    send({ type: "trace", event });
    if (typeof event.seq === "number" && event.seq > lastSeq) lastSeq = event.seq;
  }

  // Then live events, skipping anything already replayed from the DB.
  const unsubscribe = traceHub.subscribe(runId, (event) => {
    if (typeof event.seq === "number" && event.seq <= lastSeq) return;
    send({ type: "trace", event });
  });
  send({ type: "ready", runId });

  req.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
    res.end();
  });
});

// ---- reference data ----
app.get("/sources", (_req, res) => {
  res.json(getSources());
});

// Curated catalog size per provider — the Settings "Models" column.
// ponytail: curated models.yaml counts only; live-discovered models from a
// provider's /v1/models aren't counted. Merge /models per keyed provider if
// the column ever needs to track discovery.
app.get("/models/catalog", (_req, res) => {
  const counts: Record<string, number> = {};
  for (const m of getModels()) {
    const p = m.id.split("/")[0];
    counts[p] = (counts[p] || 0) + 1;
  }
  res.json(counts);
});

app.get("/models", requireAuth, async (req, res) => {
  try {
    const userId = (req as AuthedRequest).user.id;
    const { llmKeys } = await fetchUserKeys(userId);
    const models = await getAvailableModelsForUser(llmKeys);
    res.json(models);
  } catch (e: any) {
    // Fallback to static list on error
    res.json(getModelIds());
  }
});

// The quota-aware default model for a user with no explicit pick.
app.get("/models/default", requireAuth, async (req, res) => {
  try {
    const userId = (req as AuthedRequest).user.id;
    const { llmKeys } = await fetchUserKeys(userId);
    res.json({ model_id: keyPool.getDefaultModel(llmKeys) });
  } catch (e: any) {
    res.status(503).json({ error: e.message });
  }
});

app.post("/models/validate", requireAuth, async (req, res) => {
  try {
    const userId = (req as AuthedRequest).user.id;
    const modelId = String(req.body?.model_id || "");
    if (!modelId) {
      return res.status(400).json({ valid: false, error: "model_id is required" });
    }

    const provider = modelId.split("/")[0];
    const { llmKeys } = await fetchUserKeys(userId);

    // Resolve the key (user key, else server pool) — rejects when no key exists.
    const { apiKey } = keyPool.pickKey(modelId, llmKeys);

    // Try a minimal model call to validate the key + model access.
    const { buildModel } = await import("../harness/model.js");
    const model = buildModel(modelId, llmKeys as any, apiKey);
    await model.invoke("Hi", { signal: AbortSignal.timeout(15_000) });

    res.json({ valid: true });
  } catch (e: any) {
    // One classifier for every provider (see modelcheck.ts): maps the real
    // failure — bad key, exhausted Gemini free quota (400 RESOURCE_EXHAUSTED,
    // not 429!), rate limit, unknown model, outage — to a message and a
    // machine-readable reason the UI can act on.
    const failure = classifyModelError(e);
    res.json({ valid: false, error: failure.message, reason: failure.reason, retryable: failure.retryable, needs_key: failure.needsKey });
  }
});

app.get("/stocks/search", (req, res) => {
  const q = String(req.query.query || "");
  const source = String(req.query.source || "");
  res.json(searchStocks(q, source || undefined));
});

// Intraday chart closes for a sparkline — /market/chart/^NSEI?range=1d&interval=5m.
// Yahoo interval rules bind interval to range, so both come from the caller.
// Open on purpose: public market data, like /stocks/search. Index symbols
// (^NSEI, ^NDX) pass through raw — no exchange-suffix mapping.
const sparkCache = new Map<string, { at: number; closes: number[]; prevClose: number | null }>();
const SPARK_TTL_MS = 60_000;

app.get("/market/chart/:symbol", async (req, res) => {
  const symbol = String(req.params.symbol || "").trim();
  const range = String(req.query.range || "1d");
  const interval = String(req.query.interval || "5m");
  const source = String(req.query.source || "") || undefined;
  // Stock symbols map by exchange (NSE → .NS); index symbols pass through.
  const yahoo = toYahooSymbol(symbol, source);
  const key = `${yahoo}:${range}:${interval}`;
  const hit = sparkCache.get(key);
  if (hit && Date.now() - hit.at < SPARK_TTL_MS) {
    res.json({ symbol, closes: hit.closes, previous_close: hit.prevClose });
    return;
  }
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahoo)}?range=${encodeURIComponent(range)}&interval=${encodeURIComponent(interval)}&includePrePost=false`;
    const out = await fetch(url, {
      signal: AbortSignal.timeout(15_000),
      headers: { "user-agent": "Mozilla/5.0 (compatible; RelativityPortfolio/1.0)" },
    });
    if (!out.ok) {
      res.set("Cache-Control", "no-store");
      res.status(502).json({ error: `yahoo status ${out.status}` });
      return;
    }
    const json: any = await out.json();
    const result = json?.chart?.result?.[0];
    const ts: number[] | undefined = result?.timestamp;
    const closes: (number | null)[] | undefined = result?.indicators?.quote?.[0]?.close;
    if (!ts?.length || !closes?.length) {
      res.set("Cache-Control", "no-store");
      res.status(502).json({ error: "no data" });
      return;
    }
    const clean = ts.map((_, i) => closes[i]).filter((c): c is number => c != null);
    if (clean.length < 2) {
      res.set("Cache-Control", "no-store");
      res.status(502).json({ error: "not enough points" });
      return;
    }
    sparkCache.set(key, { at: Date.now(), closes: clean, prevClose: Number(result.meta?.previousClose ?? result.meta?.chartPreviousClose) || null });
    res.set("Cache-Control", "no-store");
    res.json({ symbol: result.meta?.symbol ?? symbol, closes: clean, previous_close: Number(result.meta?.previousClose ?? result.meta?.chartPreviousClose) || null });
  } catch (e: any) {
    res.status(502).json({ error: String(e?.message || e) });
  }
});

// Stock page overview — one round trip: Yahoo quote (yfinance's source) +
// cached chart history. Open like /stocks/search above: public market data.
app.get("/stocks/:symbol/overview", async (req, res) => {
  try {
    const symbol = String(req.params.symbol || "").trim();
    const source = String(req.query.source || "") || undefined;
    const period = String(req.query.period || "1y");
    const yahoo = toYahooSymbol(symbol, source);
    const [q, h] = await Promise.all([yf.quote(yahoo), getPriceHistory(symbol, period, source)]);
    res.json({
      symbol: q.symbol,
      name: q.longName || q.shortName || "",
      price: q.regularMarketPrice ?? null,
      change: q.regularMarketChange ?? null,
      change_pct: q.regularMarketChangePercent ?? null,
      currency: q.currency ?? "",
      market_cap: q.marketCap ?? null,
      pe: q.trailingPE ?? null,
      prev_close: q.regularMarketPreviousClose ?? null,
      volume: q.regularMarketVolume ?? null,
      fifty_two_week_high: q.fiftyTwoWeekHigh ?? null,
      fifty_two_week_low: q.fiftyTwoWeekLow ?? null,
      exchange: q.fullExchangeName ?? "",
      ltp_time: q.regularMarketTime ?? null,
      period,
      candles: h ? h.candles.map((c) => ({ date: c.date, close: c.close })) : [],
      fetched_at: new Date().toISOString(),
    });
  } catch (e: any) {
    res.status(502).json({ error: String(e?.message || e) });
  }
});

// Company logo for a ticker: resolve symbol → domain (search API), then
// redirect to the CDN. No logo bytes are stored here. Open on purpose — an
// <img> tag carries no Authorization header, like /stocks/search above.
// The redirect target is always under the fixed CDN host, so the symbol
// can never aim it anywhere else.
app.get("/logo/:symbol", async (req, res) => {
  try {
    const url = await tickerLogoUrl(String(req.params.symbol || ""));
    res.setHeader("Cache-Control", url ? "public, max-age=86400" : "public, max-age=600");
    if (!url) return res.status(404).end();
    res.redirect(url);
  } catch {
    res.status(404).end();
  }
});

app.get("/metrics", (req, res) => {
  const source = String(req.query.source || "");
  res.json(getMetricsCatalog(source || undefined));
});

// ── metric fields (drives the agent criteria builder) ──────────────────
// Static catalog only — the live sampling path went away with the REST
// client. Merged so fields the snapshot never exposed still appear.
function loadMetricFields(): MetricDef[] {
  return mergeCatalogFields(getFlatCatalog());
}

app.get("/metrics/fields", requireAuth, (_req, res) => {
  res.json({ fields: loadMetricFields() });
});

// ── builder agent routes ──────────────────────────────────────────────

// Read-only catalog of the tools a run's skills can call, with their
// descriptions — powers the console Tools reference and the skill editor's
// data-source picker. Static; no auth-sensitive data.
app.get("/tool-catalog", (_req, res) => {
  res.json(getToolCatalog());
});

// The system-prompt list (agent.yaml prompts.* — every named prompt, live without restart).
app.get("/harness/system-prompts", requireAuth, async (_req, res) => {
  try {
    res.json(
      loadSystemPrompts().map((t) => ({ id: t.id, name: t.name, description: t.description, default: !!t.default })),
    );
  } catch (e: any) {
    res.status(503).json({ error: e.message });
  }
});

app.get("/harness/runs/:id", requireAuth, async (req, res) => {
  try {
    const data = await getRunRow((req as AuthedRequest).user.id, String(req.params.id));
    if (!data) return res.status(404).json({ error: "Run not found" });
    res.json({ ...data, report_document: data.report });
  } catch (e: any) {
    res.status(503).json({ error: e.message });
  }
});

app.get("/builder/presets", (_req, res) => {
  res.json(listPresets());
});

app.get("/builder/preset/:key", (req, res) => {
  const preset = getPreset(req.params.key);
  if (!preset) return res.status(404).json({ error: "Preset not found" });
  res.json(preset);
});

app.post("/builder/draft", requireAuth, async (req, res) => {
  let requestedModel = "";
  try {
    const userId = (req as AuthedRequest).user.id;
    const { llmKeys } = await fetchUserKeys(userId);

    const body = req.body || {};
    requestedModel = body.model_id || keyPool.getDefaultModel(llmKeys);

    const builderReq: BuilderRequest = {
      session_id: body.session_id ? String(body.session_id) : undefined,
      user_id: userId,
      model_id: requestedModel,
      llm_keys: llmKeys as LlmKeys,
      messages: Array.isArray(body.messages) ? body.messages : [],
      agent_draft: body.agent_draft || {},
      metrics: Array.isArray(body.metrics) ? body.metrics : [],
      document_texts: Array.isArray(body.document_texts) ? body.document_texts : [],
      user_response: body.user_response || undefined,
    };

    // Stream the turn's trace events (thinking, tool calls) to the same SSE hub
    // the analysis pipeline uses, so the builder UI shows live agent activity.
    const builderSessionKey = builderReq.session_id ? `builder:${builderReq.session_id}` : undefined;
    if (builderSessionKey) traceHub.reset(builderSessionKey);
    const response = await processBuilderTurn(builderReq, {
      onTrace: (ev) => {
        if (!builderSessionKey) return;
        const base = { seq: nextSeq(), ts: Date.now(), key: "builder" } as const;
        const emit = (event: TraceRowEvent) => traceHub.publish(builderSessionKey, event);
        switch (ev.type) {
          case "thought":
            emit({ ...base, type: "thought", text: ev.text });
            break;
          case "tool_call":
            emit({ ...base, type: "tool_call", tool: ev.tool, args: ev.args });
            break;
          case "tool_result":
            emit({ ...base, type: "tool_result", tool: ev.tool, status: ev.status === "ok" ? "OK" : "ERR", result: ev.result, duration_ms: ev.durationMs });
            break;
        }
      },
    });
    if (builderSessionKey) {
      traceHub.publish(builderSessionKey, {
        seq: nextSeq(), ts: Date.now(), type: "log", key: "builder", text: "turn complete",
      });
    }
    res.json(response);
  } catch (e: any) {
    console.error("[builder/draft] FAILED:", e?.name, e?.message);
    if (e?.cause) console.error("[builder/draft] cause:", e.cause?.message || e.cause);
    if (e?.stack) console.error("[builder/draft] stack:", e.stack);
    const detail = e?.message || "Builder draft failed";
    res.status(502).json({ error: `Model "${requestedModel}": ${detail}` });
  }
});

// Live SSE stream of the builder agent's trace events (thinking, tool calls)
// for one conversational session. Replays events already buffered.
app.get("/builder/:sessionId/stream", requireAuth, async (req, res) => {
  const sessionId = String(req.params.sessionId);
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  const key = `builder:${sessionId}`;
  const send = (data: unknown) => res.write(`data: ${JSON.stringify(data)}\n\n`);
  const heartbeat = setInterval(() => res.write(": ping\n\n"), 15000);

  const unsubscribe = traceHub.subscribe(key, (event) => send({ type: "trace", event }));
  send({ type: "ready", sessionId });

  req.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
    res.end();
  });
});

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

app.post("/builder/upload", requireAuth, upload.array("files", 10), async (req, res) => {
  try {
    const files = req.files as Express.Multer.File[] | undefined;
    if (!files || files.length === 0) {
      return res.status(400).json({ error: "No files uploaded" });
    }
    const results = await Promise.all(
      files.map((f) => extractText(f.buffer, f.originalname, f.mimetype)),
    );
    res.json({ documents: results });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "Document extraction failed" });
  }
});

app.post("/builder/extract-signals", requireAuth, async (req, res) => {
  try {
    const userId = (req as AuthedRequest).user.id;
    const { llmKeys } = await fetchUserKeys(userId);
    const modelId = keyPool.getDefaultModel(llmKeys);

    const documents = req.body?.documents;
    if (!Array.isArray(documents) || documents.length === 0) {
      return res.status(400).json({ error: "No documents provided" });
    }

    const signals = await extractDocumentSignals(modelId, llmKeys as LlmKeys, documents);
    res.json(signals);
  } catch (e: any) {
    res.status(502).json({ error: e?.message || "Signal extraction failed" });
  }
});

// Draft qualitative parameters from an investor's persona text via their LLM key.
// Serve the built web app when present — the docker image ships UI+API as one
// process on :8501. Bare dev (vite:5173 + `npm run dev`) is unaffected: this is
// a no-op unless client/dist exists.
const clientDist = path.resolve(process.cwd(), process.env.CLIENT_DIST || "../client/dist");
if (existsSync(path.join(clientDist, "index.html"))) {
  app.use(express.static(clientDist));
  // SPA fallback: client-side routes get index.html; API paths keep their own 404s.
  app.use((req, res, next) => {
    if (req.method === "GET" && !(req as unknown as { apiPath?: boolean }).apiPath) {
      res.sendFile(path.join(clientDist, "index.html"));
    } else {
      next();
    }
  });
}

// Local-only by default: AUTH_MODE=local has no sign-in and stores API keys,
// so the app shouldn't be reachable from the LAN. Containers set
// RELATIVITY_HOST=0.0.0.0 so published ports keep working.
const host = process.env.RELATIVITY_HOST || "127.0.0.1";
const server = app.listen(config.port, host, async () => {
  log.info("[api]", `listening on ${host}:${config.port}`);
  log.info(
    "[api]",
    `config: mode=${config.authMode} db=${config.sqlitePath} yfinanceMcp=${config.mcpYfinanceUrl || "off"} rateLimit=${config.rateLimitPerMin}/min logLevel=${process.env.LOG_LEVEL || "info"}`,
  );
  // Runs execute in-process, so nothing survives a restart: anything left
  // PENDING/RUNNING from a previous process is dead. Clear it, then keep
  // sweeping hangs.
  startStaleRunSweeper();
  startAlertTicker();
});

async function shutdown() {
  try {
    server.close();
  } catch {}
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
