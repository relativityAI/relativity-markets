// Refreshes services/assets/*.csv from the official exchange sources:
//   sec-equities.csv  ← https://www.sec.gov/files/company_tickers.json
//   nse-equities.csv  ← https://archives.nseindia.com/content/equities/EQUITY_L.csv
// SEC fair-access wants a descriptive User-Agent with a contact address
// (bare URLs and noreply addresses get 403'd); the NSE archive wants a
// browser-ish one. Both files keep the exact headers
// api/discovery.ts already parses (the NSE file's "NAME OF COMPANY" column
// is renamed to "NAME" to match). The SEC JSON carries no exchange field, so
// that column stays present but empty — the only consumer (Analysis.tsx)
// already treats an empty exchange as SEC/US.
//
// Run: npm run refresh:tickers   (from services/)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ASSETS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "assets");
const SEC_URL = "https://www.sec.gov/files/company_tickers.json";
const NSE_URL = "https://archives.nseindia.com/content/equities/EQUITY_L.csv";
const SEC_UA = `relativity-markets/0.15 (contact@example.com)`;
const NSE_UA = "Mozilla/5.0";

async function fetchText(url: string, ua: string): Promise<string> {
  const res = await fetch(url, { headers: { "User-Agent": ua }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res.text();
}

// Quote only fields that need it (SEC company titles can contain commas).
const csv = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

async function secEquities(): Promise<string> {
  const data = JSON.parse(await fetchText(SEC_URL, SEC_UA));
  const rows = Object.values(data) as { cik_str: number; ticker: string; title: string }[];
  const out = ["cik,name,ticker,exchange"];
  for (const r of rows) out.push([String(r.cik_str), r.title || "", r.ticker || "", ""].map(csv).join(","));
  return `${out.join("\n")}\n`;
}

async function nseEquities(): Promise<string> {
  const text = (await fetchText(NSE_URL, NSE_UA)).replace(/\r/g, "");
  return text.replace("NAME OF COMPANY", "NAME");
}

async function main() {
  const [sec, nse] = await Promise.all([secEquities(), nseEquities()]);
  fs.writeFileSync(path.join(ASSETS, "sec-equities.csv"), sec);
  fs.writeFileSync(path.join(ASSETS, "nse-equities.csv"), nse);
  console.log(`sec-equities.csv: ${sec.trimEnd().split("\n").length - 1} symbols`);
  console.log(`nse-equities.csv: ${nse.trimEnd().split("\n").length - 1} symbols`);
}

main().catch((e) => {
  console.error(String(e?.message || e));
  process.exit(1);
});
