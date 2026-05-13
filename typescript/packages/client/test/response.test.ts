import { afterEach, describe, expect, it, vi } from "vitest";

import { parsePaymentResponse } from "../src/response.js";

describe("parsePaymentResponse", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns undefined when X-PAYMENT-RESPONSE is absent", () => {
    expect(parsePaymentResponse({ headers: { get: () => null } })).toBeUndefined();
  });

  it("decodes UTF-8 payloads in browser-like runtimes without Buffer", () => {
    const payload = {
      exchangeId: "42",
      state: "COMMITTED",
      message: "čokolada",
    };
    const header = Buffer.from(JSON.stringify(payload), "utf8").toString("base64");

    vi.stubGlobal("Buffer", undefined);

    const parsed = parsePaymentResponse({
      headers: { get: () => header },
    });

    expect(parsed).toEqual({
      raw: payload,
      exchangeId: "42",
      state: "COMMITTED",
    });
  });
});
