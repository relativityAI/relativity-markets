/**
 * The source ledger — verified citations for the report.
 *
 * Every URL the agent actually touched lives in the run's trace: search
 * results, web_url_read calls, news payloads. extractSources() mines that
 * into a stable, deduped ledger (s1…sN) which the canvas publishes as
 * doc.sources. report_write validates every citation against it — a link
 * that never appeared in the trace never reaches the report.
 */
import type { TraceEvent } from "../types.js";
import type { Source } from "./document.js";

/** Tools whose payloads carry citable web URLs. */
const WEB_TOOL = /search|url_read|news|reddit|youtube|web/i;

const URL_RE = /https?:\/\/[^\s<>"'`\\]+/g;

/** Cheap junk filters — assets, local hosts, the favicon proxy itself. */
function isCitable(url: string): boolean {
  if (/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])/i.test(url)) return false;
  if (/google\.com\/s2\/favicons/i.test(url)) return false;
  if (/\.(png|jpe?g|gif|svg|webp|ico|css|js|mjs|woff2?)(\?|$)/i.test(url)) return false;
  return true;
}

/** Trim sentence punctuation the URL regex can over-capture. */
function cleanUrl(raw: string): string {
  return raw.replace(/[.,;:!?)\]}"']+$/, "");
}

/** Match key: scheme+host+path, query ignored (utm noise dedupes). */
function urlKey(url: string): string {
  return url.split(/[?#]/)[0].replace(/\/+$/, "").toLowerCase();
}

/** Hostname + last path slug — the honest label when no title is near. */
function labelFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    const slug = u.pathname.split("/").filter(Boolean).pop() ?? "";
    const pretty = decodeURIComponent(slug)
      .replace(/\.(html?|php)$/i, "")
      .replace(/[-_]+/g, " ")
      .trim();
    return pretty && pretty !== host ? `${host} — ${pretty.slice(0, 80)}` : host;
  } catch {
    return url;
  }
}

/** Nearest title-like string written just before `idx` (searxng `Title:`,
 *  JSON `"title"`, or an HTML `<title>`). */
function titleAt(body: string, idx: number): string {
  const window = body.slice(Math.max(0, idx - 400), idx);
  let best = "";
  const re = /(?:^|\n)\s*Title:\s*([^\n]+)|"title"\s*:\s*"([^"\\]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(window))) best = (m[1] || m[2] || "").trim();
  return best ? best.slice(0, 160) : "";
}

/** Every citable URL in one tool result, with the best title each has. */
function urlsIn(body: string): { url: string; title: string }[] {
  const out: { url: string; title: string }[] = [];
  URL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = URL_RE.exec(body))) {
    const url = cleanUrl(m[0]);
    if (!isCitable(url)) continue;
    out.push({ url, title: titleAt(body, m.index) });
  }
  return out;
}

const text = (v: unknown): string => (typeof v === "string" ? v : "");

/**
 * Mine the run's trace into the citation ledger — first-seen order, capped.
 * ponytail: 30 entries covers a run's citations; raise if reports cite more.
 */
export function extractSources(trace: TraceEvent[], limit = 30): Source[] {
  const seen = new Map<string, Source>();
  let n = 0;
  const add = (url: string, title: string, tool: string): void => {
    const key = urlKey(url);
    if (!key || seen.has(key) || seen.size >= limit) return;
    const label = title || labelFromUrl(url);
    seen.set(key, { id: `s${++n}`, label, tool, url, value: "" });
  };
  for (const ev of trace) {
    if (ev.type === "tool_call") {
      const args = (ev.args ?? {}) as Record<string, unknown>;
      const url = cleanUrl(text(args.url));
      if (url && isCitable(url)) add(url, text(args.title), ev.tool);
    } else if (ev.type === "tool_result" && ev.status === "ok" && WEB_TOOL.test(ev.tool)) {
      const body = typeof ev.result === "string" ? ev.result : JSON.stringify(ev.result);
      for (const u of urlsIn(body)) add(u.url, u.title, ev.tool);
    }
  }
  return [...seen.values()];
}

function normLabel(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Validate a section's citation refs against the ledger.
 * - string refs resolve when they are a ledger id, url or label
 * - object refs keep the agent's label but only a VERIFIED url survives —
 *   links the run never retrieved are dropped (never print hallucinations)
 * - label-only refs pass through (honest "no link" citations)
 * Empty ledger = nothing to validate against: pass everything through.
 */
export function resolveRefs(
  refs: (string | { source: string; url?: string })[],
  ledger: Source[],
): (string | { source: string; url?: string })[] {
  if (!ledger.length) return refs;
  const byUrl = new Map<string, Source>();
  const byLabel = new Map<string, Source>();
  for (const s of ledger) {
    if (s.url) byUrl.set(urlKey(s.url), s);
    byLabel.set(normLabel(s.label), s);
  }
  const out: (string | { source: string; url?: string })[] = [];
  const push = (r: string | { source: string; url?: string }): void => {
    const k = JSON.stringify(r);
    if (!out.some((x) => JSON.stringify(x) === k)) out.push(r);
  };
  for (const r of refs) {
    if (typeof r === "string") {
      if (ledger.some((s) => s.id === r)) push(r);
      else {
        const hit = byUrl.get(urlKey(r)) ?? byLabel.get(normLabel(r));
        if (hit) push({ source: hit.label, url: hit.url });
      }
      continue;
    }
    if (!r.url) {
      push(r);
      continue;
    }
    const hit = byUrl.get(urlKey(r.url));
    if (hit) push({ source: r.source, url: hit.url });
  }
  return out;
}
