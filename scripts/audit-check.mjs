/**
 * npm audit gate with one narrow, documented exception.
 *
 * GHSA-fc5q-39xc-vjpf (picomatch ReDoS via single-branch repeated extglobs)
 * affects every released picomatch version <= 4.0.7 — upstream has published
 * no patch (advisory "Patched versions: None"). It reaches us only through
 * deepagents -> fast-glob/micromatch -> picomatch. npm's sole "fix" is a
 * downgrade to deepagents@0.0.2, which breaks the harness, so we cannot
 * upgrade out of it.
 *
 * This script fails on every other high/critical advisory. Keeping the
 * exception here (rather than lowering npm's --audit-level) means a new
 * advisory still turns CI red.
 */
import { readFileSync } from "node:fs";

const ALLOWED_ADVISORIES = new Set(["GHSA-fc5q-39xc-vjpf"]);
const ALLOWED_PACKAGES = new Set(["picomatch"]);
const BLOCKING_SEVERITIES = new Set(["high", "critical"]);

const auditFile = process.argv[2];
if (!auditFile) {
  console.error("usage: node scripts/audit-check.mjs <npm-audit.json>");
  process.exit(2);
}

const audit = JSON.parse(readFileSync(auditFile, "utf8"));
const vulnerabilities = audit.vulnerabilities ?? {};
const blocking = [];

for (const [name, vuln] of Object.entries(vulnerabilities)) {
  for (const via of vuln.via ?? []) {
    // A string via is another vulnerable package; its own entry is checked.
    if (typeof via === "string") continue;
    if (!BLOCKING_SEVERITIES.has(via.severity)) continue;

    const advisory = String(via.url ?? "").split("/").pop();
    if (ALLOWED_ADVISORIES.has(advisory) && ALLOWED_PACKAGES.has(via.name)) continue;

    blocking.push({ package: name, advisory, title: via.title, severity: via.severity, url: via.url });
  }
}

if (blocking.length) {
  console.error("npm audit: blocking advisories found");
  for (const b of blocking) {
    console.error(`  [${b.severity}] ${b.package}: ${b.title} (${b.url || b.advisory})`);
  }
  process.exit(1);
}

const allowed = audit.metadata?.vulnerabilities ?? {};
console.log(
  `npm audit: no blocking advisories` +
    ` (${allowed.high ?? 0} high, ${allowed.critical ?? 0} critical from the documented picomatch exception)`,
);
