import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
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
    // menu closes after choosing
    expect(screen.queryByRole("menuitem", { name: /Reliance/ })).toBeNull();
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
});
