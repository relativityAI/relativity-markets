/**
 * probeEntry's offline branches — no url and a missing per-user key are
 * decided before any network I/O, so they run without servers up.
 * (The live path is covered by `npm run smoke:mcp`.)
 */
import { describe, it, expect } from "vitest";
import { probeEntry } from "../datasources.js";

describe("probeEntry offline branches", () => {
  it("no url → no-url, naming the env var that isn't set", async () => {
    const r = await probeEntry({ name: "nourl", urlEnv: "MCP_NOPE_URL" });
    expect(r.status).toBe("no-url");
    expect(r.error).toContain("MCP_NOPE_URL");
    expect(r.tools).toEqual([]);
  });

  it("keyFrom without the user's key → needs-key, no connection attempted", async () => {
    const r = await probeEntry(
      { name: "notes", url: "http://127.0.0.1:9/mcp", keyFrom: "mcpkey_notes" },
      { keys: {} },
    );
    expect(r.status).toBe("needs-key");
    expect(r.error).toContain("mcpkey_notes");
  });

  it("HTTP 401 → needs-auth (server up, demanding credentials — spec's 401 answer)", async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = (async () => new Response("", { status: 401 })) as typeof fetch;
    try {
      const r = await probeEntry({ name: "searxng", url: "http://searxng.test/mcp" });
      expect(r.status).toBe("needs-auth");
      expect(r.error).toContain("401");
    } finally {
      globalThis.fetch = orig;
    }
  });
});
