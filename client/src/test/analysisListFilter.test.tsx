import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, within, act } from "@testing-library/react";
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
const toastCreate = vi.hoisted(() => vi.fn());

vi.mock("@/components/ui/toaster", () => ({
  toaster: { create: (input: unknown) => toastCreate(input) },
}));
vi.mock("@/db", () => ({
  API_BASE: "/api",
  AnalysisService: {
    listAnalyses: vi.fn(async () => state.runs),
    deleteAnalysis: vi.fn(async () => {}),
  },
  PluginService: { list: vi.fn(async () => []) },
  SkillService: { listSkills: vi.fn(async () => []) },
  runPluginLabel: (ids: string[] | null | undefined, plugins: { id: string; display_name: string }[], fallback?: string | null) =>
    ids?.length ? ids.map((i) => plugins?.find((p) => p.id === i)?.display_name ?? i).join(", ") : fallback || "",
}));
vi.mock("@/lib/systemPrompts", () => ({
  listSystemPrompts: vi.fn(async () => []),
}));

import AnalysisList from "@/pages/AnalysisList";
import { AnalysisService } from "@/db";

const renderList = (entry: string) => render(
  <>
    <MemoryRouter initialEntries={[entry]}>
      <Routes><Route path="/analysis-list" element={<AnalysisList />} /></Routes>
    </MemoryRouter>
  </>
);

describe("analysis list stock deep link", () => {
  beforeEach(() => {
    toastCreate.mockClear();
    vi.mocked(AnalysisService.deleteAnalysis).mockClear();
    state.runs = [
      { id: "r1", symbol: "EXIDEIND", share_name: "Exide Industries Limited", agent_name: "chartist", verdict: "Good", created_at: "2026-11-17T09:00:00Z", total_score: 80, status: "completed" },
      { id: "r2", symbol: "OTHER", share_name: "Other Corp", agent_name: "chartist", verdict: "Good", created_at: "2026-11-16T09:00:00Z", total_score: 70, status: "completed" },
    ];
  });

  afterEach(() => vi.useRealTimers());

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

  it("defers the delete 30s with an Undo that restores the row (deleteAnalysis not called yet)", async () => {
    renderList("/analysis-list");
    const link = await screen.findByRole("link", { name: "Exide Industries Limited" });
    fireEvent.pointerDown(within(link.closest("tr")!).getByRole("button", { name: "Run actions" }), { button: 0 });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Delete" }));
    await screen.findByRole("dialog");

    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: "Delete" })); // confirm

    // Optimistically removed; the request is still deferred.
    expect(screen.getByText("1 runs")).toBeTruthy();
    expect(vi.mocked(AnalysisService.deleteAnalysis)).not.toHaveBeenCalled();
    expect(toastCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Run deleted",
        duration: 30000,
        type: "info",
        action: expect.objectContaining({ label: "Undo" }),
      })
    );

    // Undo cancels the timer and refetches — row back, delete never sent.
    const toast = toastCreate.mock.calls.at(-1)![0] as { action: { onClick: () => void } };
    await act(async () => {
      toast.action.onClick();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getAllByText("2 runs").length).toBeGreaterThan(0);
    expect(vi.mocked(AnalysisService.deleteAnalysis)).not.toHaveBeenCalled();

    // The cancelled timer must not fire later either.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(vi.mocked(AnalysisService.deleteAnalysis)).not.toHaveBeenCalled();

    // A second confirm defers again — the request fires when the timer elapses.
    const link2 = screen.getByRole("link", { name: "Exide Industries Limited" });
    fireEvent.pointerDown(within(link2.closest("tr")!).getByRole("button", { name: "Run actions" }), { button: 0 });
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" }));
    expect(screen.queryByText("2 runs")).toBeNull();
    expect(vi.mocked(AnalysisService.deleteAnalysis)).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(vi.mocked(AnalysisService.deleteAnalysis)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(AnalysisService.deleteAnalysis)).toHaveBeenCalledWith("r1");
  });
});
