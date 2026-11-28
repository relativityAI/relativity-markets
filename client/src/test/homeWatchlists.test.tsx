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
    listOccurrences: vi.fn(async () => []),
    runAnalysis: vi.fn(async () => ({ id: "r9", status: "RUNNING" })),
    createAlertRule: vi.fn(async (c: Record<string, unknown>) => ({ id: "ar1", enabled: 1, ...c })),
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
import { badgeAge, badgeFill, badgeIcons } from "@/lib/analysisFormat";
import { AnalysisService, PluginService, WatchlistService } from "@/db";
import { FaceNeutral, ThumbsDown, ThumbsUp } from "lucide-react";

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

describe("home watchlists", () => {
  it("keeps the watchlist as its own column beside the left rail", async () => {
    render(wrap(<HomePage />));
    const rail = screen.getByLabelText("Heatmap index").closest("section")!.parentElement!;
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
    localStorage.removeItem("relativity.watchlist.active");
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

  it("creates a list from the switcher and renames it with the pencil icon", async () => {
    render(wrap(<HomePage />));
    await screen.findByRole("button", { name: /switch watchlist/i });

    const menu = await openSwitcher();
    fireEvent.click(within(menu as HTMLElement).getByRole("menuitem", { name: /new watchlist/i }));
    fireEvent.change(screen.getByLabelText("Watchlist name"), { target: { value: "Tech" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    const switcher = await screen.findByRole("button", { name: /switch watchlist/i });
    expect(switcher.textContent).toContain("Tech");
    expect(WatchlistService.create).toHaveBeenCalledWith("Tech");

    fireEvent.click(await screen.findByRole("button", { name: /rename watchlist/i }));
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

  it("picks a search result with the keyboard (arrows + Enter)", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (String(url).includes("/stocks/search")) {
        return { ok: true, json: async () => [
          { ticker: "AAPL", name: "Apple Inc.", source: "SEC" },
          { ticker: "MSFT", name: "Microsoft Corp.", source: "SEC" },
        ] };
      }
      return { ok: false, status: 503, json: async () => ({}) };
    }));
    render(wrap(<HomePage />));
    await screen.findByRole("button", { name: /switch watchlist/i });

    fireEvent.click(screen.getByRole("button", { name: /add stock/i }));
    const input = screen.getByLabelText("Search stocks to add");
    fireEvent.change(input, { target: { value: "app" } });

    const first = await screen.findByRole("option", { name: /Apple/i });
    expect(first.getAttribute("aria-selected")).toBe("true"); // cursor starts on row 1

    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(screen.getByRole("option", { name: /Microsoft/i }).getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(screen.getByRole("option", { name: /Apple/i }).getAttribute("aria-selected")).toBe("true");

    fireEvent.keyDown(input, { key: "Enter" });
    expect(await panel().findByRole("rowheader", { name: /AAPL/ })).toBeTruthy();
    // Enter added it without a single click; the picker closed behind it.
    expect(screen.queryByLabelText("Search stocks to add")).toBeNull();
  });

  it("nudges a fresh, empty list toward the + and stops once a stock lands", async () => {
    render(wrap(<HomePage />));
    await screen.findByRole("button", { name: /switch watchlist/i });

    expect(await screen.findByText("add stocks to watchlist")).toBeTruthy();
    expect(screen.getByRole("button", { name: /rename watchlist/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /export watchlist as csv/i })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /add stock/i }));
    fireEvent.change(screen.getByLabelText("Search stocks to add"), { target: { value: "app" } });
    fireEvent.click(await screen.findByRole("option", { name: /AAPL/i }));

    await screen.findByRole("rowheader", { name: /AAPL/ });
    expect(screen.queryByText("add stocks to watchlist")).toBeNull();
  });

  it("confirms through the app's dialog before deleting a watchlist", async () => {
    render(wrap(<HomePage />));
    await screen.findByRole("button", { name: /switch watchlist/i });

    fireEvent.click(await screen.findByRole("button", { name: /delete watchlist/i }));
    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(screen.getByText(/will be permanently removed/i)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: /switch watchlist/i })).toBeTruthy();
    expect(WatchlistService.delete).not.toHaveBeenCalled();

    fireEvent.click(await screen.findByRole("button", { name: /delete watchlist/i }));
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
    // Two consumers of listAnalyses: the home rail and the week calendar —
    // queue the runs twice so neither call drains the other's fixture.
    const fixture = [
      { id: "r1", symbol: "AAPL", source: "SEC", share_name: "Apple Inc.", agent_name: "Chartist Analyst", verdict: "Strong", duration: 125, created_at: "2026-01-01T10:00:00Z" },
      { id: "r2", symbol: "AAPL", source: "SEC", share_name: "Apple Inc.", agent_name: "Risk Agent", verdict: "Fair", created_at: "2026-01-01T09:00:00Z" },
      { id: "r3", symbol: "MSFT", source: "SEC", share_name: "Microsoft", agent_name: "Chartist Analyst", verdict: "Sell", created_at: "2026-01-01T08:00:00Z" },
    ] as any;
    vi.mocked(AnalysisService.listAnalyses).mockResolvedValueOnce(fixture).mockResolvedValueOnce(fixture);
    render(wrap(<HomePage />));

    const table = await panel().findByRole("table");
    expect(table.parentElement!.className).toContain("overflow-x-auto");
    for (const col of ["Symbol", "Chart", "Last", "Chg%"]) {
      expect(panel().getByRole("columnheader", { name: col })).toBeTruthy();
    }
    // One column per agent that ran on this list's symbols — only those.
    expect(panel().getByRole("columnheader", { name: /chartist analyst/i })).toBeTruthy();
    expect(panel().getByRole("columnheader", { name: /risk agent/i })).toBeTruthy();
    // Exactly those — no extra plugin columns (Chg is gone, Chg% stays).
    expect(panel().getAllByRole("columnheader")).toHaveLength(6);

    // AAPL carries both agent badges, MSFT only its own (Risk = dash).
    const appleRow = panel().getByRole("rowheader", { name: /AAPL/ }).closest("tr")!;
    expect(appleRow.textContent).toContain("Strong");
    expect(appleRow.textContent).toContain("Fair");
    // The badge carries the last run's wall time in light text.
    expect(appleRow.textContent).toContain("2m 5s");
    expect(appleRow.querySelector('[aria-label="Remove AAPL from watchlist"]')).toBeTruthy();

    const msftRow = panel().getByRole("rowheader", { name: /MSFT/ }).closest("tr")!;
    expect(msftRow.textContent).toContain("Sell");
    expect(msftRow.textContent).toContain("—");

    // Badges use the docs' custom-colour recipes: pale tint + tinted ink in
    // light, deep tint + light ink in dark (amber for mid, red for bad).
    const badgeClass = (row: HTMLElement, word: string) =>
      [...row.querySelectorAll("a.rounded-full, span.rounded-full")].find((s) => s.textContent?.startsWith(word))?.getAttribute("class") || "";
    expect(badgeClass(appleRow, "Fair")).toContain("bg-amber-50");
    expect(badgeClass(appleRow, "Fair")).toContain("dark:bg-amber-950");
    expect(badgeClass(msftRow, "Sell")).toContain("bg-red-50");
    expect(badgeClass(msftRow, "Sell")).toContain("dark:bg-red-950");
    // Every badge carries its band's lucide glyph (currentColor).
    expect(appleRow.querySelector("a.rounded-full svg")).toBeTruthy();

    // Badge → that agent's last run; ticker + logos → the stock page.
    expect(appleRow.querySelector("a.rounded-full")?.getAttribute("href")).toBe("/runs/r1");
    expect(within(appleRow).getByRole("link", { name: /AAPL/ }).getAttribute("href")).toBe("/stock/AAPL?source=SEC");

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

  it("keeps the selected watchlist across remounts (like the heatmap's market)", async () => {
    state.lists = [
      { id: "w1", user_id: "u1", name: "My Watchlist", items: [], created_at: "2026-01-01", updated_at: "2026-01-01" },
      { id: "w2", user_id: "u1", name: "Tech", items: [], created_at: "2026-01-01", updated_at: "2026-01-01" },
    ];
    const { unmount } = render(wrap(<HomePage />));
    const menu = await openSwitcher();
    fireEvent.click(within(menu as HTMLElement).getByRole("menuitem", { name: /tech/i }));
    await waitFor(() => expect(localStorage.getItem("relativity.watchlist.active")).toBe("w2"));
    unmount();

    render(wrap(<HomePage />));
    expect((await screen.findByRole("button", { name: /switch watchlist/i })).textContent).toContain("Tech");
  });

  it("maps verdicts to badge glyphs: double thumbs, single thumbs, neutral face", () => {
    // Great (better than good) → two thumbs up; very bad → two thumbs down.
    expect(badgeIcons("Excellent")).toHaveLength(2);
    expect(badgeIcons("Outstanding")).toHaveLength(2);
    expect(badgeIcons("Very Poor")).toHaveLength(2);
    // Average/fair → the neutral face; plain good/bad → one thumb.
    expect(badgeIcons("Fair")).toEqual([FaceNeutral]);
    expect(badgeIcons("Strong")).toEqual([ThumbsUp]);
    expect(badgeIcons("Poor")).toEqual([ThumbsDown]);
    expect(badgeIcons(null)).toEqual([FaceNeutral]);
  });

  it("fills badges by severity: green shades, yellow average, red shades", () => {
    expect(badgeFill("Excellent")).toBe("#22C55E"); // great — deeper green
    expect(badgeFill("Strong")).toBe("#4ADE80"); // good — lighter green
    expect(badgeFill("Fair")).toBe("#FACC15"); // average — yellow
    expect(badgeFill("Poor")).toBe("#F87171"); // bad — lighter red
    expect(badgeFill("Very Poor")).toBe("#EF4444"); // very bad — deeper red
    expect(badgeFill(null)).toBe("#9CA3AF"); // unclassified — gray
  });

  it("compacts badge age into now / m / h / d / w, then a short date", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-15T12:00:00Z"));
    const at = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
    expect(badgeAge(at(0))).toBe("now");
    expect(badgeAge(at(5))).toBe("5m");
    expect(badgeAge(at(60 * 3))).toBe("3h");
    expect(badgeAge(at(60 * 24 * 2))).toBe("2d");
    expect(badgeAge(at(60 * 24 * 7 * 3))).toBe("3w");
    expect(badgeAge(at(60 * 24 * 40))).toBe("May 6"); // past five weeks → date
    expect(badgeAge(null)).toBe("");
    vi.useRealTimers();
  });

  it("puts the verdict's age on the badge and runs / schedules the agent from its cell", async () => {
    state.lists = [{
      id: "w1", user_id: "u1", name: "My Watchlist",
      items: [{ symbol: "AAPL", source: "SEC" }],
      created_at: "2026-01-01", updated_at: "2026-01-01",
    }];
    const createdAt = "2026-01-01T10:00:00Z";
    vi.mocked(AnalysisService.listAnalyses).mockResolvedValue([
      { id: "r1", symbol: "AAPL", source: "SEC", share_name: "Apple Inc.", plugin_ids: ["p1"], verdict: "Strong", created_at: createdAt },
    ] as never[]);
    vi.mocked(PluginService.list).mockResolvedValue([{ id: "p1", display_name: "Chartist Analyst" }] as never[]);
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    render(wrap(<HomePage />));

    // The age reads straight off the badge — no hover needed.
    const badge = await screen.findByRole("link", { name: /Strong/ });
    expect(badge.textContent).toContain(badgeAge(createdAt));
    expect(badge.querySelector(".sr-only")).toBeTruthy(); // hover detail kept for SRs

    // ↻ relaunches that agent on that symbol, then opens the new run.
    fireEvent.click(await screen.findByRole("button", { name: /run AAPL with Chartist Analyst again/i }));
    await waitFor(() => expect(AnalysisService.runAnalysis).toHaveBeenCalledWith(
      expect.objectContaining({ symbol: "AAPL", source: "SEC", plugin_ids: ["p1"] }),
    ));
    await waitFor(() => expect(openSpy).toHaveBeenCalledWith("/runs/r9", "_blank", "noreferrer"));

    // 📅 opens the cadence menu; picking Daily creates the 9:00 rule…
    press(await screen.findByRole("button", { name: /schedule AAPL with Chartist Analyst/i }));
    const menu = await screen.findByRole("menu");
    fireEvent.click(within(menu).getByRole("menuitem", { name: /daily/i }));
    await waitFor(() => expect(AnalysisService.createAlertRule).toHaveBeenCalledWith(
      expect.objectContaining({ symbol: "AAPL", frequency: "daily", time: "09:00", plugin_ids: ["p1"] }),
    ));
    // …and the cell flips to its scheduled state.
    expect(await screen.findByRole("button", { name: /schedule AAPL with Chartist Analyst — scheduled/i })).toBeTruthy();
    openSpy.mockRestore();
  });

  it("puts the switcher left and the add / open / export / rename / delete icons right", async () => {
    render(wrap(<HomePage />));
    const region = await screen.findByRole("region", { name: "Watchlist" });
    const header = region.firstElementChild as HTMLElement;

    expect(within(header).getByRole("button", { name: /switch watchlist/i })).toBeTruthy();
    expect(within(header).getByRole("button", { name: /add stock/i })).toBeTruthy();
    expect(within(header).getByRole("button", { name: /export watchlist as csv/i })).toBeTruthy();
    expect(within(header).getByRole("button", { name: /rename watchlist/i })).toBeTruthy();
    expect(within(header).getByRole("button", { name: /delete watchlist/i })).toBeTruthy();

    const full = within(header).getByRole("link", { name: /open full watchlist/i });
    expect(full.getAttribute("href")).toBe("/watchlists");
    expect(full.getAttribute("target")).toBe("_blank");
  });
});
