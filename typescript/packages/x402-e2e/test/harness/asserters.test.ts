// Unit tests for the harness asserters. Stubs the `ExchangeReader` so
// no subgraph is needed.

import { ExchangeState } from "@bosonprotocol/x402-actions";
import type { ExchangeReader, ExchangeSnapshot } from "@bosonprotocol/x402-server";
import { describe, expect, it } from "vitest";

import { createOnchainAsserter } from "../../src/harness/onchain-asserter.js";
import {
  decodeXPaymentResponse,
  readXPaymentResponse,
} from "../../src/harness/x-payment-response-asserter.js";

const SELLER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as const;
const TOKEN = "0x70e0bA845a1A0F2DA3359C97E0285013525FFC49" as const;

function readerFromQueue(snapshots: readonly (ExchangeSnapshot | null)[]): ExchangeReader {
  let i = 0;
  return {
    read: async () => snapshots[Math.min(i++, snapshots.length - 1)] ?? null,
  };
}

describe("OnchainAsserter", () => {
  it("snapshot() forwards to the underlying reader", async () => {
    const snapshot: ExchangeSnapshot = {
      state: ExchangeState.COMMITTED,
      seller: SELLER,
      exchangeToken: TOKEN,
      price: "1000000",
    };
    const asserter = createOnchainAsserter(readerFromQueue([snapshot]));
    expect(await asserter.snapshot("42")).toEqual(snapshot);
  });

  it("expect() resolves once the snapshot matches", async () => {
    const snapshot: ExchangeSnapshot = {
      state: ExchangeState.COMMITTED,
      seller: SELLER,
      exchangeToken: TOKEN,
      price: "1000000",
    };
    const asserter = createOnchainAsserter(readerFromQueue([null, null, snapshot]));
    const result = await asserter.expect("42", {
      state: ExchangeState.COMMITTED,
      seller: SELLER,
      exchangeToken: TOKEN,
      price: "1000000",
      attempts: 5,
      delayMs: 1,
    });
    expect(result).toEqual(snapshot);
  });

  it("expect() throws a structured error after the retry budget", async () => {
    const asserter = createOnchainAsserter(readerFromQueue([null]));
    await expect(
      asserter.expect("42", {
        state: ExchangeState.COMMITTED,
        seller: SELLER,
        exchangeToken: TOKEN,
        price: "1000000",
        attempts: 2,
        delayMs: 1,
      }),
    ).rejects.toThrow(/OnchainAsserter\.expect\(42\) failed after 2 attempts/);
  });

  it("expect() surfaces field mismatches in the thrown message", async () => {
    const wrong: ExchangeSnapshot = {
      state: ExchangeState.REDEEMED,
      seller: SELLER,
      exchangeToken: TOKEN,
      price: "1000000",
    };
    const asserter = createOnchainAsserter(readerFromQueue([wrong]));
    await expect(
      asserter.expect("42", {
        state: ExchangeState.COMMITTED,
        seller: SELLER,
        exchangeToken: TOKEN,
        price: "1000000",
        attempts: 1,
        delayMs: 1,
      }),
    ).rejects.toThrow(/STATE_MISMATCH/);
  });
});

describe("decodeXPaymentResponse", () => {
  it("decodes a base64-encoded JSON payload", () => {
    const body = { exchangeId: "42", txHash: "0xdead" };
    const encoded = Buffer.from(JSON.stringify(body), "utf8").toString("base64");
    expect(decodeXPaymentResponse(encoded)).toEqual(body);
  });

  it("returns null for absent header values", () => {
    expect(decodeXPaymentResponse(null)).toBeNull();
    expect(decodeXPaymentResponse(undefined)).toBeNull();
    expect(decodeXPaymentResponse("")).toBeNull();
  });

  it("returns null for non-base64 garbage", () => {
    expect(decodeXPaymentResponse("not-base64-json")).toBeNull();
  });
});

describe("readXPaymentResponse", () => {
  const body = { exchangeId: "42", nextActions: { exchangeId: "42" } };
  const encoded = Buffer.from(JSON.stringify(body), "utf8").toString("base64");

  it("works against Fetch-style Headers", () => {
    const headers = new Headers({ "X-PAYMENT-RESPONSE": encoded });
    expect(readXPaymentResponse(headers)?.exchangeId).toBe("42");
  });

  it("works against supertest-style header maps (case-insensitive key)", () => {
    const headers = { "x-payment-response": encoded };
    expect(readXPaymentResponse(headers)?.exchangeId).toBe("42");
  });

  it("returns null when the header is missing", () => {
    expect(readXPaymentResponse(new Headers())).toBeNull();
    expect(readXPaymentResponse({})).toBeNull();
  });
});
