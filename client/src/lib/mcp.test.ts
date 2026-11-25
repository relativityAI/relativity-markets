import { describe, it, expect } from "vitest";
import type { McpSource } from "@/db";
import { mcpServerState, requiredIssue } from "./mcp";

const src = (over: Partial<McpSource>): McpSource => ({
    name: "s",
    label: "S",
    required: false,
    url: "",
    urlEnv: "",
    enabled: true,
    custom: false,
    tools: [],
    status: "up",
    ...over,
});

describe("mcpServerState — intent × probe", () => {
    it("user intent wins, then the probe decides", () => {
        expect(mcpServerState(src({ enabled: false, status: "up" }))).toBe("disabled");
        expect(mcpServerState(src({ enabled: false, status: "down" }))).toBe("disabled");
        expect(mcpServerState(src({ status: "up" }))).toBe("active");
        expect(mcpServerState(src({ status: "down" }))).toBe("down");
        expect(mcpServerState(src({ status: "needs-key" }))).toBe("needs-key");
        expect(mcpServerState(src({ status: "needs-auth" }))).toBe("needs-auth");
        expect(mcpServerState(src({ status: "no-url" }))).toBe("down");
    });
});

describe("requiredIssue — quiet heads-up", () => {
    const yf = src({ name: "yfinance", label: "Yahoo Finance data (yfinance)", required: true });
    const sx = src({ name: "searxng", label: "Web search (SearXNG)", required: true });

    it("flags a required server switched off", () => {
        expect(requiredIssue([yf], [])).toMatch(/Yahoo Finance data/);
        expect(requiredIssue([yf], ["yfinance"])).toBeNull();
    });

    it("covers the web-search source too — SearXNG off means no web search", () => {
        expect(requiredIssue([sx], [])).toMatch(/Web search \(SearXNG\)/);
        expect(requiredIssue([sx], ["searxng"])).toBeNull();
    });

    it("ignores optional servers", () => {
        expect(requiredIssue([src({ name: "tradingview" })], [])).toBeNull();
    });
});
