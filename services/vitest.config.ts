import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Tests must never open the developer's live SQLite file — one suite
    // imports the API (top-level initPlugins) and would migrate/backfill it.
    env: { SQLITE_PATH: "data/test.db" },
    // default excludes (node_modules) + built output — stale compiled test
    // copies in dist/ otherwise get picked up and double-count.
    exclude: ["**/node_modules/**", "dist/**"],
  },
});
