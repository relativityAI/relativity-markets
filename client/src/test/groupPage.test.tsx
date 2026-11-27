/**
 * Group page — constituents render as a plain logo+name list (not a watchlist),
 * rows link to stock pages, and "Create a watchlist" persists the whole group.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

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
});

const group = vi.fn();
const createWatchlist = vi.fn();
vi.mock("@/db", () => ({
  API_BASE: "/api",
  TaxonomyService: { group: (...a: unknown[]) => group(...a), search: vi.fn(async () => []), sectors: vi.fn(async () => []) },
  WatchlistService: { create: (...a: unknown[]) => createWatchlist(...a) },
  PluginService: { list: vi.fn(async () => []) },
  AnalysisService: { listAnalyses: vi.fn(async () => []) },
}));

import Group from "@/pages/Group";

function PathProbe() {
  const loc = useLocation();
  return <div data-testid="path">{loc.pathname + loc.search}</div>;
}

const GROUP = {
  key: "IN:SECTOR:IN08",
  market: "NSE",
  level: "sector",
  code: "IN08",
  name: "Information Technology",
  path: ["Information Technology"],
  count: 2,
  constituents: [
    { symbol: "TCS", name: "Tata Consultancy Services Limited", source: "NSE" },
    { symbol: "INFY", name: "Infosys Limited", source: "NSE" },
  ],
};

const renderGroup = () =>
  render(
    <MemoryRouter initialEntries={["/group/IN:SECTOR:IN08"]}>
      <Routes>
        <Route path="/group/:key" element={<><Group /><PathProbe /></>} />
        <Route path="*" element={<PathProbe />} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  group.mockResolvedValue(GROUP);
  createWatchlist.mockResolvedValue({ id: "w1" });
});

describe("group page", () => {
  it("lists constituents with logo + name only, linking to stock pages", async () => {
    const user = userEvent.setup();
    renderGroup();

    expect((await screen.findAllByText("Information Technology")).length).toBeGreaterThan(0);
    const tcs = screen.getByTestId("group-stock-TCS");
    expect(tcs).toHaveAttribute("href", "/stock/TCS?source=NSE");
    expect(screen.getByTestId("group-stock-INFY")).toBeInTheDocument();
    expect(screen.getByText("2 stocks")).toBeInTheDocument();

    await user.click(tcs);
    expect(screen.getByTestId("path").textContent).toBe("/stock/TCS?source=NSE");
  });

  it("creates a watchlist from the whole group", async () => {
    const user = userEvent.setup();
    renderGroup();

    await user.click(await screen.findByTestId("group-watchlist"));
    expect(createWatchlist).toHaveBeenCalledWith(
      "Information Technology",
      [
        { symbol: "TCS", source: "NSE", name: "Tata Consultancy Services Limited" },
        { symbol: "INFY", source: "NSE", name: "Infosys Limited" },
      ],
    );
  });
});
