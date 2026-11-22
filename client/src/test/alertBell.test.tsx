import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const listAlerts = vi.fn();
const markRead = vi.fn();
const markAllRead = vi.fn();

vi.mock("@/db", () => ({
  API_BASE: "/api",
  AlertService: {
    listAlerts: (...a: unknown[]) => listAlerts(...a),
    markRead: (...a: unknown[]) => markRead(...a),
    markAllRead: (...a: unknown[]) => markAllRead(...a),
  },
}));

import AlertBell from "@/components/AlertBell";

const ALERTS = [
  { id: "al1", rule_id: "r1", run_id: "run1", symbol: "RELIANCE", share_name: "Reliance", agent_name: "Observer", verdict: "Accumulate", created_at: new Date().toISOString(), read_at: null },
  { id: "al2", rule_id: "r2", run_id: "run2", symbol: "INFY", share_name: "Infosys", agent_name: "Observer", verdict: "Hold", created_at: new Date().toISOString(), read_at: "2026-11-19T00:00:00.000Z" },
];

const wrap = (n: React.ReactNode) => <MemoryRouter>{n}</MemoryRouter>;

describe("AlertBell", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listAlerts.mockResolvedValue(ALERTS);
    markRead.mockResolvedValue({});
    markAllRead.mockResolvedValue({});
  });

  it("shows the unread count on the bell", async () => {
    render(wrap(<AlertBell />));
    const bell = await screen.findByRole("button", { name: /alerts, 1 unread/i });
    expect(bell).toBeTruthy();
    // badge carries the number
    expect(bell.textContent).toContain("1");
  });

  it("lists alerts on open, and marks one read on click", async () => {
    render(wrap(<AlertBell />));
    const bell = await screen.findByRole("button", { name: /alerts, 1 unread/i });
    fireEvent.click(bell);

    const row = await screen.findByRole("menuitem", { name: /Reliance/ });
    expect(row.textContent).toContain("Accumulate");
    expect(screen.getByRole("menuitem", { name: /Infosys/ }).textContent).toContain("Hold");

    fireEvent.click(screen.getByRole("menuitem", { name: /Reliance/ }));
    await waitFor(() => expect(markRead).toHaveBeenCalledWith("al1"));
    // menu closes after choosing — it fades out first, so wait for the unmount
    await waitFor(() => expect(screen.queryByRole("menuitem", { name: /Reliance/ })).toBeNull());
  });

  it("mark all read clears every unread flag", async () => {
    render(wrap(<AlertBell />));
    const bell = await screen.findByRole("button", { name: /alerts, 1 unread/i });
    fireEvent.click(bell);

    fireEvent.click(await screen.findByRole("button", { name: /mark all read/i }));
    await waitFor(() => expect(markAllRead).toHaveBeenCalledTimes(1));
    // badge gone
    expect(screen.queryByRole("button", { name: /alerts, 1 unread/i })).toBeNull();
  });

  it("renders an empty state instead of a broken list", async () => {
    listAlerts.mockResolvedValue([]);
    render(wrap(<AlertBell />));
    const bell = await screen.findByRole("button", { name: "Alerts" });
    fireEvent.click(bell);
    expect(await screen.findByText(/No alerts yet/)).toBeTruthy();
  });

  it("gives every verdict a tinted badge — a dead run reads red", async () => {
    listAlerts.mockResolvedValue([
      { id: "al3", rule_id: "", run_id: "run3", symbol: "NVDA", share_name: "NVIDIA", agent_name: "Chartist", verdict: "Failed", created_at: new Date().toISOString(), read_at: null },
      { id: "al4", rule_id: "r4", run_id: "run4", symbol: "INFY", share_name: "Infosys", agent_name: "Observer", verdict: "Hold", created_at: new Date().toISOString(), read_at: null },
    ]);
    render(wrap(<AlertBell />));
    fireEvent.click(await screen.findByRole("button", { name: /alerts, 2 unread/i }));

    const failed = await screen.findByText("Failed");
    expect(failed.style.color).toContain("signal-negative");
    expect(failed.style.background).toContain("signal-negative");
    // neutral word still gets a badge, just without a signal colour
    const hold = screen.getByText("Hold");
    expect(hold.style.color).toContain("signal-caution");
  });

  it("keeps the list for a couple of seconds after the pointer leaves", async () => {
    vi.useFakeTimers();
    try {
      render(wrap(<AlertBell />));
      await act(async () => {}); // flush the alerts fetch
      const bell = screen.getByRole("button", { name: /alerts/i });
      fireEvent.click(bell);
      expect(screen.getByRole("menu")).toBeTruthy();

      fireEvent.mouseOut(bell, { relatedTarget: document.body });
      act(() => vi.advanceTimersByTime(1500));
      expect(screen.getByRole("menu")).toBeTruthy(); // still lingering

      act(() => vi.advanceTimersByTime(1500)); // linger elapses + the fade
      expect(screen.queryByRole("menu")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
