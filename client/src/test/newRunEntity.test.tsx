/**
 * New Run form — the Category select is gone (category is inferred from the
 * picked entity and shown as a badge), the skill bar stays shut until an entity
 * is picked, skills the entity can't run stay in the list disabled behind a
 * caution badge, and the group payload carries the taxonomy key.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";

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

const GROUP = {
  key: "IN:SECTOR:IN08",
  market: "NSE",
  level: "sector",
  code: "IN08",
  name: "Information Technology",
  path: ["Information Technology"],
  count: 2,
  constituents: [],
};

vi.mock("@/db", () => ({
  API_BASE: "/api",
  TaxonomyService: {
    search: vi.fn(async () => []),
    group: vi.fn(async () => GROUP),
    sectors: vi.fn(async () => []),
  },
  fetchQuoteChanges: vi.fn(async () => ({})),
  PluginService: {
    list: vi.fn(async () => [
      { id: "chartist", display_name: "Chartist", description: "", origin: "relativity", verified: 1, skill_count: 1, sources: [], categories: [], agent_category: "equity" },
      { id: "sectoral-rotation", display_name: "Sectoral Rotation", description: "", origin: "relativity", verified: 1, skill_count: 1, sources: [], categories: [], agent_category: "industry" },
    ]),
    read: vi.fn(async (id: string) => ({
      id,
      skills: [{ id: `${id}-skill`, name: `${id} skill`, description: "" }],
      skill_count: 1,
    })),
    mcpSources: vi.fn(async () => ({ servers: [] })),
  },
  AnalysisService: {
    listAnalyses: vi.fn(async () => []),
    getAvailableModels: vi.fn(async () => []),
    validateModel: vi.fn(async () => ({ valid: true })),
    runAnalysis: vi.fn(async () => ({ id: "run1" })),
    listAlertRules: vi.fn(async () => []),
    listOccurrences: vi.fn(async () => []),
  },
  runPluginLabel: () => "",
}));
vi.mock("@/auth/useAuth", () => ({ useAuth: () => ({ user: null, signOut: vi.fn() }) }));
vi.mock("@/auth/AuthContext", () => ({ LOCAL_AUTH: true }));
vi.mock("@/components/ui/color-mode", () => ({ useColorMode: () => ({ colorMode: "light", toggleColorMode: vi.fn() }) }));

import Analysis from "@/pages/Analysis";

const renderForm = () =>
  render(
    <MemoryRouter initialEntries={["/new-run"]}>
      <Routes>
        <Route path="/new-run" element={<Analysis />} />
        <Route path="/runs/:id" element={<div />} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

describe("new run form", () => {
  it("has no category select — and no badge until an entity is picked", () => {
    renderForm();
    expect(screen.queryByTestId("run-category")).not.toBeInTheDocument();
    // Nothing inferred before a pick: no Equity default.
    expect(screen.queryByTestId("run-category-badge")).not.toBeInTheDocument();
    // The skill bar sits closed until an entity gives it a category.
    expect(screen.getByLabelText("Search skills")).toBeDisabled();
    expect(screen.getByPlaceholderText("Pick an entity first…")).toBeInTheDocument();
  });

  it("preselects a group from ?group= and flips the badge to Industry", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/new-run?group=IN:SECTOR:IN08"]}>
        <Routes>
          <Route path="/new-run" element={<Analysis />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText("Information Technology")).toBeInTheDocument();
    expect(screen.getByTestId("run-category-badge")).toHaveTextContent("Industry");
    // Every skill stays in the list; the wrong-kind one is disabled, not hidden.
    await user.click(screen.getByLabelText("Search skills"));
    expect(await screen.findByTestId("skill-check-sectoral-rotation-skill")).toBeEnabled();
    expect(screen.getByTestId("skill-check-chartist-skill")).toBeDisabled();
    expect(screen.getByTestId("skill-unavailable-chartist-skill")).toHaveTextContent(
      "Not available for this entity",
    );
  });

  it("runs a group with the taxonomy key as the symbol", async () => {
    const { AnalysisService } = await import("@/db");
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/new-run?group=IN:SECTOR:IN08"]}>
        <Routes>
          <Route path="/new-run" element={<Analysis />} />
          <Route path="/runs/:id" element={<div />} />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByText("Information Technology");
    await user.type(screen.getByPlaceholderText("Search skills…"), "sectoral");
    const skillBox = await screen.findByTestId("skill-check-sectoral-rotation-skill");
    await user.click(skillBox);

    // Pick the model (required before the run button enables).
    await user.click(document.querySelector('[data-testid="run-model"] [role="button"]') as HTMLElement);
    await user.click(await screen.findByRole("option", { name: /deepseek/i }));

    const runButton = await screen.findByRole("button", { name: /Run analysis/i });
    await user.click(runButton);
    await vi.waitFor(() => {
      expect(AnalysisService.runAnalysis).toHaveBeenCalled();
    });
    const payload = (AnalysisService.runAnalysis as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(payload.symbol).toBe("IN:SECTOR:IN08");
    expect(payload.share_name).toBe("Information Technology");
    expect(payload.source).toBe("NSE");
  });
});
