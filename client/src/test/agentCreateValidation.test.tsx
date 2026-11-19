import { describe, it, expect, vi, beforeAll } from "vitest";

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

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ThemeProvider } from "next-themes";

vi.mock("@/db", () => ({
  AgentService: {
    listAgents: vi.fn(async () => []),
    listDefaultAgents: vi.fn(async () => []),
    listCategories: vi.fn(async () => ["Research", "Valuation"]),
    createAgent: vi.fn(async (input: Record<string, unknown>) => ({ id: "a1", ...input })),
    updateAgent: vi.fn(async () => ({})),
    deleteAgent: vi.fn(async () => {}),
  },
  SkillService: {
    listSkills: vi.fn(async () => [
      { id: "s1", name: "DCF", description: "", category: "", version: 1, source: "builtin" },
    ]),
  },
  AnalysisService: {
    listSchedules: vi.fn(async () => []),
    deleteSchedule: vi.fn(async () => {}),
  },
}));

vi.mock("../pages/console/AgentSkills", () => ({ default: () => null }));

import AgentLibrary from "../pages/console/AgentLibrary";
import { AgentService, AnalysisService, type ScheduleRow } from "@/db";

const create = vi.mocked(AgentService.createAgent);
const wrap = (n: React.ReactNode) => (
  <>
    <ThemeProvider attribute="class" defaultTheme="dark">
      <MemoryRouter>{n}</MemoryRouter>
    </ThemeProvider>
  </>
);
const openPopup = async () => {
  render(wrap(<AgentLibrary />));
  fireEvent.click(await screen.findByTestId("new-agent"));
};

describe("agent create popup validation", () => {
  it("names every missing field inline and does not create", async () => {
    await openPopup();
    fireEvent.click(screen.getByTestId("agent-create-submit"));

    expect(await screen.findByText("Give this agent a name.")).toBeInTheDocument();
    expect(screen.getByText("Pick a category before creating.")).toBeInTheDocument();
    expect(screen.getByLabelText("Agent name")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Agent category")).toHaveAttribute("aria-invalid", "true");
    expect(create).not.toHaveBeenCalled();
  });

  it("clears a field's error as soon as it is filled", async () => {
    await openPopup();
    fireEvent.change(screen.getByLabelText("Agent name"), { target: { value: "Test agent" } });
    fireEvent.click(screen.getByTestId("agent-create-submit"));
    expect(await screen.findByText("Pick a category before creating.")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Agent category"), { target: { value: "Research" } });
    expect(screen.queryByText("Pick a category before creating.")).not.toBeInTheDocument();
  });

  it("stops a scheduled run only after it is confirmed", async () => {
    vi.mocked(AnalysisService.listSchedules).mockResolvedValueOnce([
      { id: "sc1", agent_id: "a9", frequency: "daily", time: "09:00", timezone: "UTC", symbol: "ACME", share_name: "Acme" } as ScheduleRow,
    ]);
    render(wrap(<AgentLibrary />));

    fireEvent.click(await screen.findByRole("button", { name: /^stop$/i }));
    // Confirmation first — nothing is deleted until it is accepted.
    expect(screen.getByRole("button", { name: /stop schedule/i })).toBeTruthy();
    expect(AnalysisService.deleteSchedule).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /stop schedule/i }));
    await waitFor(() => expect(AnalysisService.deleteSchedule).toHaveBeenCalledWith("sc1"));
  });
});
