import type { McpSource } from "@/db";
import searxngLogo from "@/assets/searxng.svg";
import yahooLogo from "@/assets/yahoo_finance.png";
import tradingviewLogo from "@/assets/tradingview.svg";

/** Server-name → logo (navbar chips and Settings cards share one map). */
export const MCP_LOGOS: Record<string, string> = {
    searxng: searxngLogo,
    tradingview: tradingviewLogo,
    yfinance: yahooLogo,
};

/** The one truth for a server chip: user intent × live probe. */
export type McpServerState = "disabled" | "active" | "down" | "needs-key" | "needs-auth";

export function mcpServerState(s: Pick<McpSource, "enabled" | "status">): McpServerState {
    if (!s.enabled) return "disabled";
    if (s.status === "up") return "active";
    if (s.status === "needs-key") return "needs-key";
    if (s.status === "needs-auth") return "needs-auth";
    return "down";
}

/** Dot color per state — the one palette so Settings, Run and navbar agree. */
export const MCP_STATE_DOT: Record<McpServerState, string> = {
    active: "var(--signal-positive)",
    down: "var(--signal-negative)",
    "needs-key": "#C49A6C",
    "needs-auth": "#C49A6C",
    disabled: "var(--ink-tertiary)",
};

export const MCP_STATE_LABEL: Record<McpServerState, string> = {
    active: "Active",
    down: "Down",
    "needs-key": "Needs key",
    "needs-auth": "Needs auth",
    disabled: "Disabled",
};

/**
 * Non-blocking hint: a required server switched off for this run.
 * Returns the warning text, or null when everything required is on.
 */
export function requiredIssue(sources: McpSource[], enabled: string[]): string | null {
    const off = sources.filter((s) => s.required && !enabled.includes(s.name));
    if (!off.length) return null;
    const names = off.map((s) => s.label).join(", ");
    return `${names} ${off.length > 1 ? "are" : "is"} off this run — the agent proceeds without ${off.length > 1 ? "them" : "it"}.`;
}
