import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

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
    listAlertRules: vi.fn(async () => []),
    listAnalyses: vi.fn(async () => []),
  },
  AlertService: { listAlerts: vi.fn(async () => []), markRead: vi.fn(async () => {}), markAllRead: vi.fn(async () => {}) },
  PluginService: { list: vi.fn(async () => []) },
  runPluginLabel: (ids: string[] | null | undefined, plugins: { id: string; display_name: string }[], fallback?: string | null) =>
    ids?.length ? ids.map((i) => plugins?.find((p) => p.id === i)?.display_name ?? i).join(", ") : fallback || "",

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
  <>
    <MemoryRouter>{n}</MemoryRouter>
  </>
);

/** The panel: title switcher on the left, add / open-full / options on the right. */
const panel = () => within(screen.getByRole("region", { name: "Watchlist" }));
const press = (el: HTMLElement) => {
  // Radix menus open on pointerdown, not click.
  fireEvent.pointerDown(el, { button: 0 });
  fireEvent.click(el);
};
const openSwitcher = async () => {
  press(await screen.findByRole("button", { name: /switch watchlist/i }));
  return await screen.findByRole("menu");
};
const openOptions = async () => {
  press(await screen.findByRole("button", { name: /watchlist options/i }));
  return await screen.findByRole("menu");
};

describe("home watchlists", () => {
  it("keeps the watchlist as its own column beside the left rail", async () => {
    render(wrap(<HomePage />));
    const rail = screen.getByRole("heading", { name: "Latest runs" }).closest("section")!.parentElement!;
    expect(rail.className).toContain("flex-col");

    const watchlist = screen.getByRole("region", { name: "Watchlist" });
    expect(watchlist.parentElement).not.toBe(rail);
    expect(watchlist.parentElement!.parentElement).toBe(rail.parentElement);
    expect(rail.parentElement!.className).toContain("items-start");
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

  it("shows a spinner while lists load, then the default list behind the switcher", async () => {
    render(wrap(<HomePage />));
    expect(screen.getByRole("status", { name: /loading watchlists/i })).toBeTruthy();

    const switcher = await screen.findByRole("button", { name: /switch watchlist/i });
    expect(switcher.textContent).toContain("My Watchlist");
    expect(switcher.querySelector("svg")).toBeTruthy(); // chevron
    expect(screen.queryByRole("status", { name: /loading watchlists/i })).toBeNull();
  });

  it("creates and renames lists from the options menu", async () => {
    render(wrap(<HomePage />));
    await screen.findByRole("button", { name: /switch watchlist/i });

    fireEvent.click((await openOptions()).querySelector('[role="menuitem"]')!); // New watchlist
    fireEvent.change(screen.getByLabelText("Watchlist name"), { target: { value: "Tech" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    const switcher = await screen.findByRole("button", { name: /switch watchlist/i });
    expect(switcher.textContent).toContain("Tech");
    expect(WatchlistService.create).toHaveBeenCalledWith("Tech");

    const menu = await openOptions();
    fireEvent.click(within(menu as HTMLElement).getByRole("menuitem", { name: /rename/i }));
    fireEvent.change(screen.getByLabelText("Watchlist name"), { target: { value: "Equities" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect((await screen.findByRole("button", { name: /switch watchlist/i })).textContent).toContain("Equities");
    expect(WatchlistService.update).toHaveBeenCalledWith(expect.any(String), { name: "Equities" });
  });

  it("persists added stocks to the DB and counts them in the switcher", async () => {
    render(wrap(<HomePage />));
    await screen.findByRole("button", { name: /switch watchlist/i });

    fireEvent.click(screen.getByRole("button", { name: /add stock/i }));
    fireEvent.change(screen.getByLabelText("Search stocks to add"), { target: { value: "app" } });
    fireEvent.click(await screen.findByRole("option", { name: /AAPL/i }));

    expect(await panel().findByRole("rowheader", { name: /AAPL/ })).toBeTruthy();
    const menu = await openSwitcher();
    expect(within(menu as HTMLElement).getByRole("menuitem", { name: /my watchlist/i })).toHaveTextContent("1");
    expect(WatchlistService.update).toHaveBeenCalledWith(
      expect.any(String),
      { items: [{ symbol: "AAPL", source: "SEC", name: "Apple Inc." }] },
    );
  });

  it("confirms through the app's dialog before deleting a watchlist", async () => {
    render(wrap(<HomePage />));
    await screen.findByRole("button", { name: /switch watchlist/i });

    const first = await openOptions();
    fireEvent.click(within(first as HTMLElement).getByRole("menuitem", { name: /delete/i }));
    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(screen.getByText(/will be permanently removed/i)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: /switch watchlist/i })).toBeTruthy();
    expect(WatchlistService.delete).not.toHaveBeenCalled();

    const second = await openOptions();
    fireEvent.click(within(second as HTMLElement).getByRole("menuitem", { name: /delete/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    await waitFor(() => expect(WatchlistService.delete).toHaveBeenCalled());
    await waitFor(() =>
      expect((screen.getByRole("button", { name: /switch watchlist/i })).textContent).toContain("Watchlist"),
    );
  });

  it("imports the old localStorage watchlist into SQLite on first load", async () => {
    localStorage.setItem("relativity.watchlist", JSON.stringify(["AAPL", "NIFTY"]));
    render(wrap(<HomePage />));

    const menu = await openSwitcher();
    expect(within(menu as HTMLElement).getByRole("menuitem", { name: /my watchlist/i })).toHaveTextContent("2");
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

    const menu = await openSwitcher();
    expect(within(menu as HTMLElement).getByRole("menuitem", { name: /my watchlist/i })).toHaveTextContent("1");
    expect(WatchlistService.update).toHaveBeenCalledWith("w0", { items: [{ symbol: "TSLA" }] });
  });

  it("removes the duplicate empty default lists created by the old bootstrap", async () => {
    state.lists = [
      { id: "w1", user_id: "u1", name: "My Watchlist", items: [], created_at: "2026-01-01", updated_at: "2026-01-01" },
      { id: "w2", user_id: "u1", name: "My Watchlist", items: [], created_at: "2026-01-01", updated_at: "2026-01-01" },
    ];
    render(wrap(<HomePage />));

    const menu = await openSwitcher();
    expect(within(menu as HTMLElement).getAllByRole("menuitem", { name: /my watchlist/i })).toHaveLength(1);
    expect(WatchlistService.delete).toHaveBeenCalledWith("w2");
  });

  it("shows an error when the lists cannot be loaded instead of looking empty", async () => {
    vi.mocked(WatchlistService.list).mockRejectedValueOnce(new Error("offline"));
    render(wrap(<HomePage />));

    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn't load your watchlists/i);
    expect(WatchlistService.create).not.toHaveBeenCalled();
  });

  it("renders the TradingView-style table: chart, prices, verdict badges", async () => {
    state.lists = [{
      id: "w1", user_id: "u1", name: "My Watchlist",
      items: [{ symbol: "AAPL", source: "SEC" }, { symbol: "MSFT", source: "SEC" }],
      created_at: "2026-01-01", updated_at: "2026-01-01",
    }];
    vi.mocked(AnalysisService.listAnalyses).mockResolvedValueOnce([
      { id: "r1", symbol: "AAPL", source: "SEC", share_name: "Apple Inc.", agent_name: "Chartist Analyst", verdict: "Strong", created_at: "2026-01-01T10:00:00Z" },
      { id: "r2", symbol: "AAPL", source: "SEC", share_name: "Apple Inc.", agent_name: "Risk Agent", verdict: "Fair", created_at: "2026-01-01T09:00:00Z" },
      { id: "r3", symbol: "MSFT", source: "SEC", share_name: "Microsoft", agent_name: "Chartist Analyst", verdict: "Sell", created_at: "2026-01-01T08:00:00Z" },
    ] as any);
    render(wrap(<HomePage />));

    const table = await panel().findByRole("table");
    expect(table.parentElement!.className).toContain("overflow-x-auto");
    for (const col of ["Symbol", "Chart", "Last", "Chg", "Chg%"]) {
      expect(panel().getByRole("columnheader", { name: col })).toBeTruthy();
    }
    // One column per agent that ran on this list's symbols — only those.
    expect(panel().getByRole("columnheader", { name: /chartist analyst/i })).toBeTruthy();
    expect(panel().getByRole("columnheader", { name: /risk agent/i })).toBeTruthy();
    // Exactly those two — no extra plugin columns.
    expect(panel().getAllByRole("columnheader")).toHaveLength(7);

    // AAPL carries both agent badges, MSFT only its own (Risk = dash).
    const appleRow = panel().getByRole("rowheader", { name: /AAPL/ }).closest("tr")!;
    expect(appleRow.textContent).toContain("Strong");
    expect(appleRow.textContent).toContain("Fair");
    expect(appleRow.querySelector('[aria-label="Remove AAPL from watchlist"]')).toBeTruthy();

    const msftRow = panel().getByRole("rowheader", { name: /MSFT/ }).closest("tr")!;
    expect(msftRow.textContent).toContain("Sell");
    expect(msftRow.textContent).toContain("—");

    // Columns sort on click.
    const lastHeader = panel().getByRole("columnheader", { name: "Last" });
    expect(lastHeader.getAttribute("aria-sort")).toBe("none");
    fireEvent.click(within(lastHeader).getByRole("button", { name: /last/i }));
    expect(panel().getByRole("columnheader", { name: "Last" }).getAttribute("aria-sort")).toBe("descending");

    // Agent columns sort by verdict band — first click = strongest first.
    const agentHeader = panel().getByRole("columnheader", { name: /chartist analyst/i });
    expect(agentHeader.getAttribute("aria-sort")).toBe("none");
    fireEvent.click(within(agentHeader).getByRole("button", { name: /chartist/i }));
    expect(panel().getByRole("columnheader", { name: /chartist analyst/i }).getAttribute("aria-sort")).toBe("descending");
    expect(panel().getAllByRole("rowheader")[0].textContent).toContain("AAPL"); // Strong over Sell
    fireEvent.click(within(panel().getByRole("columnheader", { name: /chartist analyst/i })).getByRole("button", { name: /chartist/i }));
    expect(panel().getAllByRole("rowheader")[0].textContent).toContain("MSFT"); // flipped: Sell first
  });

  it("puts the switcher left and add / open-full / options right", async () => {
    render(wrap(<HomePage />));
    const region = await screen.findByRole("region", { name: "Watchlist" });
    const header = region.firstElementChild as HTMLElement;

    expect(within(header).getByRole("button", { name: /switch watchlist/i })).toBeTruthy();
    expect(within(header).getByRole("button", { name: /add stock/i })).toBeTruthy();
    expect(within(header).getByRole("button", { name: /watchlist options/i })).toBeTruthy();

    const full = within(header).getByRole("link", { name: /open full watchlist/i });
    expect(full.getAttribute("href")).toBe("/watchlists");
    expect(full.getAttribute("target")).toBe("_blank");
  });
});
