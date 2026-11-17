import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { ChakraProvider, createSystem, defaultConfig } from "@chakra-ui/react";

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
  if (!globalThis.ResizeObserver) {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});

const state = vi.hoisted(() => ({ runs: [] as any[] }));

vi.mock("@/db", () => ({
  API_BASE: "/api",
  AnalysisService: {
    listAnalyses: vi.fn(async () => state.runs),
    deleteAnalysis: vi.fn(async () => {}),
  },
  AgentService: { listAgents: vi.fn(async () => []) },
  SkillService: { listSkills: vi.fn(async () => []) },
}));
vi.mock("@/lib/harnessAgents", () => ({
  HarnessAgentService: { listSystemPrompts: vi.fn(async () => []) },
}));

import AnalysisList from "@/pages/AnalysisList";

const renderList = (entry: string) => render(
  <ChakraProvider value={createSystem(defaultConfig)}>
    <MemoryRouter initialEntries={[entry]}>
      <Routes><Route path="/analysis-list" element={<AnalysisList />} /></Routes>
    </MemoryRouter>
  </ChakraProvider>
);

describe("analysis list stock deep link", () => {
  beforeEach(() => {
    state.runs = [
      { id: "r1", symbol: "EXIDEIND", share_name: "Exide Industries Limited", agent_name: "chartist", verdict: "Good", created_at: "2026-11-17T09:00:00Z", total_score: 80, status: "completed" },
      { id: "r2", symbol: "OTHER", share_name: "Other Corp", agent_name: "chartist", verdict: "Good", created_at: "2026-11-16T09:00:00Z", total_score: 70, status: "completed" },
    ];
  });

  it("pre-fills the search box from ?q= and filters runs with the normal search logic", async () => {
    renderList("/analysis-list?q=EXIDEIND");

    const box = await screen.findByRole("textbox", { name: /search runs/i });
    expect((box as HTMLInputElement).value).toBe("EXIDEIND");
    expect(await screen.findByText("Exide Industries Limited")).toBeTruthy();
    expect(screen.queryByText("Other Corp")).toBeNull();
  });

  it("shows all runs when there is no q param", async () => {
    renderList("/analysis-list");

    const box = await screen.findByRole("textbox", { name: /search runs/i });
    expect((box as HTMLInputElement).value).toBe("");
    expect(await screen.findByText("Exide Industries Limited")).toBeTruthy();
    expect(await screen.findByText("Other Corp")).toBeTruthy();
  });
});
