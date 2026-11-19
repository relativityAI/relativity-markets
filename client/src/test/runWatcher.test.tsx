import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const state = vi.hoisted(() => ({ runs: [] as any[] }));
const toastCreate = vi.hoisted(() => vi.fn());

vi.mock("@/db", () => ({
  AnalysisService: { listAnalyses: vi.fn(async () => state.runs) },
}));
vi.mock("@/components/ui/toaster", () => ({
  toaster: { create: (input: unknown) => toastCreate(input) },
}));

import RunWatcher from "@/components/RunWatcher";

describe("run watcher", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    toastCreate.mockClear();
    // jsdom reports the page as hidden without pretendToBeVisual; the watcher
    // skips polling when hidden, so pin it to visible.
    Object.defineProperty(document, "hidden", { value: false, configurable: true });
    state.runs = [{ id: "r1", symbol: "NVDA", share_name: "NVIDIA Corporation", status: "running" }];
  });
  afterEach(() => vi.useRealTimers());

  const mount = () => render(<MemoryRouter><RunWatcher /></MemoryRouter>);
  const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(0); });
  const tick = () => act(async () => { await vi.advanceTimersByTimeAsync(10_000); });

  it("treats the first poll as baseline — no toast for runs already finished", async () => {
    state.runs = [{ id: "old", symbol: "EXIDE", share_name: "Exide", status: "completed" }];
    mount();
    await flush();
    expect(toastCreate).not.toHaveBeenCalled();
  });

  it("toasts once when a watched run reaches a terminal status, and not again after", async () => {
    mount();
    await flush();
    expect(toastCreate).not.toHaveBeenCalled();

    state.runs[0].status = "completed";
    await tick();
    expect(toastCreate).toHaveBeenCalledTimes(1);
    expect(toastCreate.mock.calls[0][0]).toMatchObject({
      type: "success",
      title: "NVIDIA Corporation — run finished",
    });

    await tick();
    expect(toastCreate).toHaveBeenCalledTimes(1);
  });

  it("reports failures as errors with a pointer to the cause", async () => {
    mount();
    await flush();

    state.runs[0].status = "error";
    await tick();
    expect(toastCreate).toHaveBeenCalledTimes(1);
    expect(toastCreate.mock.calls[0][0]).toMatchObject({
      type: "error",
      title: "NVIDIA Corporation — run failed",
    });
  });
});
