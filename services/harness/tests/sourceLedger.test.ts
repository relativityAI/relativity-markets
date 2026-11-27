import { describe, expect, it } from "vitest";
import { extractSources, resolveRefs } from "../report/sources.js";
import { ReportCanvas } from "../report/canvas.js";
import { reportWriteTool } from "../tools/report-write.js";
import type { TraceEvent } from "../types.js";

const SEARCH_RESULT = `Results for "microsoft ai capex":
Title: AI buildout hits snag — CNBC
URL: https://www.cnbc.com/2026/10/29/microsoft-google-ai-capex-estimates.html
Description: Big tech pulls back.

Title: Duplicate of the same article
URL: https://www.cnbc.com/2026/10/29/microsoft-google-ai-capex-estimates.html

Title: Broken asset
URL: https://cdn.example.com/logo.png
`;

function traceFixture(): TraceEvent[] {
  return [
    { type: "tool_call", tool: "web_url_read", toolCallId: "a", args: { url: "https://www.sec.gov/ix?doc=/Archives/edgar/data/1010680/x.htm" } },
    { type: "tool_result", tool: "web_url_read", toolCallId: "a", status: "ok", result: "Item 7. MD&A — see https://sec.gov/financial-report for details.", durationMs: 10 },
    { type: "tool_result", tool: "searxng_web_search", toolCallId: "b", status: "ok", result: SEARCH_RESULT, durationMs: 10 },
    // failed results and non-web tools never become citations
    { type: "tool_result", tool: "searxng_web_search", toolCallId: "c", status: "error", result: "https://dead.example.com/page", durationMs: 10 },
    { type: "tool_result", tool: "yfinance_get_price_history", toolCallId: "d", status: "ok", result: { note: "https://internal.example.org/meta" }, durationMs: 10 },
  ];
}

describe("extractSources — the verified ledger", () => {
  it("mines urls from calls and web results, titled and deduped", () => {
    const ledger = extractSources(traceFixture());
    expect(ledger.map((s) => s.id)).toEqual(["s1", "s2", "s3"]);
    expect(ledger[0].url).toContain("sec.gov/ix");
    expect(ledger[1].url).toContain("sec.gov/financial-report");
    expect(ledger[2].label).toBe("AI buildout hits snag — CNBC");
    expect(ledger[2].url).toBe("https://www.cnbc.com/2026/10/29/microsoft-google-ai-capex-estimates.html");
    // logo.png dropped, the duplicate collapsed into s2
    expect(ledger.some((s) => (s.url ?? "").endsWith(".png"))).toBe(false);
    expect(ledger.filter((s) => (s.url ?? "").includes("cnbc.com"))).toHaveLength(1);
  });

  it("ignores error results and non-web tools", () => {
    const urls = extractSources(traceFixture()).map((s) => s.url);
    expect(urls.join(" ")).not.toContain("dead.example.com");
    expect(urls.join(" ")).not.toContain("internal.example.org");
  });
});

describe("resolveRefs — hallucinated links never reach the report", () => {
  const ledger = extractSources(traceFixture());
  const real = ledger[2].url!;

  it("keeps verified urls, ledger ids and label-only refs; drops invented urls", () => {
    const out = resolveRefs(
      [
        { source: "CNBC — AI buildout", url: real },
        { source: "Nowhere", url: "https://never-visited.example.com/fake" },
        { source: "Yahoo Finance price data" },
        "s1",
        "nonsense-ref",
      ],
      ledger,
    );
    expect(out).toEqual([
      { source: "CNBC — AI buildout", url: real },
      { source: "Yahoo Finance price data" },
      "s1",
    ]);
  });

  it("passes everything through when there is no ledger to check against", () => {
    const refs = [{ source: "Anything", url: "https://anywhere.example.com" }];
    expect(resolveRefs(refs, [])).toEqual(refs);
  });
});

describe("report_write — every section ships a citation list", () => {
  const ledger = extractSources(traceFixture());

  it("backfills a citations block from the ledger when the section has none", async () => {
    const canvas = new ReportCanvas("MSFT");
    const tool = reportWriteTool({ canvas, sources: () => ledger });
    const res = await tool.invoke({
      title: "Outlook",
      sections: [{ heading: { level: 2, text: "Outlook", tagline: "Cautious" }, blocks: [{ type: "text", level: 1, text: "Revenue grew 4.2%." }] }],
    });
    expect(res).toMatchObject({ added: 1 });
    const blocks = canvas.document().sections[0].blocks;
    const cites = blocks.find((b) => b.type === "citations");
    expect(cites).toBeTruthy();
    expect(cites && "refs" in cites ? cites.refs.length : 0).toBe(ledger.length);
  });

  it("drops an unverifiable citation link and says so", async () => {
    const canvas = new ReportCanvas("MSFT");
    const tool = reportWriteTool({ canvas, sources: () => ledger });
    const res = (await tool.invoke({
      title: "Risks",
      sections: [
        {
          heading: { level: 2, text: "Risks", tagline: "Contained" },
          blocks: [
            { type: "text", level: 1, text: "Demand cools." },
            { type: "citations", refs: [{ source: "Invented", url: "https://never-visited.example.com/x" }] },
          ],
        },
      ],
    })) as Record<string, unknown>;
    expect(String(res.droppedRefs)).toContain("dropped");
    const cites = canvas.document().sections[0].blocks.find((b) => b.type === "citations");
    expect(cites && "refs" in cites ? cites.refs : []).toEqual([]);
  });
});
