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

vi.mock("@/db", () => ({
  API_BASE: "/api",
  PluginService: { list: vi.fn(async () => [{ id: "p1", display_name: "NVDA Momentum", description: "Momentum plugin", origin: "custom", verified: 0, skill_count: 3, sources: [], categories: [] }]) },
  AnalysisService: {
    listAnalyses: vi.fn(async () => [{ id: "r1", symbol: "NVDA", share_name: "NVIDIA Corporation", status: "completed" }]),
  },
  SkillService: { listSkills: vi.fn(async () => [{ id: "s1", name: "NVDA sector skill", description: "" }]) },
  SettingsService: { getSettings: vi.fn(async () => ({ llm_keys: {} })) },
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

describe("global search (stocks/plugins/runs)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const json = url.includes("/stocks/search")
        ? [{ ticker: "NVDA", name: "NVIDIA Corporation", source: "us" }]
        : url.includes("/health/sources")
          ? { sources: {} }
          : {};
      return { ok: true, status: 200, json: async () => json } as Response;
    }));
  });

  it("groups all three sources and selects with the keyboard via aria-activedescendant", async () => {
    const user = userEvent.setup();
    renderNav();

    const input = screen.getByRole("combobox");
    await user.click(input);
    await user.keyboard("nv");

    // Debounced fetch → grouped listbox, one group per source.
    const listbox = await screen.findByRole("listbox", {}, { timeout: 3000 });
    expect(listbox).toBeInTheDocument();
    // Same name twice: the stock row and the run row (both "NVIDIA Corporation").
    const nvidia = await screen.findAllByRole("option", { name: /NVIDIA Corporation/ }, { timeout: 3000 });
    expect(nvidia.length).toBe(2);
    for (const label of ["Stocks", "Plugins", "Runs"]) {
      expect(screen.getByRole("group", { name: label })).toBeInTheDocument();
    }
    expect(screen.getByRole("option", { name: /NVDA Momentum/ })).toBeInTheDocument();

    // Focus never leaves the input; the active option is announced on it.
    expect(document.activeElement).toBe(input);
    await user.keyboard("{ArrowDown}");
    expect(input.getAttribute("aria-activedescendant")).toBe("nav-search-opt-0");
    expect(nvidia[0]).toHaveAttribute("aria-selected", "true");

    await user.keyboard("{Enter}");
    expect(screen.getByTestId("path").textContent).toBe("/stock/NVDA?source=US");
  });

  it("Escape closes the listbox and keeps the query", async () => {
    const user = userEvent.setup();
    renderNav();

    await user.click(screen.getByRole("combobox"));
    await user.keyboard("nv");
    await screen.findByRole("listbox", {}, { timeout: 3000 });

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(screen.getByRole("combobox")).toHaveValue("nv");
  });
});
