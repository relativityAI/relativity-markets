/**
 * Human summaries for tool calls.
 *
 * A trace line like `fs_write path=notes.md content=…` tells a reader
 * nothing. These summaries are what the live timeline shows: "Saving report
 * section", "Web search: …". One place, used by the loop for every tool it
 * executes.
 */

function str(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  return typeof v === "string" && v ? v : "";
}

export function describeToolCall(tool: string, args: unknown): string {
  const a = (args && typeof args === "object" ? args : {}) as Record<string, unknown>;
  const symbol = str(a, "symbol");

  switch (tool) {
    case "todo_write":
      return "Updating plan";
    case "fs_write": {
      const path = str(a, "path");
      if (path.startsWith("/workspace/report/sections/")) return "Saving report section";
      if (path === "/workspace/plan.json" || path === "/workspace/plan.md") return "Updating plan";
      return `Writing ${path.replace(/^\//, "")}`;
    }
    case "fs_append": {
      const path = str(a, "path");
      if (path === "/workspace/plan.json" || path === "/workspace/plan.md") return "Updating plan";
      return `Appending to ${path.replace(/^\//, "")}`;
    }
    case "fs_read": {
      const path = str(a, "path");
      if (path.startsWith("/index.md")) return "Reading workspace index";
      return `Reading ${path.replace(/^\//, "")}`;
    }
    case "fs_ls":
      return "Listing workspace files";
    case "fs_grep": {
      const q = str(a, "query");
      return q ? `Searching workspace: ${q.slice(0, 60)}` : "Searching workspace";
    }
    default:
      break;
  }

  if (/price|candle|ohlc/i.test(tool)) return symbol ? `Fetching price history: ${symbol}` : "Fetching price history";
  if (/indicator|rsi|macd|adx|bband|sma|ema/i.test(tool)) return symbol ? `Fetching indicators: ${symbol}` : "Fetching indicators";
  if (/technical/i.test(tool)) return symbol ? `Fetching technicals: ${symbol}` : "Fetching technicals";
  if (/fundamental|financial|balance|income|earning/i.test(tool)) return symbol ? `Fetching fundamentals: ${symbol}` : "Fetching fundamentals";
  if (/news|headline|sentiment/i.test(tool)) return symbol ? `Fetching news: ${symbol}` : "Fetching news";
  if (/search|web/i.test(tool)) {
    const q = str(a, "query");
    return q ? `Web search: ${q.slice(0, 60)}` : "Web search";
  }
  if (/profile|company/i.test(tool)) return symbol ? `Company profile: ${symbol}` : "Company profile";
  const pretty = tool.replace(/_/g, " ");
  return symbol ? `${pretty} (${symbol})` : pretty;
}
