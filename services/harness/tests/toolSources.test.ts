import { describe, expect, it } from "vitest";
import { buildRunTools, type ToolSourcesConfig } from "../tools/sources.js";

/**
 * A down MCP server degrades the toolbox, never the run: `buildRunTools`
 * must resolve with the remaining tools and report what it skipped —
 * the run's notes carry that to the result page.
 */
describe("buildRunTools degradation", () => {
  it("skips an unreachable required source instead of failing the run", async () => {
    const cfg: ToolSourcesConfig = {
      mcp: [{ name: "down", url: "http://127.0.0.1:9/mcp", required: true }],
    };
    const { tools, skipped, close } = await buildRunTools(cfg, {}, { symbol: "T", source: "SEC" });
    try {
      expect(skipped).toContain("down");
      // The local toolbox still ships — the run has something to work with.
      expect(tools.some((t) => t.name === "stock_technical_analysis")).toBe(true);
    } finally {
      await close();
    }
  }, 20_000);

  it("reports a source with no url, but not one the run simply disabled", async () => {
    const cfg: ToolSourcesConfig = {
      mcp: [
        { name: "no-url", urlEnv: "DEFINITELY_NOT_SET_URL", required: true },
        { name: "off", url: "http://127.0.0.1:9/mcp" },
      ],
    };
    // Enabled-by-the-run "no-url" fails its url check (reported)…
    const { skipped, close } = await buildRunTools(cfg, {}, {
      symbol: "T",
      source: "SEC",
      mcpEnabled: ["no-url"],
    });
    try {
      expect(skipped).toContain("no-url");
      // …while a server the run turned off is never attempted, never "skipped".
      expect(skipped).not.toContain("off");
    } finally {
      await close();
    }
  }, 20_000);
});
