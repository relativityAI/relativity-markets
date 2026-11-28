/**
 * Taxonomy loader + smart search ranking — the "understands what I'm asking
 * for" contract: general terms lead with groups, tickers lead with stocks,
 * typos still find stocks, aliases expand.
 */
import { describe, it, expect } from "vitest";
import { searchEntities, listSectors, listLevel, getGroup } from "../taxonomy.js";

const names = (q: string) => searchEntities(q).map((h) => `${h.type}:${h.symbol ?? h.key}`);
const topType = (q: string) => searchEntities(q)[0]?.type;

describe("listSectors", () => {
  it("loads both markets with counts", () => {
    const all = listSectors();
    expect(all.filter((s) => s.market === "NSE").length).toBeGreaterThan(5);
    expect(all.filter((s) => s.market === "SEC").length).toBeGreaterThan(5);
    expect(all[0].count).toBeGreaterThan(0);
  });

  it("resolves a group key with constituents", () => {
    const g = getGroup("US:SECTOR:technology");
    expect(g).toBeTruthy();
    expect(g!.constituents.length).toBe(g!.count);
    expect(g!.constituents[0].source).toBe("SEC");
    expect(getGroup("NOPE")).toBeNull();
  });

  it("lists any level for a market (level browsing)", () => {
    const basics = listLevel("NSE", "basic_industry");
    expect(basics.length).toBeGreaterThan(20);
    expect(basics[0].level).toBe("basic_industry");
    expect(basics[0].children).toBe(0);
    const subs = listLevel("SEC", "sub_industry");
    expect(subs.length).toBeGreaterThan(20);
    expect(subs[0].market).toBe("SEC");
  });
});

describe("searchEntities ranking", () => {
  it("a general term leads with groups ('auto' → Automobiles…)", () => {
    const hits = searchEntities("auto");
    expect(hits[0].type).toBe("group");
    expect(hits[0].name.toLowerCase()).toMatch(/^auto/);
  });

  it("an exact ticker leads with the stock", () => {
    const hits = searchEntities("TCS");
    expect(hits[0].type).toBe("stock");
    expect(hits[0].symbol).toBe("TCS");
  });

  it("'bank' surfaces the Banks groups, multi-word favors company names", () => {
    expect(topType("bank")).toBe("group");
    const multi = searchEntities("state bank");
    expect(multi.some((h) => h.type === "stock" && /state bank/i.test(h.name))).toBe(true);
  });

  it("multi-word intent lands on the right industry ('pharma retailers')", () => {
    const sec = searchEntities("pharma retailers").filter((h) => h.source === "SEC");
    expect(sec.length).toBeGreaterThan(0);
    expect(sec[0].type).toBe("group");
    expect(sec[0].name).toMatch(/Drug Stores|Pharmacy Retail/i);
    expect(searchEntities("fmcg")[0].name).toMatch(/Consumer Goods/i);
  });

  it("aliases expand (fmcg → Fast Moving Consumer Goods)", () => {
    const hits = searchEntities("fmcg");
    expect(hits[0].type).toBe("group");
    expect(hits[0].name).toMatch(/Consumer Goods/i);
  });

  it("a typo still finds the stock ('aaple' → Apple)", () => {
    const hits = searchEntities("aaple");
    expect(hits.some((h) => h.type === "stock" && h.symbol === "AAPL")).toBe(true);
  });

  it("group rows carry level + constituent count", () => {
    const g = searchEntities("pharmaceuticals").find((h) => h.type === "group");
    expect(g).toBeTruthy();
    expect(g!.level).toBeTruthy();
    expect(g!.count!).toBeGreaterThan(0);
  });
});
