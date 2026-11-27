import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { legacySpec } from "../pdf.js";
import { figurePng } from "../pdfFigures.js";
import { PDF_FONTS, pdfFontVfs, resvgFontOptions } from "../pdfFonts.js";

const chart = (chartType: any, data: Record<string, string | number>[]) =>
  ({ type: "chart", chartType, data, sourceKeys: [] }) as any;

describe("legacy chart → figure-kit spec", () => {
  it("maps a single-key bar to vbar", () => {
    const s = legacySpec(chart("bar", [{ name: "Q1", value: 10 }, { name: "Q2", value: 20 }]))!;
    expect(s.kind).toBe("vbar");
    expect(s.categories).toEqual(["Q1", "Q2"]);
    expect(s.values).toEqual([10, 20]);
  });

  it("maps a multi-key bar to gbar with one group per key", () => {
    const s = legacySpec(chart("bar", [{ name: "Q1", up: 10, down: 4 }, { name: "Q2", up: 7, down: 9 }]))!;
    expect(s.kind).toBe("gbar");
    expect(s.groups?.map((g) => g.name)).toEqual(["up", "down"]);
    expect(s.groups?.[1].values).toEqual([4, 9]);
  });

  it("maps a dated line to epoch-seconds series", () => {
    const s = legacySpec(chart("line", [{ date: "2026-01-15", close: 100 }, { date: "2026-01-16", close: 110 }]))!;
    expect(s.kind).toBe("line");
    expect(s.series?.[0].label).toBe("close");
    expect(s.series?.[0].points.map((p) => p.t)).toEqual([
      Math.round(Date.parse("2026-01-15") / 1000),
      Math.round(Date.parse("2026-01-16") / 1000),
    ]);
    expect(s.series?.[0].points.map((p) => p.v)).toEqual([100, 110]);
  });

  it("falls back to hbar for a categorical x (pie/scatter/radar shapes)", () => {
    const s = legacySpec(chart("pie", [{ name: "Tech", value: 40 }, { name: "Banks", value: 60 }]))!;
    expect(s.kind).toBe("hbar");
    expect(s.values).toEqual([40, 60]);
  });

  it("returns null when there is nothing to plot", () => {
    expect(legacySpec(chart("bar", []))).toBeNull();
    expect(legacySpec(chart("bar", [{ name: "only-a-label" }]))).toBeNull();
  });
});

describe("print figures", () => {
  it("rasterizes a figure-kit spec to an opaque PNG", () => {
    const png = figurePng({ kind: "vbar", categories: ["A", "B"], values: [3, 5] }, { label: "test" });
    expect(png).toBeInstanceOf(Buffer);
    // PNG signature, then IHDR colour type at byte 25: 6 = RGBA — the
    // `background` option fills it opaque, so pdfmake never sees transparency.
    expect(png!.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    expect(png!.subarray(25, 26).readUInt8(0)).toBe(6);
  });

  it("returns null for a spec with no drawable data", () => {
    expect(figurePng({ kind: "line", series: [] })).toBeNull();
  });
});

describe("brand fonts", () => {
  it("ships Newsreader + Anek Latin faces to pdfmake and resvg", () => {
    const vfs = pdfFontVfs();
    for (const face of Object.values(PDF_FONTS).flatMap((f) => Object.values(f))) {
      expect(vfs[face], `missing ${face}`).toBeTruthy();
    }
    const opts = resvgFontOptions();
    expect(opts.fontFiles.length).toBe(Object.keys(vfs).length);
    expect(opts.loadSystemFonts).toBe(false);
    // no EOT smuggling: every vendored file starts with a TrueType scaler tag
    for (const p of opts.fontFiles) {
      const tag = readFileSync(p).subarray(0, 4).toString("hex");
      expect(["00010000", "74746366", "4f54544f", "74727565"], `not a TTF: ${p}`).toContain(tag);
    }
  });
});
