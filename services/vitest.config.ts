import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // default excludes (node_modules) + built output — stale compiled test
    // copies in dist/ otherwise get picked up and double-count.
    exclude: ["**/node_modules/**", "dist/**"],
  },
});
