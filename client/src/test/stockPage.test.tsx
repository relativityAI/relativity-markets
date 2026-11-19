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
vi.mock("@/lib/sourceLogos", () => ({ TickerLogo: () => null }));
vi.mock("@/components/shared/Echart", () => ({ default: () => null }));

import Stock from "@/pages/Stock";

const overview = {
  symbol: "EXIDEIND", name: "Exide Industries", price: 320, change: 2, change_pct: 0.6,
  currency: "INR", market_cap: 27000000000, pe: 20, prev_close: 318, volume: 100000,
  fifty_two_week_high: 400, fifty_two_week_low: 200, exchange: "NSE",
  ltp_time: "2026-11-17T10:00:00Z", period: "1y",
  candles: [{ date: "2026-01-01", close: 100 }, { date: "2026-01-02", close: 110 }],
};

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
    vi.stubGlobal("fetch", vi.fn(async (url: string) => ({
      ok: true,
      json: async () => (String(url).includes("/overview") ? overview : {}),
    })));
  });

  it("shows no placeholder agents when there are no saved runs", async () => {
    renderStock();
    expect(await screen.findByText("No agent runs for EXIDEIND yet.")).toBeTruthy();
    expect(screen.queryByText(/Value Agent/)).toBeNull();
    expect(screen.queryByText(/Momentum Agent/)).toBeNull();
  });

  it("sends View all runs to the results list filtered to this stock", async () => {
    renderStock();
    await screen.findByText("No agent runs for EXIDEIND yet.");
    expect(screen.getByRole("link", { name: /view all runs/i }).getAttribute("href"))
      .toBe("/analysis-list?q=EXIDEIND");
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
    expect(screen.getByRole("link", { name: /Chartist Analyst/i }).getAttribute("href")).toBe("/analysis-result/run-1");

    // The runs are stacked one below another, not a multi-column grid.
    const list = screen.getByText("Chartist Analyst").closest("a")!.parentElement!;
    expect(list.className).toContain("flex-col");

    // Title, metadata and chart stay in the left block.
    expect(screen.getByRole("heading", { name: "Exide Industries" })).toBeTruthy();
    expect(screen.getByText("Market cap")).toBeTruthy();
    expect(screen.getByText(/Close · last 1y/i)).toBeTruthy();
  });
});
