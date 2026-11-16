// Post-build: copy runtime assets into dist/ (cross-platform — no `cp`).
// Run by `npm run build` in services/, after tsc.
import { cpSync, existsSync } from "node:fs";

for (const d of ["config", "assets"]) cpSync(d, `dist/${d}`, { recursive: true });
cpSync("harness/assets", "dist/harness/assets", { recursive: true });
if (existsSync("harness/agent-defaults"))
  cpSync("harness/agent-defaults", "dist/harness/agent-defaults", { recursive: true });
