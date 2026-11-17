/**
 * MCP smoke — connect to every configured MCP source, list its tools, and
 * make one read-only call. Exit non-zero on any failure.
 *
 *   npm run smoke:mcp
 */
import "dotenv/config";
import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import { loadRunFileConfig, resolveRunConfig } from "../harness/run-config.js";

const BUILTIN = new Set(["web_search", "search_news", "web_fetch"]);

const { config } = loadRunFileConfig();
const resolved = resolveRunConfig(process.env, config);
const entries = resolved.tools?.mcp ?? [];
if (!entries.length) {
  console.error("✗ no mcp entries in harness.config.json (tools.mcp)");
  process.exit(1);
}

let failed = false;
for (const entry of entries) {
  const url = entry.url ?? process.env[entry.urlEnv ?? ""] ?? "";
  if (!url) {
    console.error(`✗ ${entry.name}: no url — set ${entry.urlEnv ?? '"url"'}`);
    failed = true;
    continue;
  }
  try {
    const client = new MultiServerMCPClient({
      throwOnLoadError: true,
      mcpServers: { [entry.name]: { url, transport: "http" as const } },
    });
    const t0 = Date.now();
    const tools = await client.getTools();
    console.log(`✓ ${entry.name}: ${tools.length} tools from ${url} (${Date.now() - t0}ms)`);
    console.log(`  ${tools.map((t) => t.name).join(", ")}`);

    const collisions = tools.filter((t) => BUILTIN.has(t.name)).map((t) => t.name);
    if (collisions.length) console.warn(`  ! name collision with builtins: ${collisions.join(", ")}`);

    const probe = tools.find((t) => t.name === "yfinance_get_ticker_info");
    if (probe) {
      const r = await probe.invoke({ symbol: "AAPL" });
      const head = typeof r === "string" ? r : JSON.stringify(r);
      console.log(`✓ probe call (${Date.now() - t0}ms total): ${head.slice(0, 140)}…`);
    }
  } catch (e: any) {
    console.error(`✗ ${entry.name} unreachable at ${url}: ${e?.message || e}`);
    failed = true;
  }
}

// Composition check — the run toolbox really assembles from these sources.
try {
  const { buildRunTools } = await import("../harness/tools/index.js");
  const tools = await buildRunTools(resolved.tools, process.env, { symbol: "AAPL", source: "SEC" });
  console.log(`✓ buildRunTools → ${tools.length} tools: ${tools.map((t) => t.name).join(", ")}`);
} catch (e: any) {
  console.error(`✗ buildRunTools failed: ${e?.message || e}`);
  failed = true;
}

process.exit(failed ? 1 : 0);
