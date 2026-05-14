// HTTP-transport tests for `createFacilitatorClient`. The fetch
// implementation is stubbed per-test so we exercise the request
// shape (URL, method, headers, body) and the response branching
// (success / domain `{ok:false}` / HTTP error → throws
// FacilitatorHttpError) without standing up a real facilitator.

import { describe, expect, it } from "vitest";

import {
  createFacilitatorClient,
  FacilitatorHttpError,
  type FacilitatorPerformActionInput,
  type FacilitatorSettleInput,
  type FacilitatorVerifyInput,
  type FetchLike,
} from "../src/index.js";

const BASE_URL = "https://facilitator.example";
const NETWORK = "eip155:8453" as const;
const ESCROW = "0xdddddddddddddddddddddddddddddddddddddddd" as const;

function makeStubFetch(
  handler: (req: { url: string; init: Parameters<FetchLike>[1] }) => {
    status?: number;
    body?: unknown;
    textOverride?: string;
    throwError?: unknown;
  },
): { fetch: FetchLike; calls: Array<{ url: string; init: Parameters<FetchLike>[1] }> } {
  const calls: Array<{ url: string; init: Parameters<FetchLike>[1] }> = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init });
    const result = handler({ url, init });
    if (result.throwError !== undefined) throw result.throwError;
    const status = result.status ?? 200;
    const text =
      result.textOverride !== undefined
        ? result.textOverride
        : result.body !== undefined
          ? JSON.stringify(result.body)
          : "";
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => text,
    };
  };
  return { fetch, calls };
}

const verifyInput: FacilitatorVerifyInput = {
  scheme: "escrow",
  network: NETWORK,
  payload: {
    x402Version: 2,
    scheme: "escrow",
    network: NETWORK,
    payload: {
      action: "boson-createOfferAndCommit",
      tokenAuthStrategy: "none",
      offerRef: { fullOffer: {}, sellerSig: "0x00" },
      buyer: "0x1111111111111111111111111111111111111111",
      metaTx: {
        from: "0x1111111111111111111111111111111111111111",
        nonce: "1",
        functionName: "createOfferAndCommit(...)",
        functionSignature: "0xdeadbeef",
        sig: { v: 27, r: `0x${"00".repeat(32)}`, s: `0x${"00".repeat(32)}` },
      },
    },
  },
  requirements: {
    scheme: "escrow",
    network: NETWORK,
    asset: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
    amount: "1000000",
    escrowAddress: ESCROW,
    recipientId: "did:boson:seller:1",
    maxTimeoutSeconds: 300,
    offer: {
      fullOffer: {},
      sellerSig: "0x00",
      creator: "0x1111111111111111111111111111111111111111",
    },
    tokenAuthStrategies: ["none"],
    actions: {
      next: [
        {
          id: "boson-createOfferAndCommit",
          channels: ["server", "facilitator", "onchain"],
        },
      ],
    },
  },
};

const settleInput: FacilitatorSettleInput = verifyInput;

const performActionInput: FacilitatorPerformActionInput = {
  network: NETWORK,
  escrowAddress: ESCROW,
  exchangeId: "42",
  action: "boson-completeExchange",
  signedPayload: "0xc0ffee",
};

describe("createFacilitatorClient", () => {
  it("POSTs `/verify` with JSON body and returns the parsed result", async () => {
    const stub = makeStubFetch(() => ({ body: { ok: true } }));
    const client = createFacilitatorClient({ url: BASE_URL, fetch: stub.fetch });

    const result = await client.verify(verifyInput);

    expect(result).toEqual({ ok: true });
    expect(stub.calls).toHaveLength(1);
    expect(stub.calls[0]!.url).toBe(`${BASE_URL}/verify`);
    expect(stub.calls[0]!.init?.method).toBe("POST");
    expect(stub.calls[0]!.init?.headers?.["content-type"]).toBe("application/json");
    expect(JSON.parse(stub.calls[0]!.init!.body!)).toEqual(verifyInput);
  });

  it("returns domain `{ok:false}` from /verify verbatim", async () => {
    const stub = makeStubFetch(() => ({
      body: { ok: false, code: "BAD_META_TX_SIGNATURE", reason: "sig mismatch" },
    }));
    const client = createFacilitatorClient({ url: BASE_URL, fetch: stub.fetch });

    const result = await client.verify(verifyInput);

    expect(result).toEqual({
      ok: false,
      code: "BAD_META_TX_SIGNATURE",
      reason: "sig mismatch",
    });
  });

  it("POSTs `/settle` and returns `{exchangeId, txHash}`", async () => {
    const stub = makeStubFetch(() => ({
      body: { ok: true, exchangeId: "100", txHash: "0xabc" },
    }));
    const client = createFacilitatorClient({ url: BASE_URL, fetch: stub.fetch });

    const result = await client.settle(settleInput);

    expect(result).toEqual({ ok: true, exchangeId: "100", txHash: "0xabc" });
    expect(stub.calls[0]!.url).toBe(`${BASE_URL}/settle`);
  });

  it("POSTs `/perform-action?action=<action>` with the action-specific input shape", async () => {
    const stub = makeStubFetch(() => ({
      body: {
        ok: true,
        txHash: "0xdef",
        newExchangeState: "COMPLETED",
      },
    }));
    const client = createFacilitatorClient({ url: BASE_URL, fetch: stub.fetch });

    const result = await client.performAction(performActionInput);

    expect(result).toMatchObject({ ok: true, txHash: "0xdef", newExchangeState: "COMPLETED" });
    expect(stub.calls[0]!.url).toBe(`${BASE_URL}/perform-action?action=boson-completeExchange`);
    expect(JSON.parse(stub.calls[0]!.init!.body!)).toEqual(performActionInput);
  });

  it("throws FacilitatorHttpError(NETWORK_ERROR) when fetch rejects", async () => {
    const stub = makeStubFetch(() => ({ throwError: new Error("ECONNREFUSED") }));
    const client = createFacilitatorClient({ url: BASE_URL, fetch: stub.fetch });

    await expect(client.verify(verifyInput)).rejects.toMatchObject({
      name: "FacilitatorHttpError",
      code: "NETWORK_ERROR",
    });
  });

  it("throws FacilitatorHttpError(BAD_HTTP_STATUS) on 5xx, carrying facilitatorCode if present", async () => {
    const stub = makeStubFetch(() => ({
      status: 500,
      body: { ok: false, code: "INTERNAL_ERROR", reason: "boom" },
    }));
    const client = createFacilitatorClient({ url: BASE_URL, fetch: stub.fetch });

    await expect(client.settle(settleInput)).rejects.toBeInstanceOf(FacilitatorHttpError);
    try {
      await client.settle(settleInput);
    } catch (e) {
      expect((e as FacilitatorHttpError).code).toBe("BAD_HTTP_STATUS");
      expect((e as FacilitatorHttpError).status).toBe(500);
      expect((e as FacilitatorHttpError).facilitatorCode).toBe("INTERNAL_ERROR");
    }
  });

  it("throws FacilitatorHttpError(BAD_RESPONSE_BODY) on non-JSON 200", async () => {
    const stub = makeStubFetch(() => ({ status: 200, textOverride: "<html>oops</html>" }));
    const client = createFacilitatorClient({ url: BASE_URL, fetch: stub.fetch });

    await expect(client.verify(verifyInput)).rejects.toMatchObject({
      name: "FacilitatorHttpError",
      code: "BAD_RESPONSE_BODY",
      status: 200,
    });
  });

  it("strips a trailing slash from `url`", async () => {
    const stub = makeStubFetch(() => ({ body: { ok: true } }));
    const client = createFacilitatorClient({ url: `${BASE_URL}/`, fetch: stub.fetch });

    await client.verify(verifyInput);

    expect(stub.calls[0]!.url).toBe(`${BASE_URL}/verify`);
  });

  it("attaches caller-supplied headers to every request", async () => {
    const stub = makeStubFetch(() => ({ body: { ok: true } }));
    const client = createFacilitatorClient({
      url: BASE_URL,
      fetch: stub.fetch,
      headers: { authorization: "Bearer token-123" },
    });

    await client.verify(verifyInput);

    expect(stub.calls[0]!.init?.headers?.authorization).toBe("Bearer token-123");
  });

  it("throws synchronously if neither global fetch nor an opts.fetch is available", () => {
    const originalFetch = globalThis.fetch;
    try {
      // @ts-expect-error — intentionally erasing global fetch for this test.
      delete globalThis.fetch;
      expect(() => createFacilitatorClient({ url: BASE_URL })).toThrow(/no `fetch`/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
