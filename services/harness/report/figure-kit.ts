/**
 * figure-kit — the report's server-side figure renderer. Pure string builders
 * with the Almanac drawing rules baked in: one story ink (var(--c)), direct
 * labels, honest scales, real minus, one scale word per axis.
 *
 * Every colour and size is an INLINE style carrying a var() fallback, so one
 * string works twice: it follows the app theme inside `.almanac-report` AND
 * stands alone in the raw markdown export (fallback = light palette). No DOM,
 * no JS — hover is CSS inside the SVG (works whenever the SVG is inlined:
 * the report renderer and the demo page), plus native <title> tooltips that
 * work even as standalone files.
 */
import type { ChartSpec, Series } from "./document.js";

const MINUS = "\u2212"; // real minus, per the number-typesetting rule
const C = {
  // fallbacks live INSIDE var() — a bare var(--x) with no default invalidates
  // the whole declaration outside the app (md export/preview), silently
  // inheriting the body font instead of Anek/Newsreader.
  sans: "var(--font-body,'Anek Latin',system-ui,sans-serif)",
  serif: "var(--font-display,'Newsreader',Georgia,serif)",
  bg: "var(--bg,#FAFAF9)",
  c: "var(--c,#3A5BD0)",
  ink: "var(--ink,#16181B)",
  mid: "var(--mid,#5A6270)",
  dim: "var(--dim,#6B7280)",
  grid: "var(--line,#C7C7C2)",
  slate: "var(--slate,#b7b7bf)",
  onC: "var(--on-c,#ffffff)",
  // signed-number inks — same pair almanac.css uses for table .pos/.neg
  pos: "var(--economy-ink,#2A45A8)",
  neg: "var(--people-ink,#A63C71)",
};

export interface FigureOpts {
  /** Artboard width — page figures draw at 1040 (skill rule: draw at the width you show). */
  w?: number;
  h?: number;
  /** Axis/label unit, drives the scale word (×, %, USD…) and ₹ grouping. */
  unit?: string;
  /** aria-label for the svg. */
  label?: string;
  /** Plot ink override (spec.color / skill palette); defaults to the theme story ink. */
  ink?: string;
}

const rr = (n: number) => Math.round(n * 100) / 100;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const esc = (s: unknown) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * Hover layer — CSS baked into the SVG. Works whenever the SVG is inlined
 * into a DOM (the report renderer, the demo); native <title> tooltips cover
 * standalone files. Selectors are figure-namespaced so the document-wide
 * cascade of an inlined <style> never leaks.
 */
const HOVER_CSS =
  "<style>" +
  ".fig-hit{fill:transparent}" +
  ".fig-seg .fig-ro{opacity:0;transition:opacity .06s;pointer-events:none}" +
  ".fig-seg:hover .fig-ro{opacity:1}" +
  ".fig-row:hover .fig-bar{opacity:.8}" +
  "</style>";

function txt(
  x: number,
  y: number,
  s: string,
  o: {
    anchor?: "start" | "middle" | "end";
    size?: number;
    weight?: number;
    fill?: string;
    serif?: boolean;
    italic?: boolean;
    /** ground-coloured halo where a label crosses lines (skill labelling rule). */
    halo?: boolean;
    /** Extra CSS bolted onto the inline style (tracking, tabular figures). */
    extra?: string;
  } = {},
): string {
  const style = [
    `font-family:${o.serif ? C.serif : C.sans}`,
    `font-size:${o.size ?? 11}px`,
    // Newsreader never renders light in a report: serif text floors at 400
    // (explicit 300s elsewhere in the kit resolve to normal too).
    `font-weight:${o.serif ? Math.max(o.weight ?? 400, 400) : (o.weight ?? 300)}`,
    `fill:${o.fill ?? C.mid}`,
    o.italic ? "font-style:italic" : "",
    o.halo ? `paint-order:stroke;stroke:${C.bg};stroke-width:3px;stroke-linejoin:round` : "",
    o.extra ?? "",
  ]
    .filter(Boolean)
    .join(";");
  return `<text x="${rr(x)}" y="${rr(y)}" text-anchor="${o.anchor ?? "start"}" style="${style}">${esc(s)}</text>`;
}

const rect = (x: number, y: number, w: number, h: number, fill: string, opacity?: number, rx = 0) =>
  `<rect x="${rr(x)}" y="${rr(y)}" width="${rr(Math.max(0, w))}" height="${rr(Math.max(0, h))}"${rx ? ` rx="${rx}"` : ""} style="fill:${fill}"${opacity != null ? ` opacity="${opacity}"` : ""}/>`;
/** rect carrying a native <title> tooltip (works even as a standalone file). */
const rectT = (x: number, y: number, w: number, h: number, fill: string, title: string, rx = 0) =>
  `<rect x="${rr(x)}" y="${rr(y)}" width="${rr(Math.max(0, w))}" height="${rr(Math.max(0, h))}"${rx ? ` rx="${rx}"` : ""} style="fill:${fill}"><title>${esc(title)}</title></rect>`;

const line = (x1: number, y1: number, x2: number, y2: number, stroke: string, width = 1, dash?: string) =>
  `<line x1="${rr(x1)}" y1="${rr(y1)}" x2="${rr(x2)}" y2="${rr(y2)}" style="stroke:${stroke};stroke-width:${width}${dash ? `;stroke-dasharray:${dash}` : ""}"/>`;

const svgOpen = (w: number, h: number, label?: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${rr(w)} ${rr(h)}" width="${rr(w)}" height="${rr(h)}" role="img"${label ? ` aria-label="${esc(label)}"` : ""}>`;

/** Values → text: real minus, thousands grouping (lakh grouping for ₹), ≤2 decimals. */
export function fmtNum(v: number, unit = ""): string {
  if (!Number.isFinite(v)) return "";
  const rupee = unit.trim().startsWith("₹");
  const s = Math.abs(v).toLocaleString(rupee ? "en-IN" : "en-US", { maximumFractionDigits: 2 });
  return (v < 0 ? MINUS : "") + s;
}

/** Signed text: leading + for positives, % suffix when the unit IS %. */
const signed = (v: number, unit = "") => `${v > 0 ? "+" : ""}${fmtNum(v, unit)}${unit.trim() === "%" ? "%" : ""}`;

/** Signed-number inks (skill: colour on data, same pair as table .pos/.neg). */
const signColor = (v: number) => (v > 0 ? C.pos : v < 0 ? C.neg : C.ink);

/** Scale word from the axis magnitude: 5.1e12 → "T"; ₹ gets lakh/crore. */
function scaleOf(maxAbs: number, unit = ""): { div: number; word: string } {
  if (unit.trim().startsWith("₹")) {
    if (maxAbs >= 1e7) return { div: 1e7, word: " crore" };
    if (maxAbs >= 1e5) return { div: 1e5, word: " lakh" };
    return { div: 1, word: "" };
  }
  for (const [d, w] of [
    [1e12, "T"],
    [1e9, "B"],
    [1e6, "M"],
    [1e3, "k"],
  ] as [number, string][]) {
    if (maxAbs >= d) return { div: d, word: w };
  }
  return { div: 1, word: "" };
}

/** One scale word per axis: every tick printed in the top tick's scale. */
function tickFmt(step: number, maxAbs: number, unit = ""): (v: number) => string {
  const { div, word } = scaleOf(maxAbs, unit);
  const s = step / div;
  const dec = s >= 1 ? 0 : s >= 0.1 ? 1 : 2;
  return (v) => {
    if (v === 0) return "0";
    const t = v / div;
    const body = (t < 0 ? MINUS : "") + Math.abs(t).toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec });
    return body + word;
  };
}

/** Nice round tick ladder (1/2/5×10ⁿ) — honest axis, no 347.81 ticks. The
 *  smallest ladder step with a sane tick count wins, so the frame hugs the
 *  data instead of rounding far past it (data −38 never sits on a −60 axis). */
function niceTicks(lo: number, hi: number, count = 4): { lo: number; hi: number; step: number; ticks: number[] } {
  if (!(hi > lo)) hi = lo + Math.abs(lo || 1);
  const raw = (hi - lo) / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  let step = 10 * mag;
  for (const cand of [1, 2, 5].map((m) => m * mag)) {
    if ((hi - lo) / cand <= 8) {
      step = cand;
      break;
    }
  }
  const nlo = Math.floor(lo / step) * step;
  const nhi = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let v = nlo; v <= nhi + step / 2; v += step) ticks.push(Math.abs(v) < step / 1e9 ? 0 : v);
  return { lo: nlo, hi: nhi, step, ticks };
}

/** Smooth cubic path through the points (the kit's house curve). */
function smooth(pts: [number, number][]): string {
  if (!pts.length) return "";
  if (pts.length < 2) return `M ${rr(pts[0][0])} ${rr(pts[0][1])}`;
  let d = `M ${rr(pts[0][0])} ${rr(pts[0][1])}`;
  for (let i = 1; i < pts.length; i++) {
    const cx = (pts[i - 1][0] + pts[i][0]) / 2;
    d += ` C ${rr(cx)} ${rr(pts[i - 1][1])}, ${rr(cx)} ${rr(pts[i][1])}, ${rr(pts[i][0])} ${rr(pts[i][1])}`;
  }
  return d;
}

/**
 * Series → a shared x axis (union of timestamps) with constant-hold fill, so a
 * shorter series (sma200 tail) doesn't split the path.
 * ponytail: constant-hold across true gaps; null-split paths if divergence matters.
 */
function alignSeries(series: Series[]): { xs: number[]; xLabels: string[]; seriesLabels: string[]; data: number[][] } {
  const used = series.filter((s) => s.points.length);
  const set = new Set<number>();
  for (const s of used) for (const p of s.points) set.add(p.t);
  const xs = [...set].sort((a, b) => a - b);
  const data = used.map((s) => {
    const m = new Map(s.points.map((p) => [p.t, p.v]));
    const out: number[] = [];
    let last: number | undefined;
    for (const t of xs) {
      const v = m.get(t);
      if (v !== undefined) last = v;
      out.push(last ?? NaN);
    }
    // backfill leading holes from the first real value
    const first = out.find((v) => Number.isFinite(v));
    return out.map((v) => (Number.isFinite(v) ? v : (first ?? NaN)));
  });
  // drop series with no data at all (chart then draws whatever remains)
  const keep = data.map((d) => d.some(Number.isFinite));
  const seriesLabels = used.map((s, i) => (keep[i] ? s.label : "")).filter((_, i) => keep[i]);
  const keptData = data.filter((_, i) => keep[i]);
  // x labels: epoch → YYYY-MM-DD (points come from tool payloads as epoch seconds)
  const fmt = (t: number) => new Date(t < 1e12 ? t * 1000 : t).toISOString().slice(0, 10);
  return { xs, xLabels: xs.map(fmt), seriesLabels, data: keptData };
}

/** Story ink: lead = plot ink, second = rival (ink), rest = context grey. */
const colorOf = (i: number, ink: string) => (i === 0 ? ink : i === 1 ? C.ink : C.slate);
const widthOf = (i: number, n: number) => (i === 0 ? (n === 1 ? 3 : 3.2) : i === 1 ? 2 : 1.25);

/**
 * Line / multiline / area — tall plot, tight honest y-limits (the axis hugs
 * the data: ≤1 nice step of overhang), serif end labels, and a CSS hover
 * crosshair per x segment: vertical hairline + date + each series' value.
 */
function lineSvg(series: Series[], o: FigureOpts): string | null {
  const { xs, xLabels, seriesLabels, data } = alignSeries(series);
  const all = data.flat().filter(Number.isFinite);
  if (!xs.length || !all.length) return null;
  const w = o.w ?? 1040;
  const h = o.h ?? 520;
  const ink = o.ink ?? C.c;

  const padT = 30;
  const padB = 46;
  const lo0 = Math.min(...all);
  const hi0 = Math.max(...all);
  // tight limits: the frame hugs the data — 5% breathing room, then the nice
  // ladder adds at most one step of overhang. Never a far-off axis.
  const pad = (hi0 - lo0) * 0.05 || Math.abs(hi0) * 0.04 || 1;
  const { lo, hi, step, ticks } = niceTicks(lo0 - pad, hi0 + pad, 4);
  const ylab = tickFmt(step, Math.max(Math.abs(lo), Math.abs(hi)), o.unit);
  // gutter sized to the widest printed y label (≈0.6em per char at 11px)
  const labelW = Math.max(...ticks.map((t) => ylab(t).length)) * 6.6;
  const padL = labelW + 16;
  const endW = Math.max(
    0,
    ...data.map((vals, i) => {
      if (colorOf(i, ink) === C.slate && data.length > 4) return 0;
      // single-series label renders at 14px serif and carries the last value
      const text = `${seriesLabels[i] ?? ""}${data.length === 1 ? ` ${fmtNum(vals[vals.length - 1], o.unit)}` : ""}`;
      const per = data.length === 1 ? 8.2 : 6.4;
      return text.length * per + 30;
    }),
  );
  const padR = Math.max(56, endW + 16);

  const X = (i: number) => padL + (xs.length === 1 ? 0.5 : (i / (xs.length - 1))) * (w - padL - padR);
  const Y = (v: number) => h - padB - ((v - lo) / (hi - lo)) * (h - padT - padB);
  const plotH = h - padT - padB;

  const g: string[] = [svgOpen(w, h, o.label)];
  // no grid line on the first/last tick — top and bottom frame, not data
  for (const t of ticks) {
    const y = Y(t);
    if (t !== ticks[0] && t !== ticks[ticks.length - 1]) g.push(line(padL, y, w - padR, y, C.grid, 1));
    g.push(txt(padL - 8, y + 4, ylab(t), { anchor: "end", size: 11, fill: C.dim }));
  }
  const everyX = Math.max(1, Math.ceil(xs.length / 8));
  xLabels.forEach((lab, i) => {
    if (i % everyX === 0 || i === xs.length - 1) g.push(txt(X(i), h - padB + 20, lab, { anchor: "middle", size: 11, fill: C.mid }));
  });

  data.forEach((vals, si) => {
    const pts = vals.map((v, i) => [X(i), Y(v)] as [number, number]).filter(([, y]) => Number.isFinite(y));
    if (pts.length < 2) return;
    g.push(
      `<path d="${smooth(pts)}" fill="none" style="stroke:${colorOf(si, ink)};stroke-width:${widthOf(si, data.length)};stroke-linecap:round;stroke-linejoin:round"/>`,
    );
    const [lx, ly] = pts[pts.length - 1];
    g.push(`<circle cx="${rr(lx)}" cy="${rr(ly)}" r="${si === 0 ? 4.2 : 3.2}" style="fill:${colorOf(si, ink)}"/>`);
  });

  // direct end labels (rule 6) — lead + rival always, grey only when ≤4 series;
  // naive downward nudge where labels would stack (ceiling: no full declutter).
  const labelled = data.map((_, i) => (data.length > 4 ? i < 2 : true));
  let prevY = -Infinity;
  data.forEach((vals, si) => {
    if (!labelled[si]) return;
    const v = vals[vals.length - 1];
    if (!Number.isFinite(v)) return;
    let y = Y(v);
    if (y - prevY < 13) y = prevY + 13;
    prevY = y;
    g.push(
      txt(X(xs.length - 1) + 10, y + 4, `${seriesLabels[si]}${data.length === 1 ? ` ${fmtNum(v, o.unit)}` : ""}`, {
        size: data.length === 1 ? 14 : 11,
        weight: 300,
        fill: colorOf(si, ink),
        halo: true,
        serif: data.length === 1,
      }),
    );
  });

  // hover crosshair — one transparent hit-strip per x point; the readout
  // (hairline + date + one value line per series) is hidden until hover.
  const stride = Math.max(1, Math.ceil(xs.length / 220));
  for (let i = 0; i < xs.length; i += stride) {
    const x = X(i);
    const left = i === 0 ? padL : (X(Math.max(0, i - stride)) + x) / 2;
    const right = i + stride >= xs.length ? w - padR : (x + X(Math.min(i + stride, xs.length - 1))) / 2;
    const flip = x > (padL + w - padR) / 2;
    const ax = flip ? x - 9 : x + 9;
    const anchor = flip ? "end" : "start";
    const parts: string[] = [line(x, padT, x, h - padB, C.mid, 1, "2 3")];
    parts.push(txt(ax, padT + 12, xLabels[i], { anchor, size: 10.5, fill: C.dim, halo: true }));
    data.forEach((vals, si) => {
      const v = vals[i];
      if (!Number.isFinite(v)) return;
      parts.push(`<circle cx="${rr(x)}" cy="${rr(Y(v))}" r="3.4" style="fill:${colorOf(si, ink)}"/>`);
      const label = data.length === 1 ? fmtNum(v, o.unit ?? "") : `${seriesLabels[si]}  ${fmtNum(v, o.unit ?? "")}`;
      parts.push(
        txt(ax, padT + 30 + si * 15, label, {
          anchor,
          size: data.length === 1 ? 13 : 11,
          weight: 300,
          fill: colorOf(si, ink),
          halo: true,
          serif: data.length === 1,
          extra: "font-variant-numeric:tabular-nums lining-nums",
        }),
      );
    });
    const tip = `${xLabels[i]} · ` + data.map((vals, si) => `${seriesLabels[si]} ${fmtNum(vals[i], o.unit ?? "")}`).join(", ");
    g.push(
      `<g class="fig-seg">` +
        `<rect class="fig-hit" x="${rr(left)}" y="${padT}" width="${rr(Math.max(2, right - left))}" height="${rr(plotH)}"><title>${esc(tip)}</title></rect>` +
        `<g class="fig-ro">${parts.join("")}</g>` +
        `</g>`,
    );
  }
  g.push("</svg>");
  return g.join("");
}

/** Legend row: swatch + label entries, left-aligned (hbar/vbar/gbar). */
function legendRow(x: number, y: number, entries: { sw: "rect" | "dash"; color: string; label: string }[]): string[] {
  const out: string[] = [];
  let cx = x;
  for (const e of entries) {
    if (e.sw === "dash") {
      out.push(rect(cx, y + 3.5, 14, 3, e.color));
      cx += 20;
    } else {
      out.push(rect(cx, y, 10, 10, e.color, undefined, 2));
      cx += 16;
    }
    out.push(txt(cx, y + 9, e.label, { size: 11, fill: C.mid }));
    cx += e.label.length * 6.2 + 26;
  }
  return out;
}

/**
 * Horizontal bars (hbar) — the compact ranked list: left label column, bars
 * from a zero baseline (negatives grow left, positives right, inked by sign),
 * the signed value always printed in a right-hand column. No legend — the
 * signed values carry it (skill rule 6: label the data, not a legend).
 * Content-sized artboard: it renders at its drawn width, never stretched.
 */
function hBarsSvg(categories: string[], values: number[], o: FigureOpts): string | null {
  const n = Math.min(categories.length, values.length);
  if (!n) return null;
  const rowH = 21;
  const barH = 9;
  const padT = 8;
  const padB = 8;
  const h = padT + n * rowH + padB;

  const texts = values.map((v) => signed(v, o.unit ?? ""));
  const labelW = clamp(Math.max(...categories.map((c) => c.length)) * 6.4 + 18, 70, 300);
  const valueW = clamp(Math.max(...texts.map((t) => t.length)) * 6.6 + 24, 60, 140);
  // one compact width for every hbar — the track absorbs the label/value columns
  const trackW = clamp(620 - labelW - valueW - 42, 160, 380);
  const w = labelW + trackW + valueW + 42;
  const trackX = labelW + 14;
  const valX = w - 14;

  // honest diverging scale: both signs share one scale, zero sits where the
  // data puts it; one sign only hugs its edge of the track.
  const posMax = Math.max(0, ...values);
  const negMax = Math.max(0, ...values.map((v) => -v));
  const scale = posMax + negMax > 0 ? trackW / (posMax + negMax) : 0;
  const zeroX = posMax + negMax > 0 ? trackX + negMax * scale : trackX;

  const g: string[] = [svgOpen(w, h, o.label)];
  g.push(line(zeroX, padT, zeroX, h - padB, C.grid, 1)); // zero baseline
  for (let i = 0; i < n; i++) {
    const y = padT + i * rowH;
    const cy = y + rowH / 2;
    const v = values[i];
    const bw = scale * Math.abs(v);
    const x = v >= 0 ? zeroX : zeroX - bw;
    const color = signColor(v);
    g.push(
      `<g class="fig-row">` +
        txt(8, cy + 4, categories[i], { anchor: "start", size: 11.5, fill: C.ink }) +
        rectT(x, cy - barH / 2, bw, barH, color, signed(v, o.unit ?? ""), 1) +
        // the signed value, always on, right-aligned like a ledger column
        `<text class="fig-val" x="${rr(valX)}" y="${rr(cy + 4)}" style="font-family:${C.sans};font-size:11.5px;font-weight:400;fill:${color};font-variant-numeric:tabular-nums lining-nums" text-anchor="end">${esc(signed(v, o.unit ?? ""))}</text>` +
        `</g>`,
    );
  }
  g.push("</svg>");
  return g.join("");
}

/**
 * Vertical columns from zero (single-series vbar) — compact content width,
 * signed value labels above each column, signed y axis.
 */
function columnsSvg(labels: string[], vals: number[], o: FigureOpts): string | null {
  const finite = vals.filter(Number.isFinite);
  if (!labels.length || !finite.length) return null;
  const padT = 28;
  const padB = 44;
  const { lo, hi, step, ticks } = niceTicks(Math.min(0, ...finite) * 1.05, Math.max(0, ...finite) * 1.06, 4);
  const ylab = tickFmt(step, Math.max(Math.abs(lo), Math.abs(hi)), o.unit);
  const padL = Math.max(...ticks.map((t) => ylab(t).length)) * 6.6 + 16;
  const padR = 20;
  const stepW = 56;
  const w = clamp(padL + labels.length * stepW + padR, 460, 1040);
  const h = 440;
  const span = hi - lo || 1;
  const Y = (v: number) => h - padB - ((v - lo) / span) * (h - padT - padB);
  const ink = o.ink ?? C.c;

  const g: string[] = [svgOpen(w, h, o.label)];
  for (const t of ticks) {
    // keep the zero baseline; skip the top frame line
    if (!(t !== 0 && t === ticks[ticks.length - 1])) g.push(line(padL, Y(t), w - padR, Y(t), t === 0 ? C.dim : C.grid, t === 0 ? 1.2 : 1));
    g.push(txt(padL - 8, Y(t) + 4, ylab(t), { anchor: "end", fill: C.dim }));
  }
  const bw = stepW * 0.5;
  vals.forEach((v, i) => {
    if (!Number.isFinite(v)) return;
    const x = padL + i * stepW + (stepW - bw) / 2;
    g.push(rect(x, Math.min(Y(v), Y(0)), bw, Math.abs(Y(0) - Y(v)), v < 0 ? C.neg : ink, undefined, 2));
    g.push(
      txt(x + bw / 2, v >= 0 ? Y(v) - 8 : Y(v) + 16, signed(v, o.unit ?? ""), {
        anchor: "middle",
        size: 12,
        weight: 300,
        serif: true,
        fill: signColor(v),
        halo: true,
        extra: "font-variant-numeric:tabular-nums lining-nums",
      }),
    );
  });
  const everyX = Math.max(1, Math.ceil(labels.length / 12));
  labels.forEach((lab, i) => {
    if (i % everyX === 0 || i === labels.length - 1) g.push(txt(padL + i * stepW + stepW / 2, h - padB + 20, lab, { anchor: "middle", fill: C.mid }));
  });
  g.push("</svg>");
  return g.join("");
}

/**
 * Paired vertical columns (vbar with 2 groups) — the year-by-year returns
 * board: primary period totals as ink columns with serif value labels,
 * secondary peak/drawdown markers as warm dashes with their own labels,
 * legend on top, compact content width, signed y axis.
 */
function pairedColumnsSvg(labels: string[], groups: { name: string; values: number[] }[], o: FigureOpts): string | null {
  const [primary, secondary] = groups;
  const finite = groups.flatMap((grp) => grp.values).filter(Number.isFinite);
  if (!labels.length || !finite.length) return null;
  const padT = 46; // the legend row lives here
  const padB = 44;
  const { lo, hi, step, ticks } = niceTicks(Math.min(0, ...finite) * 1.08, Math.max(0, ...finite) * 1.08, 4);
  const ylab = tickFmt(step, Math.max(Math.abs(lo), Math.abs(hi)), o.unit);
  const padL = Math.max(...ticks.map((t) => ylab(t).length)) * 6.6 + 16;
  const padR = 20;
  const stepW = 56;
  const w = clamp(padL + labels.length * stepW + padR, 480, 1040);
  const h = 460;
  const span = hi - lo || 1;
  const Y = (v: number) => h - padB - ((v - lo) / span) * (h - padT - padB);
  const ink = o.ink ?? C.c;

  const g: string[] = [svgOpen(w, h, o.label)];
  g.push(...legendRow(padL, 12, [
    { sw: "rect", color: ink, label: primary.name },
    ...(secondary ? [{ sw: "dash" as const, color: C.neg, label: secondary.name }] : []),
  ]));
  for (const t of ticks) {
    if (!(t !== 0 && t === ticks[ticks.length - 1])) g.push(line(padL, Y(t), w - padR, Y(t), t === 0 ? C.dim : C.grid, t === 0 ? 1.2 : 1));
    g.push(txt(padL - 8, Y(t) + 4, ylab(t), { anchor: "end", fill: C.dim }));
  }
  const bw = stepW * 0.44;
  labels.forEach((lab, i) => {
    const cx = padL + i * stepW + stepW / 2;
    const pv = primary.values[i];
    if (Number.isFinite(pv)) {
      g.push(rect(cx - bw / 2, Math.min(Y(pv), Y(0)), bw, Math.abs(Y(0) - Y(pv)), pv < 0 ? C.neg : ink, undefined, 2));
      g.push(
        txt(cx, pv >= 0 ? Y(pv) - 8 : Y(pv) + 16, signed(pv, o.unit ?? ""), {
          anchor: "middle",
          size: 12.5,
          weight: 300,
          serif: true,
          fill: signColor(pv),
          halo: true,
          extra: "font-variant-numeric:tabular-nums lining-nums",
        }),
      );
    }
    const sv = secondary?.values[i];
    if (Number.isFinite(sv)) {
      // secondary marker: thin horizontal dash at its value, label beneath
      g.push(rect(cx - bw * 0.62, Y(sv) - 1.5, bw * 1.24, 3, C.neg, undefined, 1.5));
      g.push(
        txt(cx, Y(sv) + 18, signed(sv, o.unit ?? ""), {
          anchor: "middle",
          size: 12,
          weight: 300,
          serif: true,
          fill: C.neg,
          halo: true,
          extra: "font-variant-numeric:tabular-nums lining-nums",
        }),
      );
    }
  });
  const everyX = Math.max(1, Math.ceil(labels.length / 12));
  labels.forEach((lab, i) => {
    if (i % everyX === 0 || i === labels.length - 1) g.push(txt(padL + i * stepW + stepW / 2, h - padB + 20, lab, { anchor: "middle", fill: C.mid }));
  });
  g.push("</svg>");
  return g.join("");
}

/** Series ink ladder for grouped bars — mirrors colorOf(), extended to four stops. */
const groupColor = (i: number, ink: string) => [ink, C.neg, C.slate, C.mid][i % 4];

/**
 * Grouped columns (gbar) — several series across the SAME categories
 * (returns by period, YTD across indices), one cluster per category.
 * Legend on top, compact content width, serif value labels when the
 * cluster stays readable (≤2 groups).
 */
function groupedColumnsSvg(labels: string[], groups: { name: string; values: number[] }[], o: FigureOpts): string | null {
  const finite = groups.flatMap((grp) => grp.values).filter(Number.isFinite);
  if (!labels.length || !groups.length || !finite.length) return null;
  const padT = 46; // the legend row lives here
  const padB = 44;
  const { lo, hi, step, ticks } = niceTicks(Math.min(0, ...finite) * 1.08, Math.max(0, ...finite) * 1.08, 4);
  const ylab = tickFmt(step, Math.max(Math.abs(lo), Math.abs(hi)), o.unit);
  const padL = Math.max(...ticks.map((t) => ylab(t).length)) * 6.6 + 16;
  const padR = 20;
  const stepW = 24 * groups.length + 34;
  const w = clamp(padL + labels.length * stepW + padR, 480, 1040);
  const h = 440;
  const span = hi - lo || 1;
  const Y = (v: number) => h - padB - ((v - lo) / span) * (h - padT - padB);
  const gw = (stepW * 0.72) / groups.length; // bar width inside one cluster
  const ink = o.ink ?? C.c;
  const labelled = groups.length <= 2;

  const g: string[] = [svgOpen(w, h, o.label)];
  g.push(...legendRow(padL, 12, groups.map((grp, gi) => ({ sw: "rect" as const, color: groupColor(gi, ink), label: grp.name }))));
  for (const t of ticks) {
    if (!(t !== 0 && t === ticks[ticks.length - 1])) g.push(line(padL, Y(t), w - padR, Y(t), t === 0 ? C.dim : C.grid, t === 0 ? 1.2 : 1));
    g.push(txt(padL - 8, Y(t) + 4, ylab(t), { anchor: "end", fill: C.dim }));
  }
  labels.forEach((_, i) => {
    const base = padL + i * stepW + (stepW - gw * groups.length) / 2;
    groups.forEach((grp, gi) => {
      const v = grp.values[i];
      if (!Number.isFinite(v)) return;
      g.push(rect(base + gi * gw, Math.min(Y(v), Y(0)), gw - 2, Math.abs(Y(0) - Y(v)), groupColor(gi, ink), undefined, 2));
      if (labelled) {
        g.push(
          txt(base + gi * gw + (gw - 2) / 2, v >= 0 ? Y(v) - 7 : Y(v) + 14, signed(v, o.unit ?? ""), {
            anchor: "middle",
            size: 11.5,
            weight: 300,
            serif: true,
            fill: signColor(v),
            halo: true,
            extra: "font-variant-numeric:tabular-nums lining-nums",
          }),
        );
      }
    });
  });
  const everyX = Math.max(1, Math.ceil(labels.length / 12));
  labels.forEach((lab, i) => {
    if (i % everyX === 0 || i === labels.length - 1) g.push(txt(padL + i * stepW + stepW / 2, h - padB + 20, lab, { anchor: "middle", fill: C.mid }));
  });
  g.push("</svg>");
  return g.join("");
}

/**
 * The ledger table figure — the advanced grid: bold row labels, cells that
 * carry a level-1 main line, an optional level-2 sub-line and an optional
 * 0..1 underline gauge, hairline rows, numbers right-aligned and tabular.
 * `columns` headers, `rows` arrays of string|number|{text,sub?,bar?} cells.
 */
function tableSvg(spec: ChartSpec, o: FigureOpts): string | null {
  const cols = spec.columns ?? [];
  const rows = (spec.rows ?? []).filter((r) => r.length);
  if (!cols.length || !rows.length) return null;
  const w = o.w ?? 1040;
  const cellText = (c: unknown): string => (c != null && typeof c === "object" ? String((c as any).text ?? "") : String(c ?? ""));
  const cellSub = (c: unknown): string | undefined => (c != null && typeof c === "object" ? (c as any).sub : undefined);
  const cellBar = (c: unknown): number | undefined => (c != null && typeof c === "object" ? (c as any).bar : undefined);
  const isNum = (c: unknown) => typeof c === "number" && Number.isFinite(c);
  const col0W = clamp(Math.max(...rows.map((r) => String(cellText(r[0])).length)) * 6.8 + 26, 120, 320);
  const restW = (w - col0W) / Math.max(1, cols.length - 1);
  const colX = (i: number) => (i === 0 ? 0 : col0W + (i - 1) * restW);

  const rowH = (row: unknown[]) => (row.some((c) => cellSub(c) != null || cellBar(c) != null) ? 58 : 36);
  const headerH = 36;
  const h = headerH + rows.reduce((a, r) => a + rowH(r), 0) + 10;

  const g: string[] = [svgOpen(w, h, o.label)];
  // headers: small caps, dim, letterspaced, at column starts
  cols.forEach((c, i) => {
    g.push(txt(colX(i) + (i === 0 ? 2 : 8), 20, String(c), { size: 11, weight: 300, fill: C.dim, extra: "letter-spacing:.08em" }));
  });
  g.push(line(0, headerH, w, headerH, C.grid, 1.2));
  let y = headerH;
  rows.forEach((row) => {
    const rh = rowH(row);
    const mid = y + rh / 2;
    row.forEach((cell, i) => {
      if (i >= cols.length) return;
      const num = isNum(cell);
      const x = num ? colX(i) + restW - 10 : colX(i) + (i === 0 ? 2 : 8);
      if (num) {
        g.push(
          txt(x, mid - 2, fmtNum(cell as number, o.unit ?? ""), {
            anchor: "end",
            size: 13,
            weight: 300,
            fill: C.ink,
            extra: "font-variant-numeric:tabular-nums lining-nums",
          }),
        );
        return;
      }
      const text = cellText(cell);
      const sub = cellSub(cell);
      const bar = cellBar(cell);
      g.push(
        txt(x, sub != null || bar != null ? y + 22 : mid + 4, text, {
          size: 13,
          weight: i === 0 ? 400 : 300,
          fill: C.ink,
        }),
      );
      if (sub) g.push(txt(x, y + 40, sub, { size: 11, fill: C.dim }));
      if (bar != null) {
        const tw = Math.min(96, restW - 20);
        g.push(rect(x, y + rh - 14, tw, 2, C.grid));
        g.push(rect(x, y + rh - 14, tw * clamp(bar, 0, 1), 2, C.ink));
      }
    });
    y += rh;
    g.push(line(0, y, w, y, C.grid, 1));
  });
  g.push("</svg>");
  return g.join("");
}

/**
 * The matrix — heatmap-style multi-column data grid: bold row labels, dim
 * group columns, numeric cells shaded by sign and magnitude (blue for
 * positive, warm for negative) with signed tabular values, optional unshaded
 * "plain" columns (e.g. "Below peak"). Returns comparison tables.
 * `columns` headers, `rows` = [label, group?, ...numbers] per row.
 */
function matrixSvg(spec: ChartSpec, o: FigureOpts): string | null {
  const cols = spec.columns ?? [];
  const rows = (spec.rows ?? []).filter((r) => r.length);
  if (!cols.length || !rows.length) return null;
  const plainSet = new Set(spec.plain ?? []);
  const cellText = (c: unknown): string => (c != null && typeof c === "object" ? String((c as any).text ?? "") : String(c ?? ""));
  // column classes: 0 = row label, string cells = group cols, numbers = heat
  const heatIdx: number[] = [];
  let groupIdx: number[] = [];
  cols.forEach((c, i) => {
    if (i === 0) return;
    const anyNum = rows.some((r) => typeof r[i] === "number" && Number.isFinite(r[i] as number));
    if (anyNum) heatIdx.push(i);
    else groupIdx.push(i);
  });
  groupIdx = groupIdx.filter((i) => rows.some((r) => cellText(r[i])));
  const shaded = heatIdx.filter((i) => !plainSet.has(String(cols[i])));
  const maxAbs = Math.max(
    1e-9,
    ...rows.flatMap((r) => shaded.map((i) => Math.abs(r[i] as number))).filter(Number.isFinite),
  );

  const labelW = clamp(Math.max(...rows.map((r) => cellText(r[0]).length)) * 6.8 + 26, 120, 320);
  const groupW = groupIdx.length
    ? clamp(Math.max(...groupIdx.flatMap((i) => rows.map((r) => cellText(r[i]).length))) * 6.2 + 22, 60, 220)
    : 0;
  const numW = (i: number) =>
    clamp(
      Math.max(String(cols[i]).length, ...rows.filter((r) => typeof r[i] === "number").map((r) => signed(r[i] as number, o.unit ?? "").length)) * 6.6 + 26,
      64,
      160,
    );
  // column x positions: label col, then group cols, then numeric cols left→right
  const colXs = new Map<number, number>();
  let cursor = 0;
  colXs.set(0, 0);
  cursor = labelW;
  for (const i of groupIdx) {
    colXs.set(i, cursor);
    cursor += groupW;
  }
  for (const i of heatIdx) {
    colXs.set(i, cursor);
    cursor += numW(i);
  }
  const w = clamp(cursor + 8, 420, 1040);
  const rowH = 38;
  const headerH = 42;
  const h = headerH + rows.length * rowH + 10;
  const xOf = (i: number) => colXs.get(i) ?? 0;

  const g: string[] = [svgOpen(w, h, o.label)];
  cols.forEach((c, i) => {
    if (i === 0) g.push(txt(2, 24, String(c), { size: 11, weight: 300, fill: C.dim, extra: "letter-spacing:.08em" }));
    else if (groupIdx.includes(i)) g.push(txt(labelW + 8, 24, String(c), { size: 11, weight: 300, fill: C.dim, extra: "letter-spacing:.08em" }));
    else g.push(txt(xOf(i) + numW(i) / 2, 24, String(c), { anchor: "middle", size: 11, weight: 300, fill: C.dim, extra: "letter-spacing:.08em" }));
  });
  g.push(line(0, headerH, w, headerH, C.grid, 1.2));
  rows.forEach((row, r) => {
    const y = headerH + r * rowH;
    const mid = y + rowH / 2;
    // row label (bold-ish) + optional group columns
    g.push(txt(2, mid + 4, cellText(row[0]), { size: 13, weight: 400, fill: C.ink }));
    for (const i of groupIdx) {
      const t = cellText(row[i]);
      if (t) g.push(txt(labelW + 8, mid + 4, t, { size: 12.5, weight: 300, fill: C.mid }));
    }
    for (const i of heatIdx) {
      const v = row[i];
      const cx = xOf(i) + numW(i) / 2;
      if (typeof v === "number" && Number.isFinite(v)) {
        const isPlain = plainSet.has(String(cols[i]));
        if (!isPlain) {
          // full-bleed cell shading — no inset margin
          const a = 0.08 + 0.34 * (Math.abs(v) / maxAbs);
          g.push(rect(xOf(i), y, numW(i), rowH, v > 0 ? C.pos : C.neg, a));
        }
        g.push(
          txt(cx, mid + 4, signed(v, o.unit ?? ""), {
            anchor: "middle",
            size: 12.5,
            weight: 400,
            fill: isPlain ? C.mid : signColor(v),
            extra: "font-variant-numeric:tabular-nums lining-nums",
          }),
        );
      } else if (cellText(v)) {
        g.push(txt(cx, mid + 4, cellText(v), { anchor: "middle", size: 12.5, weight: 300, fill: C.mid }));
      }
    }
    g.push(line(0, y + rowH, w, y + rowH, C.grid, 1));
  });
  g.push("</svg>");
  return g.join("");
}

/**
 * KPI card — accented top border, category label, prominent serif headline
 * value with a small unit beside it, contextual sub-line. One number, said
 * once. `categories[0]` label, `values[0]` headline, `measure` the unit text,
 * `categories[1]` the sub-line.
 */
function kpiCardSvg(spec: ChartSpec, o: FigureOpts): string | null {
  const v = spec.values?.[0];
  if (v == null || !Number.isFinite(v)) return null;
  const label = spec.categories?.[0] ?? "";
  const sub = spec.categories?.[1] ?? "";
  const unit = o.unit ?? "";
  const valueText = fmtNum(v, unit);
  const w = clamp(140 + valueText.length * 34 + unit.length * 11 + label.length * 6.6, 420, 720);
  const valueY = label ? 108 : 84;
  const h = sub ? valueY + 52 : valueY + 20;

  const g: string[] = [svgOpen(w, h, o.label)];
  g.push(rect(0, 0, w, 3, C.neg)); // the accent border
  if (label) g.push(txt(6, 38, label, { size: 15, weight: 300, fill: C.mid, extra: "letter-spacing:.04em" }));
  g.push(
    txt(6, valueY, valueText, {
      size: 72,
      weight: 300,
      serif: true,
      fill: C.ink,
      extra: "font-variant-numeric:tabular-nums lining-nums;letter-spacing:-.03em",
    }),
  );
  if (unit) g.push(txt(6 + valueText.length * 34 + 10, valueY, unit, { size: 20, weight: 300, serif: true, fill: C.mid }));
  if (sub) g.push(txt(6, valueY + 32, sub.length > 68 ? sub.slice(0, 67) + "…" : sub, { size: 14, fill: C.dim }));
  g.push("</svg>");
  return g.join("");
}

/**
 * stat-spark — KPI card with an inline sparkline: headline metric (signed,
 * sign-coloured serif), sub-line percentage, spark path with an endpoint
 * marker dot. Panels (index-aligned svgs) let the client lay several out as
 * a card row. `categories[0]` label, `values[0]` headline, `measure` unit,
 * `categories[1]` sub-line, `series`/`data` the sparkline.
 */
function statSparkSvg(spec: ChartSpec, o: FigureOpts): string | null {
  const v = spec.values?.[0];
  if (v == null || !Number.isFinite(v)) return null;
  const label = spec.categories?.[0] ?? "";
  const sub = spec.categories?.[1] ?? "";
  const spark = (spec.series ?? [])
    .filter((s) => s.points.length)
    .flatMap((s) => s.points.map((p) => p.v))
    .filter(Number.isFinite);
  const w = o.w ?? 360;
  const valueY = 92;
  const bandTop = 128;
  const bandH = 46;
  const h = 200;

  const g: string[] = [svgOpen(w, h, o.label)];
  if (label) g.push(txt(16, 32, label, { size: 13.5, weight: 300, fill: C.mid, extra: "letter-spacing:.04em" }));
  g.push(
    txt(16, valueY, signed(v, o.unit ?? ""), {
      size: 44,
      weight: 300,
      serif: true,
      fill: signColor(v),
      extra: "font-variant-numeric:tabular-nums lining-nums;letter-spacing:-.02em",
    }),
  );
  if (spark.length >= 2) {
    const lo = Math.min(...spark);
    const hi = Math.max(...spark);
    const yOf = (x: number) => (hi > lo ? bandTop + (1 - (x - lo) / (hi - lo)) * bandH : bandTop + bandH / 2);
    const pts = spark.map((x, i) => [16 + (i / (spark.length - 1)) * (w - 46), yOf(x)] as [number, number]);
    g.push(`<path d="${smooth(pts)}" fill="none" style="stroke:${C.slate};stroke-width:1.25;stroke-linecap:round"/>`);
    const [ex, ey] = pts[pts.length - 1];
    g.push(`<circle cx="${rr(ex)}" cy="${rr(ey)}" r="4" style="fill:${signColor(v)}"/>`);
  }
  if (sub) g.push(txt(16, h - 18, sub, { size: 12.5, fill: C.dim }));
  g.push("</svg>");
  return g.join("");
}

/**
 * Render one chart spec to a self-contained SVG string, or null when there is
 * nothing honest to draw (unresolved data token). The hover stylesheet is
 * injected here, once, into any SVG that ships hover elements.
 */
export function renderFigure(spec: ChartSpec, o: FigureOpts = {}): string | null {
  const out = renderKind(spec, o);
  if (!out) return null;
  return /fig-(seg|row)/.test(out) ? out.slice(0, -6) + HOVER_CSS + "</svg>" : out;
}

function renderKind(spec: ChartSpec, o: FigureOpts): string | null {
  if (spec.color) o = { ...o, ink: spec.color };
  if (spec.kind === "kpi-card") return kpiCardSvg(spec, o);
  if (spec.kind === "stat-spark") return statSparkSvg(spec, o);
  if (spec.kind === "table") return tableSvg(spec, o);
  if (spec.kind === "matrix") return matrixSvg(spec, o);
  if ((spec.groups?.length ?? 0) >= 2 && spec.categories?.length) {
    const groups = spec.groups!;
    if (spec.kind === "vbar") return pairedColumnsSvg(spec.categories, groups, o);
    return groupedColumnsSvg(spec.categories, groups, o);
  }
  if (spec.categories?.length && spec.values?.length) {
    if (spec.kind === "vbar" || spec.kind === "gbar") return columnsSvg(spec.categories, spec.values, o);
    // hbar — and the honest fallback for any categorical shape
    return hBarsSvg(spec.categories, spec.values, o);
  }
  const series = (spec.series ?? []).filter((s) => s.points.length);
  if (!series.length) return null;
  if (spec.kind === "vbar") {
    const { xLabels, data } = alignSeries(series);
    if (!data[0]?.length) return null;
    return columnsSvg(xLabels, data[0], o);
  }
  // line | multiline | area — area draws as a plain line (single-line house rule: no wash)
  return lineSvg(series, o);
}

/** Chart data → CSV (figure download / markdown Data block). */
export function figureCsv(spec: ChartSpec): string {
  const q = (x: string) => (/[",\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x);
  const cellStr = (c: unknown): string => (c != null && typeof c === "object" ? String((c as any).text ?? "") : String(c ?? ""));
  if (spec.columns?.length && spec.rows?.length) {
    return [spec.columns, ...spec.rows].map((row) => row.map((c) => q(cellStr(c))).join(",")).join("\n");
  }
  if (spec.categories?.length && spec.groups?.length) {
    return [
      ["category", ...spec.groups.map((g) => g.name)].map(q).join(","),
      ...spec.categories.map((c, i) => [c, ...spec.groups!.map((g) => String(g.values[i] ?? ""))].map(q).join(",")),
    ].join("\n");
  }
  if (spec.categories?.length && spec.values) {
    return [["name", "value"], ...spec.categories.map((c, i) => [c, String(spec.values?.[i] ?? "")])]
      .map((row) => row.map(q).join(","))
      .join("\n");
  }
  const series = (spec.series ?? []).filter((s) => s.points.length);
  if (!series.length) return "";
  const set = new Set<number>();
  for (const s of series) for (const p of s.points) set.add(p.t);
  const ts = [...set].sort((a, b) => a - b);
  const maps = series.map((s) => new Map(s.points.map((p) => [p.t, p.v])));
  const date = (t: number) => new Date(t < 1e12 ? t * 1000 : t).toISOString().slice(0, 10);
  const head = ["date", ...series.map((s) => s.label)].map(q).join(",");
  const rows = ts.map((t) => [date(t), ...maps.map((m) => { const v = m.get(t); return v == null ? "" : String(v); })].map(q).join(","));
  return [head, ...rows].join("\n");
}
