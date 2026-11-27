import { readFileSync } from "node:fs";
import path from "node:path";
import { config } from "./config.js";

export interface StockRow {
  SYMBOL: string;
  NAME: string;
  ticker: string;
  name: string;
  exchange: string;
  source: string;
  country: string;
}

interface CsvData {
  headers: string[];
  rows: Record<string, string>[];
}

export function parseCsv(filePath: string): CsvData {
  const text = readFileSync(filePath, "utf8").replace(/\r/g, "");
  const lines = text.split("\n").filter((l) => l.trim().length > 0);
  const headers = lines[0].split(",").map((h) => h.trim());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i]);
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = (values[idx] ?? "").trim();
    });
    if (row[headers[0]]) rows.push(row);
  }
  return { headers, rows };
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

let nseRows: Record<string, string>[] | null = null;
let secRows: Record<string, string>[] | null = null;
let sourceRows: Record<string, string>[] | null = null;

function nse(): Record<string, string>[] {
  if (!nseRows) {
    nseRows = parseCsv(path.join(config.assetsDir, "nse-equities.csv")).rows;
  }
  return nseRows;
}

function sec(): Record<string, string>[] {
  if (!secRows) {
    secRows = parseCsv(path.join(config.assetsDir, "sec-equities.csv")).rows;
  }
  return secRows;
}

function sources(): Record<string, string>[] {
  if (!sourceRows) {
    sourceRows = parseCsv(path.join(config.assetsDir, "sources.csv")).rows;
  }
  return sourceRows;
}

let nseSymbols: Set<string> | null = null;

/** True when the bare symbol is listed on the NSE (India) equity list. */
export function isNseSymbol(symbol: string): boolean {
  if (!nseSymbols) nseSymbols = new Set(nse().map((r) => (r.SYMBOL || r.ticker || "").toUpperCase()));
  return nseSymbols.has(String(symbol || "").trim().toUpperCase());
}

export function getSources(): { SYMBOL: string; NAME: string }[] {
  return sources().map((r) => ({
    SYMBOL: r.SYMBOL || r.ticker || "",
    NAME: r.NAME || r.name || "",
  }));
}

/** Levenshtein capped at `max` — returns the distance, or max+1 when it exceeds. */
export function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const m = a.length;
  const n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n] <= max ? prev[n] : max + 1;
}

export function searchStocks(query: string, source?: string): StockRow[] {
  const q = (query || "").trim().toLowerCase();
  const matches: StockRow[] = [];
  const seen = new Set<string>();
  const wantNse = source === "NSE";
  const wantSec = source === "SEC";
  const both = !source;
  // Typo tolerance: "aaple" finds AAPL, "microsft" finds MSFT. Off for short
  // queries — one edit on four letters matches half the board.
  const maxDist = q.length >= 7 ? 2 : q.length >= 5 ? 1 : 0;

  const push = (r: Record<string, string>, src: string): void => {
    const sym = (r.SYMBOL || r.ticker || "").toLowerCase();
    const key = `${src}:${sym}`;
    if (seen.has(key)) return;
    seen.add(key);
    matches.push({
      SYMBOL: r.SYMBOL || r.ticker || "",
      NAME: r.NAME || r.name || "",
      ticker: r.ticker || r.SYMBOL || "",
      name: r.name || r.NAME || "",
      exchange: r.exchange || (src === "nse" ? "NSE" : ""),
      source: src,
      country: src === "nse" ? "in" : "us",
    });
  };

  const checkExact = (rows: Record<string, string>[], src: string) => {
    for (const r of rows) {
      const symbol = (r.SYMBOL || r.ticker || "").toLowerCase();
      const name = (r.NAME || r.name || "").toLowerCase();
      if (q && !symbol.includes(q) && !name.includes(q)) continue;
      push(r, src);
      if (matches.length >= 25) return;
    }
  };

  if (wantNse || both) {
    checkExact(nse(), "nse");
  }
  if (wantSec || both) {
    checkExact(sec(), "sec");
  }
  if (!maxDist || matches.length >= 25) return matches.slice(0, 25);

  // Pass 2: near-miss matches, best edit-distance first — runs only AFTER
  // both exact passes so a typo never outranks a real substring hit.
  const fuzzy: { r: Record<string, string>; src: string; dist: number }[] = [];
  const collect = (rows: Record<string, string>[], src: string) => {
    for (const r of rows) {
      const symbol = (r.SYMBOL || r.ticker || "").toLowerCase();
      const name = (r.NAME || r.name || "").toLowerCase();
      if (symbol.includes(q) || name.includes(q)) continue; // already exact
      let best = editDistance(symbol, q, maxDist);
      if (best > maxDist) {
        for (const w of name.split(/[^a-z0-9]+/)) {
          if (w.length < 3) continue;
          best = Math.min(best, editDistance(w, q, maxDist));
          if (best === 0) break;
        }
      }
      if (best <= maxDist) fuzzy.push({ r, src, dist: best });
    }
  };
  if (wantNse || both) collect(nse(), "nse");
  if (wantSec || both) collect(sec(), "sec");
  fuzzy.sort((a, b) => a.dist - b.dist); // stable — list order within a tier
  for (const f of fuzzy) {
    push(f.r, f.src);
    if (matches.length >= 25) break;
  }
  return matches.slice(0, 25);
}
