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

  it("lifts a non-DISPUTED { exchange } shape from nextActions", () => {
    const payload = {
      exchangeId: "42",
      txHash: "0xabc",
      nextActions: {
        exchangeId: "42",
        exchangeState: "REDEEMED",
        next: [],
        fallback: { channel: "facilitator" },
      },
    };
    const header = Buffer.from(JSON.stringify(payload), "utf8").toString("base64");

    const parsed = parsePaymentResponse({
      headers: { get: () => header },
    });

    expect(parsed?.exchangeId).toBe("42");
    expect(parsed?.state).toEqual({ exchange: "REDEEMED" });
  });

  it("lifts a DISPUTED { exchange, dispute } shape from nextActions", () => {
    const payload = {
      exchangeId: "7",
      txHash: "0xdef",
      nextActions: {
        exchangeId: "7",
        exchangeState: "DISPUTED",
        disputeState: "RESOLVING",
        next: [],
        fallback: { channel: "facilitator" },
      },
    };
    const header = Buffer.from(JSON.stringify(payload), "utf8").toString("base64");

    const parsed = parsePaymentResponse({
      headers: { get: () => header },
    });

    expect(parsed?.state).toEqual({ exchange: "DISPUTED", dispute: "RESOLVING" });
  });

  it("does not lift DISPUTED nextActions without a disputeState", () => {
    const payload = {
      exchangeId: "8",
      txHash: "0xaaa",
      nextActions: {
        exchangeId: "8",
        exchangeState: "DISPUTED",
        next: [],
      },
    };
    const header = Buffer.from(JSON.stringify(payload), "utf8").toString("base64");

    const parsed = parsePaymentResponse({
      headers: { get: () => header },
    });

    expect(parsed?.exchangeId).toBe("8");
    expect(parsed?.state).toBeUndefined();
  });

  it("prefers top-level state over nextActions.exchangeState", () => {
    const payload = {
      exchangeId: "1",
      state: "COMMITTED",
      nextActions: {
        exchangeId: "1",
        exchangeState: "REDEEMED",
        next: [],
      },
    };
    const header = Buffer.from(JSON.stringify(payload), "utf8").toString("base64");

    const parsed = parsePaymentResponse({
      headers: { get: () => header },
    });

    expect(parsed?.state).toBe("COMMITTED");
  });

  it("does not crash on a garbage nextActions value", () => {
    const payload = {
      exchangeId: "9",
      nextActions: 42,
    };
    const header = Buffer.from(JSON.stringify(payload), "utf8").toString("base64");

    const parsed = parsePaymentResponse({
      headers: { get: () => header },
    });

    expect(parsed?.exchangeId).toBe("9");
    expect(parsed?.state).toBeUndefined();
  });
});
