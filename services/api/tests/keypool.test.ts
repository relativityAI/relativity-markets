import { describe, it, expect } from "vitest";
import { KeyPool } from "../keypool.js";
import { DEFAULT_DAILY_REQUESTS } from "../config.js";

describe("default model with no keys", () => {
  it("has no default model because nothing is runnable", () => {
    const pool = new KeyPool({
      serverKeys: {},
      dailyCaps: DEFAULT_DAILY_REQUESTS,
    });
    expect(pool.getDefaultModel({})).toBe("");
  });
});
