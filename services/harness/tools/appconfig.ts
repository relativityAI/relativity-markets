/**
 * App-level config — the slice the domain tools need.
 * Same env sources and defaults as the API. The rest of the config object
 * (ports, key pools, limits) belongs to the API and is intentionally not
 * duplicated here.
 */

import "dotenv/config";

/** Parse a comma-separated env value into a trimmed, non-empty array. */
export function parseCsv(value: string | undefined): string[] {
  return (value || "").split(",").map((s) => s.trim()).filter(Boolean);
}
