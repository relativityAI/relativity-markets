import { describe, it, expect } from "vitest";
import { classifyModelError } from "../modelcheck.js";

describe("unreachable endpoint", () => {
  it("maps connection failures to actionable advice", () => {
    const sdk = classifyModelError(Object.assign(new Error("Connection error."), { cause: new Error("fetch failed") }));
    expect(sdk.reason).toBe("server_error");
    expect(sdk.message).toMatch(/Couldn't reach the provider/);
    expect(sdk.retryable).toBe(false);

    // node buries the code in cause.code (Ollama stopped / wrong base URL)
    const refused = classifyModelError(
      Object.assign(new Error("fetch failed"), { cause: { code: "ECONNREFUSED" } }),
    );
    expect(refused.message).toMatch(/Couldn't reach the provider/);
  });
});
