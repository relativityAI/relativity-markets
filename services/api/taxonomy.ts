/**
 * Sector/industry taxonomy — groups + constituents for both markets, loaded
 * in-memory from services/taxonomy/data (same pattern as discovery.ts's CSVs).
 *
 * Group keys: "IN:SECTOR:IN01" (India, Screener codes) and
 * "US:SECTOR:technology" (US, slug of the cleaned name). Keys are opaque to
 * the client; /groups/:key decodes them.
 */
import path from "node:path";
import { config } from "./config.js";
import { parseCsv, editDistance, searchStocks } from "./discovery.js";

export type GroupLevel = "sector" | "industry_group" | "industry" | "basic_industry" | "sub_industry";

export interface GroupConstituent {
  symbol: string;
  name: string;
  source: "NSE" | "SEC";
}

export interface GroupDef {
  key: string;
  market: "NSE" | "SEC";
  level: GroupLevel;
  code: string;
  name: string;
  /** Breadcrumb display names, sector first. */
  path: string[];
  count: number;
  constituents: GroupConstituent[];
}

export interface EntityHit {
  type: "stock" | "group";
  /** Stocks */
  symbol?: string;
  /** Groups */
  key?: string;
  name: string;
  source: "NSE" | "SEC";
  /** Groups only */
  level?: GroupLevel;
  sub?: string;
  count?: number;
  /** Stocks: exchange label for the search row (NASDAQ/NYSE/NSE…). */
  exchange?: string;
}

interface Row {
  [k: string]: string;
}

const INDIA_LEVELS: { level: GroupLevel; code: string; name: string }[] = [
  { level: "sector", code: "sector_code", name: "sector" },
  { level: "industry_group", code: "industry_group_code", name: "industry_group" },
  { level: "industry", code: "industry_code", name: "industry" },
  { level: "basic_industry", code: "basic_industry_code", name: "basic_industry" },
];

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const groups = new Map<string, GroupDef>();
let loaded = false;

function addGroup(g: GroupDef): void {
  const existing = groups.get(g.key);
  if (existing) return;
  groups.set(g.key, g);
}

function load(): void {
  if (loaded) return;
  loaded = true;

  // India: one constituents row per stock, already carrying all four levels.
  const india = parseCsv(path.join(config.taxonomyDir, "screener_constituents.csv")).rows;
  const byKey = new Map<string, GroupDef>();
  for (const r of india) {
    const symbol = r.symbol || "";
    if (!symbol) continue;
    const name = r.company || symbol;
    for (const { level, code, name: nameCol } of INDIA_LEVELS) {
      const c = r[code];
      if (!c) continue;
      const key = `IN:${level.toUpperCase()}:${c}`;
      let g = byKey.get(key);
      if (!g) {
        g = {
          key, market: "NSE", level, code: c, name: r[nameCol] || c,
          path: INDIA_LEVELS.slice(0, INDIA_LEVELS.findIndex((l) => l.level === level) + 1)
            .map((l) => r[l.name]).filter(Boolean),
          count: 0, constituents: [],
        };
        byKey.set(key, g);
      }
      // Each stock sits on exactly one path, so the dedupe never double-adds.
      if (g.constituents.every((x) => x.symbol !== symbol)) {
        g.constituents.push({ symbol, name, source: "NSE" });
        g.count = g.constituents.length;
      }
    }
  }
  for (const g of byKey.values()) addGroup(g);

  // US: cleaned tree — three levels, slug keys.
  const us = parseCsv(path.join(config.taxonomyDir, "us_groups.csv")).rows;
  const usLevels: { level: GroupLevel; col: string }[] = [
    { level: "sector", col: "sector" },
    { level: "industry_group", col: "industry_group" },
    { level: "sub_industry", col: "sub_industry" },
  ];
  for (const r of us) {
    const symbol = (r.symbol || "").toUpperCase();
    if (!symbol) continue;
    const name = r.name || symbol;
    const path: string[] = [];
    for (const { level, col } of usLevels) {
      const c = r[col] || "";
      if (!c) continue;
      path.push(c);
      const key = `US:${level.toUpperCase()}:${slug(c)}`;
      let g = groups.get(key);
      if (!g) {
        g = {
          key, market: "SEC", level, code: slug(c), name: c, path: [...path], count: 0, constituents: [],
        };
        groups.set(key, g);
      }
      if (g.constituents.every((x) => x.symbol !== symbol)) {
        g.constituents.push({ symbol, name, source: "SEC" });
        g.count = g.constituents.length;
      }
    }
  }
}

/** All top-level sectors (optionally one market), most constituents first. */
export function listSectors(market?: string): (GroupDef & { children: number })[] {
  return listLevel(market, "sector");
}

const LEVEL_ORDER: GroupLevel[] = ["sector", "industry_group", "industry", "basic_industry", "sub_industry"];

export function listLevel(market: string | undefined, level: GroupLevel): (GroupDef & { children: number })[] {
  load();
  const want = (market || "").toUpperCase();
  const idx = LEVEL_ORDER.indexOf(level);
  const next = idx >= 0 && idx < LEVEL_ORDER.length - 1 ? LEVEL_ORDER[idx + 1] : null;
  const byKey = [...groups.values()];
  return byKey
    .filter((g) => g.level === level && (!want || g.market === want))
    .filter((g) => g.name !== "Other" && g.name !== "Unclassified") // leftover buckets, not browsable
    .map((g) => ({
      ...g,
      children: next
        ? byKey.filter((c) => c.market === g.market && c.level === next && c.path.slice(0, idx + 1).join("\u0000") === g.path.join("\u0000")).length
        : 0,
    }))
    .sort((a, b) => b.count - a.count);
}

export function getGroup(key: string): GroupDef | null {
  load();
  return groups.get(key) || null;
}

export function allGroups(): GroupDef[] {
  load();
  return [...groups.values()];
}

/** Shorthand people type that should hit group names: "it" -> Information Technology. */
const ALIASES: Record<string, string[]> = {
  it: ["information technology", "technology"],
  fmcg: ["fast moving consumer goods", "consumer staples"],
  psu: ["public sector"],
  bank: ["banks"],
  pharma: ["pharmaceuticals", "drugs"],
  auto: ["automobile", "auto components"],
  metal: ["metals", "basic materials"],
  oil: ["energy", "oil"],
};

/** Crude plural stem — "retailers" matches "retail", "stores" matches "store". */
const stem = (w: string) => (w.length > 4 && w.endsWith("s") ? w.slice(0, -1) : w);

/** One variant-list per query word: the word, its stem, and its alias
 *  expansions — so "pharma retailers" can hit "Retail-Drug Stores…"
 *  (retail from retailers, drug from the pharma alias). */
function wordGroups(q: string): string[][] {
  return q
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((w) => {
      const vs = new Set<string>([w, stem(w)]);
      for (const a of ALIASES[w] || []) {
        for (const aw of a.split(/[^a-z0-9]+/).filter(Boolean)) {
          vs.add(aw);
          vs.add(stem(aw));
        }
      }
      return [...vs];
    });
}

/** Does any variant of one query word appear as a word in the name? */
function nameWordHits(nameWords: string[], variants: string[]): boolean {
  return nameWords.some((nw) =>
    variants.some((v) => nw === v || nw.startsWith(v) || (v.length >= 4 && nw.length >= 4 && v.startsWith(nw))),
  );
}

const LEVEL_LABEL: Record<GroupLevel, string> = {
  sector: "SECTOR",
  industry_group: "INDUSTRY GROUP",
  industry: "INDUSTRY",
  basic_industry: "BASIC INDUSTRY",
  sub_industry: "SUB-INDUSTRY",
};export function levelLabel(level: GroupLevel): string {
  return LEVEL_LABEL[level];
}

/**
 * Score a group name against one query variant — higher is better. Coverage
 * based: every query word landing beats half of them beats one.
 */
function groupScore(name: string, q: string, groups: string[][]): number {
  const n = name.toLowerCase();
  if (n === q) return 100;
  if (n.startsWith(q)) return 85;
  const nameWords = n.split(/[^a-z0-9]+/).filter(Boolean);
  const hits = groups.filter((g) => nameWordHits(nameWords, g)).length;
  let score = 0;
  if (groups.length > 0 && hits === groups.length) score = 75; // every query word lands (or the one word)
  else if (hits > 0) score = hits >= groups.length / 2 ? 60 : 45;
  if (score > 0) {
    // More distinct variant words landing = closer the intent: "fmcg" must
    // beat a sector that merely contains "consumer".
    const distinct = [...new Set(groups.flat())];
    const variantHits = distinct.filter((v) => nameWordHits(nameWords, [v])).length;
    score += Math.min(Math.max(variantHits - 1, 0), 6) * 2;
    return score;
  }
  if (n.includes(q)) return 50;
  const maxDist = q.length >= 7 ? 2 : q.length >= 5 ? 1 : 0;
  if (maxDist) {
    for (const w of nameWords) {
      if (w.length >= 4 && editDistance(w, q, maxDist) <= maxDist) return 30;
    }
  }
  return 0;
}

/**
 * One smart ranked list of stocks AND groups. Intent signals:
 *  - exact ticker match → stock leads (score 100);
 *  - single-word general terms that prefix a group name get a small group
 *    bonus ("auto" → Automobiles group before AutoZone);
 *  - multi-word queries favor company names (no group bonus).
 */
export function searchEntities(query: string, market?: string): EntityHit[] {
  load();
  const q = (query || "").trim().toLowerCase();
  if (!q) return [];
  const want = (market || "").toUpperCase();
  const wgs = wordGroups(q); // per-word variants: stems + aliases
  const singleWord = wgs.length === 1;
  const hits: (EntityHit & { score: number })[] = [];

  // Stocks: searchStocks owns exact/fuzzy order; score = tier from its order.
  const stocks = searchStocks(query, want === "NSE" ? "NSE" : want === "SEC" ? "SEC" : undefined);
  stocks.forEach((s, i) => {
    const sym = (s.ticker || s.SYMBOL || "").toLowerCase();
    const nm = (s.name || s.NAME || "").toLowerCase();
    const src = (String(s.source || "").toLowerCase() === "nse" ? "NSE" : "SEC") as "NSE" | "SEC";
    if (want && src !== want) return;
    const nameWords = nm.split(/[^a-z0-9]+/).filter(Boolean);
    const wordHits = wgs.filter((g) => nameWordHits(nameWords, g)).length;
    let score = 0;
    if (sym === q) score = 100;
    else if (sym.startsWith(q)) score = 85;
    else if (nm.startsWith(q)) score = 80;
    else if (wordHits === wgs.length) score = wgs.length > 1 ? 76 : 70;
    else if (wordHits > 0 && wordHits >= wgs.length / 2) score = 60;
    else if (wordHits > 0) score = 45;
    else if (nm.includes(q)) score = 50;
    else score = 30 - Math.min(i, 30) * 0.1; // fuzzy tail from searchStocks
    hits.push({
      type: "stock", symbol: s.ticker || s.SYMBOL, name: s.name || s.NAME || s.ticker || s.SYMBOL,
      source: src, sub: `${src}:${s.ticker || s.SYMBOL}`,
      exchange: s.exchange || src, score,
    });
  });

  // Groups — each variant scored against the group's own name.
  for (const g of groups.values()) {
    if (want && g.market !== want) continue;
    let score = groupScore(g.name, q, wgs);
    if (score === 0) continue;
    if (singleWord && score >= 70) score += 5; // general term -> group intent
    hits.push({
      type: "group", key: g.key, name: g.name, source: g.market, level: g.level,
      sub: `${LEVEL_LABEL[g.level]} · ${g.count} stocks`, count: g.count, score,
    });
  }

  // Groups tie-break above stocks at equal score (the "understands me" nudge),
  // then by constituent count.
  hits.sort((a, b) => b.score - a.score || (b.type === "group" ? 1 : 0) - (a.type === "group" ? 1 : 0));
  return hits.slice(0, 25).map(({ score: _score, ...hit }) => hit);
}
