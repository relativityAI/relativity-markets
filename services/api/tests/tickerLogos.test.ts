import { describe, it, expect } from "vitest";
import { isNseSymbol } from "../discovery.js";
import { tickerLogoUrl, tickerLogoDataUri } from "../tickerLogos.js";

// dharun's exact "not found" payload: blue square + <text>NO</text>.
const PLACEHOLDER = '<svg viewBox="0 0 18 18"><path fill="#2248ff"/><text x="9" y="9">NO</text></svg>';
const REAL_LOGO = '<svg viewBox="0 0 18 18"><path fill="#2248ff"/><path d="M0 0h18v18H0z"/></svg>';

function withFetch(handler: (url: string) => Response | null, fn: () => Promise<void>): Promise<void> {
  const orig = globalThis.fetch;
  globalThis.fetch = (async (input: any) =>
    handler(String(input)) ?? new Response("nope", { status: 404 })) as typeof fetch;
  return fn().finally(() => {
    globalThis.fetch = orig;
  });
}

describe("market routing", () => {
  it("sends NSE symbols to dharun, everything else to logoapi.sh", async () => {
    expect(isNseSymbol("RELIANCE")).toBe(true);
    expect(isNseSymbol("NVDA")).toBe(false);

    await withFetch(
      () => new Response(REAL_LOGO, { status: 200, headers: { "content-type": "image/svg+xml" } }),
      async () => {
        // US symbols are returned unverified — no fetch on this path.
        expect(await tickerLogoUrl("NVDA")).toBe("https://logoapi.sh/ticker/NVDA.svg");
        expect(await tickerLogoUrl("BRK.B")).toBe("https://logoapi.sh/ticker/BRK.B.svg");
        expect(await tickerLogoUrl("RELIANCE")).toBe("https://api.dharun.dev/v1/logos/RELIANCE");
        expect(await tickerLogoUrl("RELIANCE.NS")).toBe("https://api.dharun.dev/v1/logos/RELIANCE");
        expect(await tickerLogoUrl("")).toBe(null);
      }
    );
  });

  it("treats dharun's NO placeholder as a miss", async () => {
    await withFetch(
      () => new Response(PLACEHOLDER, { status: 200, headers: { "content-type": "image/svg+xml" } }),
      async () => {
        expect(await tickerLogoUrl("RELIANCE")).toBe(null);
        expect(await tickerLogoDataUri("RELIANCE")).toBe(null);
      }
    );
  });
});

describe("pdf data uri", () => {
  it("embeds the .png variant as a data URI", async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const urls: string[] = [];
    await withFetch((url) => {
      urls.push(url);
      if (url.endsWith(".png"))
        return new Response(png, { status: 200, headers: { "content-type": "image/png" } });
      return new Response(REAL_LOGO, { status: 200, headers: { "content-type": "image/svg+xml" } });
    }, async () => {
      const uri = await tickerLogoDataUri("NVDA");
      expect(uri).toMatch(/^data:image\/png;base64,/);
      expect(urls).toEqual(["https://logoapi.sh/ticker/NVDA.png"]);
    });
  });
});
