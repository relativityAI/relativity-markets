// One font source for the PDF: Newsreader (display) + Anek Latin (body),
// the same two faces the app ships. TTFs are vendored in ./fonts (run
// scripts/fetch-pdf-fonts.sh to refresh) so generation never hits the network.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = dirname(fileURLToPath(import.meta.url));

const FILES = [
  "Newsreader-Regular.ttf",
  "Newsreader-Italic.ttf",
  "Newsreader-SemiBold.ttf",
  "Newsreader-Bold.ttf",
  "AnekLatin-Light.ttf",
  "AnekLatin-Regular.ttf",
  "AnekLatin-Medium.ttf",
  "AnekLatin-SemiBold.ttf",
] as const;

let cache: { vfs: Record<string, string>; paths: string[] } | null = null;

function load(): { vfs: Record<string, string>; paths: string[] } {
  if (cache) return cache;
  const vfs: Record<string, string> = {};
  const paths: string[] = [];
  for (const f of FILES) {
    const p = join(DIR, "fonts", f);
    const buf = readFileSync(p);
    vfs[f] = buf.toString("base64");
    paths.push(p);
  }
  cache = { vfs, paths };
  return cache;
}

/** pdfmake vfs entries for these faces (keyed by filename). */
export function pdfFontVfs(): Record<string, string> {
  return load().vfs;
}

/** pdfmake `fonts` definition — family name → face filenames. */
export const PDF_FONTS = {
  Anek: {
    normal: "AnekLatin-Regular.ttf",
    bold: "AnekLatin-SemiBold.ttf",
    italics: "Newsreader-Italic.ttf",
    bolditalics: "Newsreader-SemiBold.ttf",
  },
  Newsreader: {
    normal: "Newsreader-Regular.ttf",
    bold: "Newsreader-Bold.ttf",
    italics: "Newsreader-Italic.ttf",
    bolditalics: "Newsreader-SemiBold.ttf",
  },
} as const;

/** Font file paths + family names for resvg (chart rasterization). */
export function resvgFontOptions(): { fontFiles: string[]; defaultFontFamily: string; loadSystemFonts: boolean } {
  return { fontFiles: load().paths, defaultFontFamily: "Anek Latin", loadSystemFonts: false };
}
