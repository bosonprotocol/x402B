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

function escrow402Body() {
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
        actions: { next: [{ id: "boson-createOfferAndCommit", channels: ["server"] }] },
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
