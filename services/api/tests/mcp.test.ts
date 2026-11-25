import { describe, it, expect } from "vitest";
import { parseMcpPrefs, runMcpEntries, defaultMcpEnabled, mcpKeyContext } from "../mcp.js";
import type { McpSourceConfig } from "../../harness/tools/sources.js";

const configured: McpSourceConfig[] = [
  { name: "yfinance", urlEnv: "MCP_YFINANCE_URL", required: true },
  { name: "searxng", urlEnv: "MCP_SEARXNG_MCP_URL", required: true },
];
const prefs = (v: unknown) => ({ mcp_servers: JSON.stringify(v) });

describe("MCP prefs", () => {
  it("treats a missing or malformed value as no preferences", () => {
    expect(parseMcpPrefs(undefined)).toEqual([]);
    expect(parseMcpPrefs({ mcp_servers: "not json" })).toEqual([]);
    expect(parseMcpPrefs({ mcp_servers: "{}" })).toEqual([]);
  });

  it("appends user-added servers without letting them shadow a configured one", () => {
    const entries = runMcpEntries(
      configured,
      prefs([
        { name: "yfinance", url: "http://elsewhere/mcp", custom: true },
        { name: "notes", url: "https://example.com/mcp", custom: true },
        { name: "no-url", custom: true },
      ]),
    );
    expect(entries.map((e) => e.name)).toEqual(["yfinance", "searxng", "notes"]);
    expect(entries[0].url).toBeUndefined();
    expect(entries[2]).toMatchObject({ name: "notes", url: "https://example.com/mcp", required: false });
  });

  it("drops disabled servers from the default allowlist, and only then", () => {
    expect(defaultMcpEnabled(configured, {})).toBeUndefined();
    expect(defaultMcpEnabled(configured, prefs([{ name: "searxng" }]))).toBeUndefined();
    const off = prefs([
      { name: "searxng", enabled: false },
      { name: "notes", url: "https://example.com/mcp", custom: true, enabled: false },
    ]);
    const entries = runMcpEntries(configured, off);
    expect(defaultMcpEnabled(entries, off)).toEqual(["yfinance"]);
    // Everything preconfigured off → only the user's own server is left.
    expect(defaultMcpEnabled(entries, prefs([{ name: "yfinance", enabled: false }, { name: "searxng", enabled: false }]))).toEqual(["notes"]);
  });
});

describe("MCP credentials", () => {
  it("binds a stored custom key as the connection's keyFrom", () => {
    const entries = runMcpEntries(
      configured,
      prefs([{ name: "notes", url: "https://example.com/mcp", custom: true, keyName: "mcpkey_notes" }]),
    );
    expect(entries[2]).toMatchObject({ name: "notes", keyFrom: "mcpkey_notes" });
    // No stored key → no credential bound.
    const bare = runMcpEntries(configured, prefs([{ name: "bare", url: "https://x/mcp", custom: true }]));
    expect(bare[2].keyFrom).toBeUndefined();
  });

  it("builds the run context from keyFrom → the llm_keys entry of the same name", () => {
    const entries = runMcpEntries(
      configured,
      prefs([{ name: "notes", url: "https://x/mcp", custom: true, keyName: "mcpkey_notes" }]),
    );
    expect(mcpKeyContext(entries, { mcpkey_notes: "secret" })).toEqual({ mcpkey_notes: "secret" });
    // Stored key removed → the ctx field is present but empty (skip, not keyless connect).
    expect(mcpKeyContext(entries, {}).mcpkey_notes).toBeUndefined();
    // No keyFrom → nothing bound, regardless of keys lying around.
    expect(mcpKeyContext(configured, { mcpkey_notes: "secret" })).toEqual({});
  });
});
