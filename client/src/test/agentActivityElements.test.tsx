/**
 * Regression for the harness run page: AgentActivity (the agent-workspace
 * reasoning feed) and RunMetadata (the run info tab) must render the
 * assistant-ui elements against a REAL run's trace — dece8c63, a failed run
 * with write_todos, a news tool, and a failed shareholdings call. The fixture
 * ends with the "usage" event the server now appends (token tally for the
 * cost meter).
 *
 * Fixture: src/test/fixtures/harness-trace.json (generated from the sqlite
 * run store — regenerate via the query in the repo notes if the trace shape
 * changes).
 */
import { describe, it, expect, beforeAll } from "vitest";
import type { ReactElement } from "react";

beforeAll(() => {
  if (!window.matchMedia) {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: (q: string) => ({
        matches: false, media: q, onchange: null,
        addListener: () => {}, removeListener: () => {},
        addEventListener: () => {}, removeEventListener: () => {},
        dispatchEvent: () => false,
      }),
    });
  }
  if (!("ResizeObserver" in globalThis)) {
    class ResizeObserverStub {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
    (window as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
  }
});

import { render, screen } from "@testing-library/react";
import { ChakraProvider, createSystem, defaultConfig } from "@chakra-ui/react";
import { ThemeProvider } from "next-themes";
import AgentActivity from "../components/shared/AgentActivity";
import { RunMetadata } from "../pages/AnalysisResult";
import { WorkspaceExplorer } from "../components/report/WorkspaceExplorer";
import type { TraceEvent } from "../pages/shared/TracePanel";
import fixture from "./fixtures/harness-trace.json";

function wrap(ui: ReactElement) {
  return (
    <ChakraProvider value={createSystem(defaultConfig)}>
      <ThemeProvider attribute="class" defaultTheme="dark">{ui}</ThemeProvider>
    </ChakraProvider>
  );
}

describe("AgentActivity — harness reasoning feed (assistant-ui elements)", () => {
  it("renders the agent-plan, flat tool calls, web search, and tool failure from a real trace", () => {
    const events = fixture.trace as TraceEvent[];
    render(
      wrap(
        <AgentActivity
          title="Reasoning history"
          events={events}
          agent={fixture.agent_name}
          active={false}
        />,
      ),
    );

    // AgentPlan derived from write_todos (the todo-list element is not used).
    expect(screen.getAllByText("Gather price/technical evidence (price history, technicals, quote)").length).toBeGreaterThan(0);
    expect(document.querySelector('[data-slot="agent-plan"]')).toBeTruthy();
    expect(document.querySelector('[data-slot="todo-list"]')).toBeNull();
    // No run-activity wrapper — the rows render flat, no "Finished" disclosure.
    expect(document.querySelector('[data-slot="run-activity"]')).toBeNull();

    // ToolCall row for a market-data tool.
    expect(screen.getAllByText("get_current_price").length).toBeGreaterThan(0);

    // WebSearch element fed by get_ticker_news stories.
    expect(screen.getAllByText(/Mufin Green Finance gets RBI licence/i).length).toBeGreaterThan(0);

    // ToolError element for the failed call(s) — the agent retried once.
    expect(screen.getAllByText("get_shareholdings").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/ON CONFLICT specification/i).length).toBeGreaterThan(0);

    // The homepage-card agent header: the agent's name stands alone.
    expect(screen.getAllByText(fixture.agent_name).length).toBeGreaterThan(0);
  });
});

describe("RunMetadata — run info tab (assistant-ui info elements)", () => {
  it("renders the iconless tool timeline and cost meter from the usage event (no waterfall)", () => {
    render(wrap(<RunMetadata run={fixture} />));

    // The plan section is gone from run info — it lives in the workspace.
    expect(document.querySelector('[data-slot="agent-plan"]')).toBeNull();
    // The trace waterfall is gone from run info too.
    expect(document.querySelector('[data-slot="trace-waterfall"]')).toBeNull();

    // ToolTimeline trigger.
    expect(screen.getAllByText(/tool calls/i).length).toBeGreaterThan(0);
    expect(document.querySelector('[data-slot="tool-timeline"]')).toBeTruthy();

    // CostMeter fed by the trace's usage event (formatTokenCount renders 54.4k).
    expect(document.querySelector('[data-slot="cost-meter"]')).toBeTruthy();
    expect(screen.getAllByText(/54\.4k tok/i).length).toBeGreaterThan(0);
  });
});

describe("WorkspaceExplorer — file navigator (assistant-ui File element)", () => {
  it("lists files as File rows and renders the selected file in a thin-bordered view", () => {
    const workspace = {
      "/index.md": "# Index\n\nWorkspace overview.",
      "/sources/news.json": JSON.stringify({ count: 1 }),
    };
    render(wrap(<WorkspaceExplorer workspace={workspace} />));

    // File rows in the sidebar (ghost variant of the File element).
    const rows = document.querySelectorAll('[data-slot="file-root"]');
    expect(rows.length).toBe(2);
    expect(screen.getAllByText("index.md").length).toBeGreaterThan(0);

    // The file view section: thin border, file content rendered.
    const selectedPath = screen.getAllByText("/index.md").length ? "/index.md" : Object.keys(workspace)[0];
    expect(screen.getAllByText(selectedPath).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Workspace overview/i).length).toBeGreaterThan(0);
  });
});
