import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ChakraProvider, createSystem, defaultConfig } from "@chakra-ui/react";

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

// Shared in-memory "DB" behind the mocked WatchlistService.
const state = vi.hoisted(() => ({
  lists: [] as any[],
  nextId: 1,
}));

vi.mock("@/db", () => ({
  API_BASE: "/api",
  AnalysisService: {
    listSchedules: vi.fn(async () => []),
    listAnalyses: vi.fn(async () => []),
  },
  AgentService: { listAgents: vi.fn(async () => []) },
  WatchlistService: {
    list: vi.fn(async () => state.lists.map((l) => ({ ...l }))),
    create: vi.fn(async (name: string, items: any[] = []) => {
      const row = {
        id: `w${state.nextId++}`, user_id: "u1", name, items: [...items],
        created_at: "2026-01-01", updated_at: "2026-01-01",
      };
      state.lists.push(row);
      return row;
    }),
    update: vi.fn(async (id: string, patch: Record<string, unknown>) => {
      const row = state.lists.find((l) => l.id === id);
      Object.assign(row, patch);
      return { ...row };
    }),
    delete: vi.fn(async (id: string) => {
      state.lists = state.lists.filter((l) => l.id !== id);
    }),
  },
}));

import HomePage from "@/pages/HomePage";
import { AnalysisService, WatchlistService } from "@/db";

const wrap = (n: React.ReactNode) => (
  <ChakraProvider value={createSystem(defaultConfig)}>
    <MemoryRouter>{n}</MemoryRouter>
  </ChakraProvider>
);

describe("home watchlists", () => {
  it("stacks tagline, Active Agents and Latest runs in one rail beside the watchlist", async () => {
    render(wrap(<HomePage />));
    const tagline = screen.getByRole("heading", { level: 1 });
    const rail = tagline.parentElement!.parentElement!;

    // Every right-hand block lives in the same column…
    for (const name of ["Active Agents", "Latest runs"]) {
      const section = screen.getByRole("heading", { name }).closest("section")!;
      expect(section.parentElement).toBe(rail);
    }
    expect(rail.className).toContain("flex-col");

    // …and the watchlist is the sibling column of that two-column row.
    const watchlist = screen.getByRole("heading", { name: "Watchlist" }).closest("section")!;
    expect(watchlist.parentElement).not.toBe(rail);
    expect(watchlist.parentElement!.parentElement).toBe(rail.parentElement);
    expect(rail.parentElement!.className).toContain("items-start");
    expect(tagline.className).toContain("leading-none");
  });

  beforeEach(() => {
    state.lists = [];
    state.nextId = 1;
    localStorage.removeItem("relativity.watchlist");
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (String(url).includes("/stocks/search")) {
        return { ok: true, json: async () => [{ ticker: "AAPL", name: "Apple Inc.", source: "SEC" }] };
      }
      return { ok: false, status: 503, json: async () => ({}) };
    }));
  });

  it("shows a spinner while lists load, then the default list with its stock count", async () => {
    render(wrap(<HomePage />));
    expect(screen.getByRole("status", { name: /loading watchlists/i })).toBeTruthy();

    const tab = await screen.findByRole("tab", { name: /my watchlist \(0\)/i });
    expect(tab.getAttribute("aria-selected")).toBe("true");
    expect(tab.querySelector("svg")).toBeTruthy(); // lucide icon inside the tab
    expect(screen.queryByRole("status", { name: /loading watchlists/i })).toBeNull();
  });

  it("creates and renames lists inline, right where Add watchlist was clicked", async () => {
    render(wrap(<HomePage />));
    const add = await screen.findByRole("button", { name: /add watchlist/i });
    expect(add.textContent).toContain("Add watchlist");

    fireEvent.click(add);
    fireEvent.change(screen.getByLabelText("Watchlist name"), { target: { value: "Tech" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    const tech = await screen.findByRole("tab", { name: /tech \(0\)/i });
    expect(tech.getAttribute("aria-selected")).toBe("true");
    expect(WatchlistService.create).toHaveBeenCalledWith("Tech");

    fireEvent.click(screen.getByRole("button", { name: /rename watchlist/i }));
    fireEvent.change(screen.getByLabelText("Watchlist name"), { target: { value: "Equities" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("tab", { name: /equities \(0\)/i })).toBeTruthy();
    expect(WatchlistService.update).toHaveBeenCalledWith(expect.any(String), { name: "Equities" });
  });

  it("persists added stocks to the DB and updates the count next to the tab name", async () => {
    render(wrap(<HomePage />));
    await screen.findByRole("tab", { name: /my watchlist \(0\)/i });

    fireEvent.click(screen.getByRole("button", { name: /add your first stock/i }));
    fireEvent.change(screen.getByLabelText("Search stocks to add"), { target: { value: "app" } });
    fireEvent.click(await screen.findByRole("option", { name: /AAPL/i }));

    expect(await screen.findByText("Apple Inc.")).toBeTruthy();
    expect(await screen.findByRole("tab", { name: /my watchlist \(1\)/i })).toBeTruthy();
    expect(WatchlistService.update).toHaveBeenCalledWith(
      expect.any(String),
      { items: [{ symbol: "AAPL", source: "SEC", name: "Apple Inc." }] },
    );
  });

  it("confirms through the app's dialog before deleting a watchlist", async () => {
    render(wrap(<HomePage />));
    await screen.findByRole("tab", { name: /my watchlist/i });

    fireEvent.click(screen.getByRole("button", { name: /delete watchlist/i }));
    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(screen.getByText(/will be permanently removed/i)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("tab", { name: /my watchlist/i })).toBeTruthy();
    expect(WatchlistService.delete).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /delete watchlist/i }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(screen.queryByRole("tab", { name: /my watchlist/i })).toBeNull());
    expect(WatchlistService.delete).toHaveBeenCalled();
  });

  it("imports the old localStorage watchlist into SQLite on first load", async () => {
    localStorage.setItem("relativity.watchlist", JSON.stringify(["AAPL", "NIFTY"]));
    render(wrap(<HomePage />));

    expect(await screen.findByRole("tab", { name: /my watchlist \(2\)/i })).toBeTruthy();
    expect(WatchlistService.create).toHaveBeenCalledWith("My Watchlist", [
      { symbol: "AAPL" }, { symbol: "NIFTY" },
    ]);
    expect(localStorage.getItem("relativity.watchlist")).toBeNull();
  });

  it("restores legacy symbols into an existing empty list", async () => {
    state.lists = [{
      id: "w0", user_id: "u1", name: "My Watchlist", items: [],
      created_at: "2026-01-01", updated_at: "2026-01-01",
    }];
    localStorage.setItem("relativity.watchlist", JSON.stringify(["TSLA"]));
    render(wrap(<HomePage />));

    expect(await screen.findByRole("tab", { name: /my watchlist \(1\)/i })).toBeTruthy();
    expect(WatchlistService.update).toHaveBeenCalledWith("w0", { items: [{ symbol: "TSLA" }] });
  });

  it("removes the duplicate empty default lists created by the old bootstrap", async () => {
    state.lists = [
      { id: "w1", user_id: "u1", name: "My Watchlist", items: [], created_at: "2026-01-01", updated_at: "2026-01-01" },
      { id: "w2", user_id: "u1", name: "My Watchlist", items: [], created_at: "2026-01-01", updated_at: "2026-01-01" },
    ];
    render(wrap(<HomePage />));

    expect(await screen.findByRole("tab", { name: /my watchlist \(0\)/i })).toBeTruthy();
    expect(screen.getAllByRole("tab")).toHaveLength(1);
    expect(WatchlistService.delete).toHaveBeenCalledWith("w2");
  });

  it("shows an error when the lists cannot be loaded instead of looking empty", async () => {
    vi.mocked(WatchlistService.list).mockRejectedValueOnce(new Error("offline"));
    render(wrap(<HomePage />));

    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn't load your watchlists/i);
    expect(WatchlistService.create).not.toHaveBeenCalled();
  });

  it("toggles to a horizontally scrollable agent table with dashes for missing runs", async () => {
    state.lists = [{
      id: "w1", user_id: "u1", name: "My Watchlist",
      items: [{ symbol: "AAPL", source: "SEC" }, { symbol: "MSFT", source: "SEC" }],
      created_at: "2026-01-01", updated_at: "2026-01-01",
    }];
    vi.mocked(AnalysisService.listAnalyses).mockResolvedValueOnce([
      { id: "r1", symbol: "AAPL", source: "SEC", share_name: "Apple Inc.", agent_name: "Chartist Analyst", verdict: "Good", created_at: "2026-01-01T10:00:00Z" },
      { id: "r2", symbol: "AAPL", source: "SEC", share_name: "Apple Inc.", agent_name: "Risk Agent", verdict: "Fair", created_at: "2026-01-01T09:00:00Z" },
      { id: "r3", symbol: "MSFT", source: "SEC", share_name: "Microsoft", agent_name: "Chartist Analyst", verdict: "Poor", created_at: "2026-01-01T08:00:00Z" },
    ] as any);
    render(wrap(<HomePage />));
    await screen.findByRole("tab", { name: /my watchlist \(2\)/i });
    const section = within(screen.getByRole("heading", { name: "Watchlist" }).closest("section")!);

    // Cards are the default view.
    expect(section.getByText("Apple Inc.")).toBeTruthy();
    expect(section.queryByRole("table")).toBeNull();

    const tableToggle = section.getByRole("radio", { name: /table view/i });
    fireEvent.click(tableToggle);
    const table = await section.findByRole("table");
    expect(table.parentElement!.className).toContain("overflow-x-auto");

    // Stock + chart columns, then one column per agent across the whole list.
    expect(section.getByRole("columnheader", { name: "Stock" })).toBeTruthy();
    expect(section.getByRole("columnheader", { name: "Chart" })).toBeTruthy();
    expect(section.getByRole("columnheader", { name: /chartist analyst/i })).toBeTruthy();
    expect(section.getByRole("columnheader", { name: /risk agent/i })).toBeTruthy();

    // AAPL has both agents; MSFT has only Chartist — Risk is a dash.
    const appleRow = section.getByRole("rowheader", { name: /apple inc/i }).closest("tr")!;
    expect(appleRow.textContent).toContain("Good");
    expect(appleRow.textContent).toContain("Fair");
    const msftRow = section.getByRole("rowheader", { name: /microsoft/i }).closest("tr")!;
    expect(msftRow.textContent).toContain("Poor");
    expect(msftRow.textContent).toContain("-");

    fireEvent.click(section.getByRole("radio", { name: /card view/i }));
    await waitFor(() => expect(section.queryByRole("table")).toBeNull());
    expect(section.getByText("Apple Inc.")).toBeTruthy();
  });

  it("keeps the Watchlist title on its own line, tabs and actions on the next one", async () => {
    render(wrap(<HomePage />));
    const tab = await screen.findByRole("tab", { name: /my watchlist/i });
    const title = screen.getByRole("heading", { name: "Watchlist" });

    // Title is a line of its own; the row below holds tabs on the left…
    const stack = title.parentElement!;
    expect(stack.className).toContain("flex-col");
    const header = stack.children[1] as HTMLElement;
    expect(header).toBeTruthy();
    expect(header.contains(title)).toBe(false);
    expect(header.className).toContain("items-center");

    const left = header.children[0];
    expect(left.className).toContain("min-w-0");
    expect(left.className).toContain("flex-1");
    expect(left.contains(tab)).toBe(true);
    expect(left.querySelector('[aria-label="Add watchlist"]')).toBeTruthy();

    // …and the pinned right group, ordered toggle, edit, delete.
    const right = [...header.children].find((c) => c.querySelector('[aria-label="Watchlist view"]'))!;
    expect([...right.children].map((c) => c.getAttribute("aria-label"))).toEqual([
      "Watchlist view", "Rename watchlist", "Delete watchlist",
    ]);
  });
});
