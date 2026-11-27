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
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
});

const searchEntities = vi.fn();
vi.mock("@/db", () => ({
  API_BASE: "/api",
  TaxonomyService: {
    search: (...a: unknown[]) => searchEntities(...a),
    group: vi.fn(),
    sectors: vi.fn(async () => []),
  },
  fetchQuoteChanges: vi.fn(async () => ({})),
  PluginService: { list: vi.fn(async () => [{ id: "p1", display_name: "NVDA Momentum", description: "Momentum plugin", origin: "custom", verified: 0, skill_count: 3, sources: [], categories: [], agent_category: null }]) },
  AnalysisService: {
    listAnalyses: vi.fn(async () => [{ id: "r1", symbol: "NVDA", share_name: "NVIDIA Corporation", status: "completed" }]),
  },
}));
vi.mock("@/auth/useAuth", () => ({ useAuth: () => ({ user: null, signOut: vi.fn() }) }));
vi.mock("@/auth/AuthContext", () => ({ LOCAL_AUTH: true }));
vi.mock("@/components/ui/color-mode", () => ({
  useColorMode: () => ({ colorMode: "light", toggleColorMode: vi.fn() }),
}));
vi.mock("@/components/shared/UserAvatar", () => ({ default: () => <div data-testid="avatar" /> }));

import NavBar from "@/components/NavBar";

function PathProbe() {
  const loc = useLocation();
  return <div data-testid="path">{loc.pathname + loc.search}</div>;
}

const renderNav = () =>
  render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route path="*" element={<><NavBar /><PathProbe /></>} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

describe("global entity search (TradingView-style)", () => {
  it("shows a default view on focus — never a dead empty list", async () => {
    const user = userEvent.setup();
    renderNav();

    await user.click(screen.getByRole("combobox"));
    const listbox = await screen.findByRole("listbox", {}, { timeout: 3000 });
    expect(listbox).toBeInTheDocument();
    // The Popular seed fills the default view; searchEntities never fired.
    expect(screen.getAllByRole("option").length).toBeGreaterThan(0);
    expect(screen.getByText(/Popular/i)).toBeInTheDocument();
    expect(searchEntities).not.toHaveBeenCalled();
  });

  it("searches stocks and groups, keyboard-selects, and navigates", async () => {
    const user = userEvent.setup();
    searchEntities.mockResolvedValue([
      { type: "stock", symbol: "NVDA", name: "NVIDIA Corporation", source: "SEC", exchange: "NASDAQ" },
      { type: "group", key: "IN:SECTOR:IN01", name: "Automobiles", source: "NSE", level: "sector", count: 42 },
    ]);
    renderNav();

    const input = screen.getByRole("combobox");
    await user.click(input);
    await user.keyboard("nvda");

    await screen.findByRole("listbox", {}, { timeout: 3000 });
    const stockRow = await screen.findByTestId("entity-row-stock-NVDA", {}, { timeout: 3000 });
    expect(screen.getByTestId("entity-row-group-IN:SECTOR:IN01")).toBeInTheDocument();
    expect(screen.getByText("STOCK")).toBeInTheDocument();
    expect(screen.getByText("SECTOR")).toBeInTheDocument();

    // One source mark on every row — the exchange logo, never a country flag.
    const groupRow = screen.getByTestId("entity-row-group-IN:SECTOR:IN01");
    for (const row of [stockRow, groupRow]) {
      const srcs = [...row.querySelectorAll("img")].map((i) => i.getAttribute("src") || "");
      expect(srcs.some((s) => s.includes("sec_logo") || s.includes("nse_logo"))).toBe(true);
      expect(srcs.some((s) => s.includes("symbol-logo"))).toBe(false);
    }

    // Keyboard: aria-activedescendant on the input, Enter picks row 0.
    await user.keyboard("{ArrowDown}");
    expect(input.getAttribute("aria-activedescendant")).toBe("entity-search-opt-0");
    expect(stockRow).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{Enter}");
    expect(screen.getByTestId("path").textContent).toBe("/stock/NVDA?source=SEC");
  });

  it("records picks as recent searches shown on the next open", async () => {
    const user = userEvent.setup();
    searchEntities.mockResolvedValue([
      { type: "stock", symbol: "NVDA", name: "NVIDIA Corporation", source: "SEC", exchange: "NASDAQ" },
    ]);
    renderNav();

    await user.click(screen.getByRole("combobox"));
    await user.keyboard("nvda");
    await screen.findByTestId("entity-row-stock-NVDA", {}, { timeout: 3000 });
    await user.click(screen.getByTestId("entity-row-stock-NVDA"));

    // Re-open: the pick is now a recent search, AND Popular stays listed.
    await user.click(screen.getByRole("combobox"));
    await screen.findByRole("listbox", {}, { timeout: 3000 });
    expect(screen.getByText(/Recent searches/i)).toBeInTheDocument();
    expect(screen.getByText(/Popular/i)).toBeInTheDocument();
    const nvdaRows = await screen.findAllByTestId("entity-row-stock-NVDA", {}, { timeout: 3000 });
    expect(nvdaRows.length).toBe(2);
  });

  it("Escape closes the listbox and keeps the query", async () => {
    const user = userEvent.setup();
    searchEntities.mockResolvedValue([
      { type: "stock", symbol: "NVDA", name: "NVIDIA Corporation", source: "SEC", exchange: "NASDAQ" },
    ]);
    renderNav();

    await user.click(screen.getByRole("combobox"));
    await user.keyboard("nvda");
    await screen.findByRole("listbox", {}, { timeout: 3000 });

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(screen.getByRole("combobox")).toHaveValue("nvda");
  });
});
