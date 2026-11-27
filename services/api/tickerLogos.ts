// Company logos for a ticker, hotlinked by symbol from two free APIs —
// both keyed directly by the ticker, so there is no symbol→domain search,
// no rate budget and no cache to persist:
//   India (NSE symbols): https://api.dharun.dev/v1/logos/{SYMBOL}
//   US / anything else:  https://logoapi.sh/ticker/{TICKER}.svg
//
// Market routing comes from the saved NSE equity list (discovery.ts): a
// symbol listed there goes to dharun, everything else to logoapi.sh —
// which 404s honestly on tickers it doesn't have (RDGT, GRDN, YI…), so the
// UI retries once with ?alt=1 to flip the host and pick up dharun's copy.
// dharun never 404s: a miss comes back as an 18×18 square with the
// symbol's initials, so its SVG is fetched once here and that known
// placeholder is treated as a miss (no initials square in the UI or the
// PDF report).
//
// Logos are never downloaded or stored here — only a URL (or, for the PDF,
// the bytes of one image) moves around. Both APIs serve a .png variant,
// which is what the PDF path uses (PDFKit cannot embed SVG).

import { isNseSymbol } from "./discovery.js";

const IN = "https://api.dharun.dev/v1/logos";
const US = "https://logoapi.sh/ticker";

// dharun's "not found" payload: an 18×18 flat square with a <text> label —
// the symbol's initials (it used to be a fixed "NO"). No real logo carries a
// <text> node, so any of them reads as a miss.
const NOT_FOUND = /<text[\s\S]*?<\/text>/;

type Paths = { svg: string; png: string; ind: boolean };

/** `alt` flips the host: the UI retries `/logo/:sym?alt=1` when the first
 *  one 404s, so logoapi.sh's gaps (RDGT, GRDN, YI…) land on dharun. */
function resolve(symbol?: string, alt = false): Paths | null {
  // Tolerate Yahoo-style suffixes; both APIs want the bare symbol.
  const key = String(symbol || "")
    .trim()
    .toUpperCase()
    .replace(/\.(NS|BO)$/, "");
  if (!key) return null;
  const enc = encodeURIComponent(key);
  return isNseSymbol(key) !== alt
    ? { svg: `${IN}/${enc}`, png: `${IN}/${enc}.png`, ind: true }
    : { svg: `${US}/${enc}.svg`, png: `${US}/${enc}.png`, ind: false };
}

async function get(url: string): Promise<Response | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    return res.ok ? res : null;
  } catch {
    return null; // offline/timeout/404 — retried on the next lookup
  }
}

/**
 * Logo URL for a ticker, or null when the sources have none.
 *
 * US symbols are returned unverified — logoapi.sh 404s on its own and the
 * redirect passes that straight to the <img>, which falls back to its
 * letter avatar. dharun can't signal a miss, so its SVG is checked once
 * here; the response itself is browser-cached for a day by the route.
 */
export async function tickerLogoUrl(symbol?: string, alt = false): Promise<string | null> {
  const p = resolve(symbol, alt);
  if (!p) return null;
  if (!p.ind) return p.svg;
  const res = await get(p.svg);
  if (!res) return null;
  const type = String(res.headers.get("content-type") || "");
  if (!type.startsWith("image/svg")) return null;
  try {
    const body = await res.text();
    return NOT_FOUND.test(body) ? null : p.svg;
  } catch {
    return null;
  }
}

/** The logo as a data URI (the .png variant), for embedding in the PDF. */
export async function tickerLogoDataUri(symbol?: string): Promise<string | null> {
  const p = resolve(symbol);
  if (!p) return null;
  if (p.ind && !(await tickerLogoUrl(symbol))) return null; // placeholder = miss
  const res = await get(p.png);
  if (!res) return null;
  const type = String(res.headers.get("content-type") || "");
  if (!type.startsWith("image/")) return null;
  try {
    const buf = Buffer.from(await res.arrayBuffer());
    return `data:${type};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}
