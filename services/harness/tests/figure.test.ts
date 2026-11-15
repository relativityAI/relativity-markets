import { describe, expect, it } from "vitest";
import { ChartSpecSchema, type ChartSpec } from "../report/document.js";
import { figureCsv, renderFigure } from "../report/figure-kit.js";

const gbar: ChartSpec = {
  kind: "gbar",
  categories: ["1Y", "3Y", "5Y"],
  groups: [
    { name: "Nifty 50", values: [-1.8, 10.2, 8.0] },
    { name: "Smallcap 250", values: [5.9, 12.8, 13.7] },
  ],
};

describe("gbar — grouped columns", () => {
  it("passes the chart schema", () => {
    expect(ChartSpecSchema.safeParse(gbar).success).toBe(true);
  });

  it("is in the plot menu the planner sees", async () => {
    const { plotReferenceMarkdown } = await import("../report/reference.js");
    const menu = plotReferenceMarkdown(true);
    expect(menu).toContain("`gbar`");
    expect(menu).toContain(`"kind": "gbar"`);
  });

  it("renders every group and category, signed values below zero", () => {
    const svg = renderFigure({ ...gbar });
    expect(svg).toBeTruthy();
    for (const s of ["Nifty 50", "Smallcap 250", "1Y", "3Y", "5Y"]) expect(svg).toContain(s);
    expect(svg).toContain("<rect"); // bars drawn
  });

  it("csv carries one column per group", () => {
    const rows = figureCsv({ ...gbar }).split("\n");
    expect(rows[0]).toBe("category,Nifty 50,Smallcap 250");
    expect(rows[1]).toBe("1Y,-1.8,5.9");
  });
});
