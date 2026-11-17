/**
 * App-level config — the slice the domain tools need:
 *   tavilyUrl → search.ts (Tavily engine endpoint)
 * Same env sources and defaults as the API. The rest of the config object
 * (ports, key pools, limits) belongs to the API and is intentionally not
 * duplicated here.
 */

import "dotenv/config";

/** Parse a comma-separated env value into a trimmed, non-empty array. */
export function parseCsv(value: string | undefined): string[] {
  return (value || "").split(",").map((s) => s.trim()).filter(Boolean);
}

export const config = {
  tavilyUrl: "https://api.tavily.com/search",
};
