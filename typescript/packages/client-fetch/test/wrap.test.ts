// Unit tests for `wrapFetchWithPayment`.
//
// Drives the wrapper with a stubbed `fetch` (vitest `Mock`) and a stubbed
// `X402bClient` so the assertions focus on the wrapper's behaviour:
// pass-through on success, retry-with-X-PAYMENT on a 402 carrying
// `scheme: "escrow"`, pass-through on a 402 with no escrow entry, and
// no infinite-retry on a second 402.

import { describe, expect, it, vi, type Mock } from "vitest";
import type { X402bClient } from "@bosonprotocol/x402-client";

import { wrapFetchWithPayment } from "../src/wrap.js";

// Minimal but schema-valid `EscrowPaymentPayload` JSON, base64-encoded
// so the commit-fallback path can decode it through
// `parseEscrowPaymentPayload`. Shape mirrors
// `core/test/schemes/escrow/fixtures.ts:validPayloadNone`.
const VALID_PAYLOAD_JSON = {
  x402Version: 2,
  scheme: "escrow",
  network: "eip155:8453",
  payload: {
    action: "boson-createOfferAndCommit",
    tokenAuthStrategy: "none",
    offerRef: {
      fullOffer: { id: "0", price: "1000000" },
      sellerSig: "0xdeadbeef",
    },
    buyer: "0x2222222222222222222222222222222222222222",
    metaTx: {
      from: "0x2222222222222222222222222222222222222222",
      nonce: "0",
      functionName: "createOfferAndCommit(...)",
      functionSignature: "0xabcd1234",
      sig: { v: 27, r: `0x${"11".repeat(32)}`, s: `0x${"22".repeat(32)}` },
    },
  },
  fulfillment: { option: "inline" },
};

const VALID_PAYLOAD_BASE64 = Buffer.from(JSON.stringify(VALID_PAYLOAD_JSON), "utf8").toString(
  "base64",
);

function makeClient(headerValue = "base64-encoded-payment"): X402bClient & {
  handle402: Mock;
  parsePaymentResponse: Mock;
  signAction: Mock;
} {
  return {
    handle402: vi.fn().mockResolvedValue(headerValue),
    parsePaymentResponse: vi.fn().mockReturnValue(undefined),
    signAction: vi.fn(),
  };
}

function escrow402Body(
  options: {
    withFacilitatorEndpoint?: boolean;
    actionId?: "boson-createOfferAndCommit" | "boson-createOfferCommitAndRedeem";
  } = {},
) {
  const actionId = options.actionId ?? "boson-createOfferAndCommit";
  const channels: string[] = options.withFacilitatorEndpoint
    ? ["server", "facilitator"]
    : ["server"];
  const endpoints: Record<string, string> = { server: "https://example/resource" };
  if (options.withFacilitatorEndpoint) {
    endpoints.facilitator = "https://facilitator.example/settle";
  }
  return {
    x402Version: 2,
    accepts: [
      {
        scheme: "escrow",
        network: "eip155:8453",
        asset: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
        amount: "1000000",
        escrowAddress: "0xdddddddddddddddddddddddddddddddddddddddd",
        recipientId: "did:boson:seller:1",
        maxTimeoutSeconds: 300,
        offer: {
          fullOffer: {},
          sellerSig: "0xdead",
          creator: "0x1111111111111111111111111111111111111111",
        },
        tokenAuthStrategies: ["erc3009"],
        actions: {
          next: [{ id: actionId, channels, endpoints }],
        },
      },
    ],
  };
}

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    ...init,
  });
}

describe("wrapFetchWithPayment", () => {
  it("passes a 200 through without consulting the client", async () => {
    const fakeFetch = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));
    const client = makeClient();
    const wrapped = wrapFetchWithPayment(fakeFetch, client);

    const res = await wrapped("https://example/resource");

    expect(res.status).toBe(200);
    expect(fakeFetch).toHaveBeenCalledTimes(1);
    expect(client.handle402).not.toHaveBeenCalled();
  });

  it("on 402 with escrow accept entry: signs via handle402 and retries with X-PAYMENT", async () => {
    const client = makeClient("hdr-base64");
    const fakeFetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(escrow402Body(), { status: 402 }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));

    const wrapped = wrapFetchWithPayment(fakeFetch, client);
    const res = await wrapped("https://example/resource");

    expect(res.status).toBe(200);
    expect(fakeFetch).toHaveBeenCalledTimes(2);
    expect(client.handle402).toHaveBeenCalledTimes(1);
    expect(client.handle402.mock.calls[0][0]).toMatchObject({ scheme: "escrow" });

    const retryRequest = fakeFetch.mock.calls[1][0] as Request;
    expect(retryRequest.headers.get("X-PAYMENT")).toBe("hdr-base64");
  });

  it("preserves the request URL, method, and existing headers/body on the retry", async () => {
    const client = makeClient("hdr");
    const fakeFetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(escrow402Body(), { status: 402 }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));

    const wrapped = wrapFetchWithPayment(fakeFetch, client);
    await wrapped("https://example/resource", {
      method: "POST",
      headers: { "x-trace-id": "abc" },
      body: '{"foo":1}',
    });

    const retryRequest = fakeFetch.mock.calls[1][0] as Request;
    expect(retryRequest.url).toBe("https://example/resource");
    expect(retryRequest.method).toBe("POST");
    expect(await retryRequest.text()).toBe('{"foo":1}');
    expect(retryRequest.headers.get("x-trace-id")).toBe("abc");
    expect(retryRequest.headers.get("X-PAYMENT")).toBe("hdr");
  });

  it("can retry a Request input after the initial fetch consumes its body", async () => {
    const client = makeClient("hdr");
    const bodies: string[] = [];
    const retryHeaders: string[] = [];
    const fakeFetch = vi.fn(async (input: RequestInfo | URL) => {
      const request = input instanceof Request ? input : new Request(input);
      bodies.push(await request.text());
      retryHeaders.push(request.headers.get("X-PAYMENT") ?? "");

      if (bodies.length === 1) {
        return jsonResponse(escrow402Body(), { status: 402 });
      }
      return new Response("ok", { status: 200 });
    });

    const wrapped = wrapFetchWithPayment(fakeFetch, client);
    const request = new Request("https://example/resource", {
      method: "POST",
      headers: { "x-trace-id": "abc" },
      body: "streamed-payload",
    });

    const res = await wrapped(request);

    expect(res.status).toBe(200);
    expect(fakeFetch).toHaveBeenCalledTimes(2);
    expect(bodies).toEqual(["streamed-payload", "streamed-payload"]);
    expect(retryHeaders).toEqual(["", "hdr"]);
    const retryRequest = fakeFetch.mock.calls[1][0] as Request;
    expect(retryRequest.headers.get("x-trace-id")).toBe("abc");
  });

  it("passes a 402 through unchanged when no accepts[] entry has scheme='escrow'", async () => {
    const body = { x402Version: 2, accepts: [{ scheme: "exact", network: "eip155:8453" }] };
    const client = makeClient();
    const fakeFetch = vi.fn().mockResolvedValue(jsonResponse(body, { status: 402 }));

    const wrapped = wrapFetchWithPayment(fakeFetch, client);
    const res = await wrapped("https://example/resource");

    expect(res.status).toBe(402);
    expect(fakeFetch).toHaveBeenCalledTimes(1);
    expect(client.handle402).not.toHaveBeenCalled();
  });

  it("passes a 402 through unchanged when the body is not JSON", async () => {
    const client = makeClient();
    const fakeFetch = vi.fn().mockResolvedValue(
      new Response("not json", {
        status: 402,
        headers: { "content-type": "text/plain" },
      }),
    );

    const wrapped = wrapFetchWithPayment(fakeFetch, client);
    const res = await wrapped("https://example/resource");

    expect(res.status).toBe(402);
    expect(fakeFetch).toHaveBeenCalledTimes(1);
    expect(client.handle402).not.toHaveBeenCalled();
  });

  it("does not re-retry on a second 402 (no infinite loop)", async () => {
    const client = makeClient();
    const fakeFetch = vi.fn().mockResolvedValue(jsonResponse(escrow402Body(), { status: 402 }));

    const wrapped = wrapFetchWithPayment(fakeFetch, client);
    const res = await wrapped("https://example/resource");

    expect(res.status).toBe(402);
    // initial + 1 retry = 2, never more
    expect(fakeFetch).toHaveBeenCalledTimes(2);
    expect(client.handle402).toHaveBeenCalledTimes(1);
  });
});

describe("wrapFetchWithPayment — commit fallback (opt-in)", () => {
  function settleOkBody(): { ok: true; exchangeId: string; txHash: string } {
    return { ok: true, exchangeId: "42", txHash: "0xdeadbeef" };
  }

  it("default (commitFallback off): resource-server 5xx after X-PAYMENT bubbles up unchanged", async () => {
    const client = makeClient(VALID_PAYLOAD_BASE64);
    const fakeFetch = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(escrow402Body({ withFacilitatorEndpoint: true }), { status: 402 }),
      )
      .mockResolvedValueOnce(new Response("boom", { status: 502 }));

    const wrapped = wrapFetchWithPayment(fakeFetch, client);
    const res = await wrapped("https://example/resource");

    expect(res.status).toBe(502);
    expect(fakeFetch).toHaveBeenCalledTimes(2);
    // No call to the facilitator URL.
    expect(
      fakeFetch.mock.calls.some(
        (c) => String(c[0] as Request | URL | string) === "https://facilitator.example/settle",
      ),
    ).toBe(false);
  });

  it("commitFallback='auto': resource-server 5xx triggers facilitator settle, returns synthesized 200", async () => {
    const client = makeClient(VALID_PAYLOAD_BASE64);
    const fakeFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.startsWith("https://example/resource")) {
        if (fakeFetch.mock.calls.length === 1) {
          return jsonResponse(escrow402Body({ withFacilitatorEndpoint: true }), { status: 402 });
        }
        return new Response("boom", { status: 502 });
      }
      if (url.startsWith("https://facilitator.example/settle")) {
        return jsonResponse(settleOkBody(), { status: 200 });
      }
      return new Response("unexpected", { status: 500 });
    });

    const wrapped = wrapFetchWithPayment(fakeFetch, client, { commitFallback: "auto" });
    const res = await wrapped("https://example/resource");

    expect(res.status).toBe(200);
    expect(res.headers.get("X-X402-Boson-Commit-Channel")).toBe("facilitator");
    expect(res.headers.get("X-X402-Boson-Server-Error")).toBe("502");
    expect(res.headers.get("X-PAYMENT-RESPONSE")).toBeTruthy();
    expect(await res.text()).toBe("");

    // initial 402 + X-PAYMENT retry (502) + facilitator settle (200) = 3
    expect(fakeFetch).toHaveBeenCalledTimes(3);
  });

  it("commitFallback='auto': X-PAYMENT-RESPONSE header decodes to {exchangeId, txHash, nextActions.exchangeState}", async () => {
    const client = makeClient(VALID_PAYLOAD_BASE64);
    const fakeFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.startsWith("https://example/resource")) {
        if (fakeFetch.mock.calls.length === 1) {
          return jsonResponse(escrow402Body({ withFacilitatorEndpoint: true }), { status: 402 });
        }
        return new Response("boom", { status: 502 });
      }
      return jsonResponse(settleOkBody(), { status: 200 });
    });

    const wrapped = wrapFetchWithPayment(fakeFetch, client, { commitFallback: "auto" });
    const res = await wrapped("https://example/resource");

    const headerValue = res.headers.get("X-PAYMENT-RESPONSE")!;
    const decoded = JSON.parse(Buffer.from(headerValue, "base64").toString("utf8"));
    expect(decoded).toEqual({
      exchangeId: "42",
      txHash: "0xdeadbeef",
      nextActions: { exchangeState: "COMMITTED" },
    });
  });

  it("commitFallback='auto': createOfferCommitAndRedeem fallback reports exchangeState=REDEEMED", async () => {
    // The atomic commit-and-redeem flow lands the exchange in REDEEMED, not
    // COMMITTED — the synthesized X-PAYMENT-RESPONSE must reflect that.
    const client = makeClient(VALID_PAYLOAD_BASE64);
    const fakeFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.startsWith("https://example/resource")) {
        if (fakeFetch.mock.calls.length === 1) {
          return jsonResponse(
            escrow402Body({
              withFacilitatorEndpoint: true,
              actionId: "boson-createOfferCommitAndRedeem",
            }),
            { status: 402 },
          );
        }
        return new Response("boom", { status: 502 });
      }
      return jsonResponse(settleOkBody(), { status: 200 });
    });

    const wrapped = wrapFetchWithPayment(fakeFetch, client, { commitFallback: "auto" });
    const res = await wrapped("https://example/resource");

    const headerValue = res.headers.get("X-PAYMENT-RESPONSE")!;
    const decoded = JSON.parse(Buffer.from(headerValue, "base64").toString("utf8"));
    expect(decoded.nextActions).toEqual({ exchangeState: "REDEEMED" });
  });

  it("commitFallback='auto': network error on retry triggers fallback, marker carries network: prefix", async () => {
    const client = makeClient(VALID_PAYLOAD_BASE64);
    const fakeFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.startsWith("https://example/resource")) {
        if (fakeFetch.mock.calls.length === 1) {
          return jsonResponse(escrow402Body({ withFacilitatorEndpoint: true }), { status: 402 });
        }
        throw new TypeError("connect ECONNREFUSED");
      }
      return jsonResponse(settleOkBody(), { status: 200 });
    });

    const wrapped = wrapFetchWithPayment(fakeFetch, client, { commitFallback: "auto" });
    const res = await wrapped("https://example/resource");

    expect(res.status).toBe(200);
    expect(res.headers.get("X-X402-Boson-Commit-Channel")).toBe("facilitator");
    expect(res.headers.get("X-X402-Boson-Server-Error")).toContain("network:");
  });

  it("commitFallback='auto' but no facilitator endpoint advertised: surfaces the original 5xx unchanged", async () => {
    const client = makeClient(VALID_PAYLOAD_BASE64);
    const fakeFetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(escrow402Body(), { status: 402 }))
      .mockResolvedValueOnce(new Response("boom", { status: 502 }));

    const wrapped = wrapFetchWithPayment(fakeFetch, client, { commitFallback: "auto" });
    const res = await wrapped("https://example/resource");

    expect(res.status).toBe(502);
    expect(fakeFetch).toHaveBeenCalledTimes(2);
  });

  it("commitFallback='auto': facilitator also fails → original 5xx surfaces", async () => {
    const client = makeClient(VALID_PAYLOAD_BASE64);
    const fakeFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.startsWith("https://example/resource")) {
        if (fakeFetch.mock.calls.length === 1) {
          return jsonResponse(escrow402Body({ withFacilitatorEndpoint: true }), { status: 402 });
        }
        return new Response("server down", { status: 502 });
      }
      return new Response("facilitator down", { status: 503 });
    });

    const wrapped = wrapFetchWithPayment(fakeFetch, client, { commitFallback: "auto" });
    const res = await wrapped("https://example/resource");

    expect(res.status).toBe(502);
    expect(await res.text()).toBe("server down");
  });

  it("commitFallback='auto': network error + facilitator also fails → 599 carries network: marker", async () => {
    const client = makeClient(VALID_PAYLOAD_BASE64);
    const fakeFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.startsWith("https://example/resource")) {
        if (fakeFetch.mock.calls.length === 1) {
          return jsonResponse(escrow402Body({ withFacilitatorEndpoint: true }), { status: 402 });
        }
        throw new TypeError("connect ECONNREFUSED");
      }
      return new Response("facilitator down", { status: 503 });
    });

    const wrapped = wrapFetchWithPayment(fakeFetch, client, { commitFallback: "auto" });
    const res = await wrapped("https://example/resource");

    expect(res.status).toBe(599);
    expect(res.headers.get("X-X402-Boson-Server-Error")).toBe("network:connect ECONNREFUSED");
  });

  it("commitFallback='auto': resource-server 4xx does NOT trigger fallback (only 5xx)", async () => {
    const client = makeClient(VALID_PAYLOAD_BASE64);
    const fakeFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.startsWith("https://example/resource")) {
        if (fakeFetch.mock.calls.length === 1) {
          return jsonResponse(escrow402Body({ withFacilitatorEndpoint: true }), { status: 402 });
        }
        return new Response("bad payload", { status: 400 });
      }
      return jsonResponse(settleOkBody(), { status: 200 });
    });

    const wrapped = wrapFetchWithPayment(fakeFetch, client, { commitFallback: "auto" });
    const res = await wrapped("https://example/resource");

    expect(res.status).toBe(400);
    // initial + retry = 2; no facilitator call.
    expect(fakeFetch).toHaveBeenCalledTimes(2);
  });

  it("commitFallback='auto': retry success (200) is returned untouched — no fallback path", async () => {
    const client = makeClient(VALID_PAYLOAD_BASE64);
    const fakeFetch = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(escrow402Body({ withFacilitatorEndpoint: true }), { status: 402 }),
      )
      .mockResolvedValueOnce(new Response("resource-body", { status: 200 }));

    const wrapped = wrapFetchWithPayment(fakeFetch, client, { commitFallback: "auto" });
    const res = await wrapped("https://example/resource");

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("resource-body");
    expect(res.headers.get("X-X402-Boson-Commit-Channel")).toBeNull();
    expect(fakeFetch).toHaveBeenCalledTimes(2);
  });
});
