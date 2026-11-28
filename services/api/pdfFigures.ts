// Print figures: the harness's figure-kit SVGs (the exact drawings the UI
// shows) rasterized for the PDF.
//
// figure-kit paints every colour/font as `var(--token, fallback)` so one SVG
// works in the app theme AND standalone. resvg understands neither var() nor
// modern color spaces, so for print we resolve the vars to their fallbacks
// (which ARE the light print palette) and rasterize at 2x with the vendored
// brand fonts.
//
// The hover <style> layer stays: it is what makes the crosshair hit-areas
// `fill:transparent` and the readouts `opacity:0`. Strip it and those paint
// as solid black boxes.
import { Resvg } from "@resvg/resvg-js";
import type { ChartSpec } from "../harness/report/document.js";
import { renderFigure } from "../harness/report/figure-kit.js";
import { resvgFontOptions } from "./pdfFonts.js";

/** `var(--x, fallback)` → fallback; bare `var(--x)` → empty (inherits). */
function resolveVars(svg: string): string {
  return svg.replace(/var\(\s*--[\w-]+\s*(?:,\s*([^)]*))?\)/g, (_m, fb) => (fb ?? "").trim());
}

let fontOpts: ReturnType<typeof resvgFontOptions> | null = null;

/** One figure-kit spec → PNG buffer at 2x print sharpness. Null when the
 *  spec renders to nothing (empty data). */
export function figurePng(spec: ChartSpec, opts: { unit?: string; label?: string; ink?: string } = {}): Buffer | null {
  const svg = renderFigure(spec, opts);
  if (!svg) return null;
  const clean = resolveVars(svg);
  const w = Number(/viewBox="0 0 ([\d.]+)/.exec(clean)?.[1]) || 1040;
  if (!fontOpts) fontOpts = resvgFontOptions();
  const resvg = new Resvg(clean, {
    fitTo: { mode: "width", value: Math.round(w * 2) },
    // Opaque paper: pdfmake composites a transparent PNG onto black.
    background: "#FAFAF9",
    font: fontOpts,
  });
  return Buffer.from(resvg.render().asPng());
}
