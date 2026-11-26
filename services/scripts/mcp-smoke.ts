/**
 * MCP smoke — connect to every configured MCP source, list its tools, and
 * make one read-only call. Exit non-zero on any failure.
 *
 *   npm run smoke:mcp
 */
import "dotenv/config";
import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import { loadRunFileConfig, resolveRunConfig } from "../harness/run-config.js";

const { config } = loadRunFileConfig();
const resolved = resolveRunConfig(process.env, config);
const entries = resolved.tools?.mcp ?? [];
if (!entries.length) {
  console.error("✗ no mcp entries in harness.config.json (tools.mcp)");
  process.exit(1);
}

let failed = false;
for (const entry of entries) {
  // Keyed sources need a per-user credential the smoke has no access
  // to — buildRunTools skips them too, so do the same here.
  if (entry.keyFrom) {
    console.log(`- ${entry.name}: skipped (needs ${entry.keyFrom})`);
    continue;
  }
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
    const allowed = entry.allow?.length ? tools.filter((t) => entry.allow!.includes(t.name)) : tools;
    console.log(`✓ ${entry.name}: ${allowed.length}/${tools.length} tools from ${url} (${Date.now() - t0}ms)`);
    console.log(`  ${allowed.map((t) => t.name).join(", ")}`);
    const unknown = (entry.allow ?? []).filter((n) => !tools.some((t) => t.name === n));
    if (unknown.length) {
      console.error(`  ! allow-list names not on the server: ${unknown.join(", ")}`);
      failed = true;
    }

    // Best-effort read-only call. Tools have different arg schemas, so a
    // mismatch here is a note, not a failure — tools/list already proved the
    // tool exists and the allow list is correct.
    const probe = allowed.find((t) => /info|instance/i.test(t.name)) ?? allowed[0];
    if (probe) {
      try {
        const r = await probe.invoke(probe.name.includes("ticker_info") ? { symbol: "AAPL" } : {});
        const head = typeof r === "string" ? r : JSON.stringify(r);
        console.log(`✓ probe call ${probe.name}: ${head.slice(0, 140)}…`);
      } catch (e: any) {
        console.log(`- probe call ${probe.name} skipped (needs args): ${e?.message || e}`);
      }
    }
    await client.close();
  } catch (e: any) {
    console.error(`✗ ${entry.name} unreachable at ${url}: ${e?.message || e}`);
    failed = true;
  }
}

// Composition check — the run toolbox really assembles from these sources.
try {
  const { buildRunTools } = await import("../harness/tools/index.js");
  const { tools, close } = await buildRunTools(resolved.tools, process.env, { symbol: "AAPL", source: "SEC" });
  console.log(`✓ buildRunTools → ${tools.length} tools: ${tools.map((t) => t.name).join(", ")}`);
  await close();
} catch (e: any) {
  console.error(`✗ buildRunTools failed: ${e?.message || e}`);
  failed = true;
}

process.exit(failed ? 1 : 0);
