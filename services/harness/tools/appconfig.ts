/**
 * App-level config — the exact slice the old domain tools pulled from
 * services/api/config.ts:
 *   tavilyUrl        → search.ts (Tavily engine endpoint)
 *   pdfHostAllowlist → voyager.ts read_pdf SSRF guard
 *   voyagerUrl / voyagerApiKey / voyagerRpm → sources.ts buildRunTools
 *     (VoyagerClient construction, same envs and defaults as the API)
 * Same env sources and defaults, so behavior is byte-identical. The rest of
 * the old config object (ports, key pools, limits) belongs to the API and is
 * intentionally not duplicated here.
 */

import "dotenv/config";

/** Parse a comma-separated env value into a trimmed, non-empty array. */
export function parseCsv(value: string | undefined): string[] {
  return (value || "").split(",").map((s) => s.trim()).filter(Boolean);
}

export const config = {
  // read_pdf SSRF guard (plan 0.5/C1): allowed download hosts. Matched as a
  // suffix so subdomains work ("nseindia.com" allows "www.nseindia.com").
  pdfHostAllowlist: parseCsv(process.env.PDF_HOST_ALLOWLIST).length
    ? parseCsv(process.env.PDF_HOST_ALLOWLIST)
    : [
        "nseindia.com",
        "nsearchive.nseindia.com",
        "sec.gov",
        "www.sec.gov",
        "static.nseindia.com",
        "archives.nseindia.com",
        "cdn.nseindia.com",
        "bseindia.com",
        "bsmedia.business-standard.com",
      ],
  tavilyUrl: "https://api.tavily.com/search",
  // Voyager
  voyagerUrl: process.env.VOYAGER_URL || "https://voyager-api-0csb.onrender.com",
  voyagerAdminKey: process.env.VOYAGER_ADMIN_KEY || "",
  // data:read key for Voyager data routes (X-API-Key). The admin key above only
  // works on /admin/* and 401s every data route.
  voyagerApiKey: process.env.VOYAGER_API_KEY || "",
  voyagerRpm: Number(process.env.VOYAGER_RPM || 60),
};
