import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

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
  AnalysisService: { listAnalyses: vi.fn(async () => state.runs) },
}));

import Stock from "@/pages/Stock";

const renderStock = () => render(
  <>
    <MemoryRouter initialEntries={["/stock/EXIDEIND?source=NSE"]}>
      <Routes><Route path="/stock/:symbol" element={<Stock />} /></Routes>
    </MemoryRouter>
  </>
);

describe("stock page", () => {
  beforeEach(() => {
    state.runs = [];
  });

  it("shows no placeholder agents when there are no saved runs", async () => {
    renderStock();
    expect(await screen.findByText("No runs for EXIDEIND yet.")).toBeTruthy();
    expect(screen.queryByText(/Value Agent/)).toBeNull();
    expect(screen.queryByText(/Momentum Agent/)).toBeNull();
  });

  it("sends View all runs to the results list filtered to this stock", async () => {
    renderStock();
    await screen.findByText("No runs for EXIDEIND yet.");
    expect(screen.getByRole("link", { name: /view all runs/i }).getAttribute("href"))
      .toBe("/runs?q=EXIDEIND");
  });

  it("lists only saved runs vertically beside the stock block", async () => {
    state.runs = [
      { id: "run-1", symbol: "EXIDEIND", source: "NSE", agent_name: "Chartist Analyst", verdict: "Good", created_at: "2026-11-17T09:00:00Z" },
      { id: "run-2", symbol: "EXIDEIND", source: "NSE", agent_name: "Risk Agent", verdict: "Poor", created_at: "2026-11-16T09:00:00Z" },
      { id: "run-3", symbol: "OTHER", source: "NSE", agent_name: "Other Agent", verdict: "Good", created_at: "2026-11-17T09:00:00Z" },
    ];
    renderStock();
    expect(await screen.findByText("Chartist Analyst")).toBeTruthy();
    expect(screen.getByText("Risk Agent")).toBeTruthy();
    expect(screen.queryByText("Other Agent")).toBeNull();
    expect(screen.getByRole("link", { name: /Chartist Analyst/i }).getAttribute("href")).toBe("/runs/run-1");

    // The runs are stacked one below another, not a multi-column grid.
    const list = screen.getByText("Chartist Analyst").closest("a")!.parentElement!;
    expect(list.className).toContain("flex-col");

    // Title stays as a heading, and all three TradingView widgets mount.
    expect(screen.getByRole("heading", { name: "EXIDEIND" })).toBeTruthy();
    expect(document.querySelectorAll("script[src*='embed-widget']").length).toBe(3);
  });
});
