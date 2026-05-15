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

const performActionEntityKeyedInput: FacilitatorPerformActionInput = {
  network: NETWORK,
  escrowAddress: ESCROW,
  entityId: "42",
  action: "boson-withdrawFunds",
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
    // `retry: { attempts: 1 }` keeps this test focused on the single-call
    // error mapping rather than the retry policy. Retry behaviour is
    // covered separately below.
    const client = createFacilitatorClient({
      url: BASE_URL,
      fetch: stub.fetch,
      retry: { attempts: 1, backoffMs: 0 },
    });

    await expect(client.verify(verifyInput)).rejects.toMatchObject({
      name: "FacilitatorHttpError",
      code: "NETWORK_ERROR",
    });
  });

  it("throws FacilitatorHttpError(BAD_RESPONSE_BODY) on 5xx with a non-JSON body", async () => {
    // Non-2xx + body that doesn't parse as a well-formed facilitator
    // result is a transport-layer fault — surface it as
    // FacilitatorHttpError so the caller maps it to FACILITATOR_UNREACHABLE.
    const stub = makeStubFetch(() => ({ status: 500, textOverride: "oops" }));
    const client = createFacilitatorClient({ url: BASE_URL, fetch: stub.fetch });

    await expect(client.settle(settleInput)).rejects.toBeInstanceOf(FacilitatorHttpError);
    try {
      await client.settle(settleInput);
    } catch (e) {
      // Non-JSON body trips the JSON.parse guard, not the BAD_HTTP_STATUS path.
      expect((e as FacilitatorHttpError).code).toBe("BAD_RESPONSE_BODY");
      expect((e as FacilitatorHttpError).status).toBe(500);
    }
  });

  it("throws FacilitatorHttpError(BAD_HTTP_STATUS) on 5xx with a well-formed domain body", async () => {
    const stub = makeStubFetch(() => ({
      status: 500,
      body: { ok: false, code: "INTERNAL_ERROR", reason: "boom" },
    }));
    const client = createFacilitatorClient({
      url: BASE_URL,
      fetch: stub.fetch,
      retry: { attempts: 1, backoffMs: 0 },
    });

    await expect(client.settle(settleInput)).rejects.toMatchObject({
      name: "FacilitatorHttpError",
      code: "BAD_HTTP_STATUS",
      status: 500,
      facilitatorCode: "INTERNAL_ERROR",
    });
  });

  it("throws FacilitatorHttpError(BAD_HTTP_STATUS) on non-2xx with parseable but off-shape body", async () => {
    // The body is valid JSON but doesn't satisfy the
    // `{ok:false, code, reason}` shape; classify as transport failure.
    const stub = makeStubFetch(() => ({ status: 400, body: { random: "shape" } }));
    const client = createFacilitatorClient({ url: BASE_URL, fetch: stub.fetch });

    await expect(client.settle(settleInput)).rejects.toMatchObject({
      name: "FacilitatorHttpError",
      code: "BAD_HTTP_STATUS",
      status: 400,
    });
  });

  it("returns the domain `{ok:false}` body on HTTP 400 (facilitator-express)", async () => {
    // `facilitator-express` emits domain failures (e.g. bad meta-tx
    // signature) over HTTP 400 with the well-formed result body. The
    // client must surface that as a domain result, not throw —
    // otherwise the convenience handlers can't distinguish a domain
    // rejection from a real transport fault.
    const stub = makeStubFetch(() => ({
      status: 400,
      body: {
        ok: false,
        code: "BAD_META_TX_SIGNATURE",
        reason: "recovered signer 0xaaa != metaTx.from 0xbbb",
      },
    }));
    const client = createFacilitatorClient({ url: BASE_URL, fetch: stub.fetch });

    const result = await client.verify(verifyInput);

    expect(result).toEqual({
      ok: false,
      code: "BAD_META_TX_SIGNATURE",
      reason: "recovered signer 0xaaa != metaTx.from 0xbbb",
    });
  });

  it("returns the domain `{ok:false}` body for /settle on HTTP 400", async () => {
    const stub = makeStubFetch(() => ({
      status: 400,
      body: { ok: false, code: "SIMULATION_REVERT", reason: "estimateGas threw" },
    }));
    const client = createFacilitatorClient({ url: BASE_URL, fetch: stub.fetch });

    const result = await client.settle(settleInput);

    expect(result).toEqual({
      ok: false,
      code: "SIMULATION_REVERT",
      reason: "estimateGas threw",
    });
  });

  it("returns the domain `{ok:false}` body for /perform-action on HTTP 400", async () => {
    const stub = makeStubFetch(() => ({
      status: 400,
      body: { ok: false, code: "ONCHAIN_REVERT", reason: "fund balance too low" },
    }));
    const client = createFacilitatorClient({ url: BASE_URL, fetch: stub.fetch });

    const result = await client.performAction(performActionInput);

    expect(result).toEqual({
      ok: false,
      code: "ONCHAIN_REVERT",
      reason: "fund balance too low",
    });
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

  it("throws FacilitatorHttpError(BAD_RESPONSE_BODY) when 2xx JSON doesn't match the result shape", async () => {
    // A buggy / malicious facilitator could return any 2xx JSON; without
    // the runtime guard, `parsed as Res` would slip an off-shape body
    // straight through to the caller.
    const stub = makeStubFetch(() => ({
      status: 200,
      body: { exchangeId: "42" }, // missing `ok` discriminator + `txHash`
    }));
    const client = createFacilitatorClient({ url: BASE_URL, fetch: stub.fetch });

    await expect(client.settle(settleInput)).rejects.toMatchObject({
      name: "FacilitatorHttpError",
      code: "BAD_RESPONSE_BODY",
      status: 200,
    });
  });

  it("accepts a perform-action success body with just txHash (entity-keyed variant)", async () => {
    // Entity-keyed actions (`boson-withdrawFunds`) return just
    // `{ ok: true, txHash }` — no `newExchangeState`. Exercise that
    // shape end-to-end: send an entity-keyed request and assert the
    // response validator accepts the bare `{ txHash }` body.
    const stub = makeStubFetch(() => ({
      status: 200,
      body: { ok: true, txHash: "0xabc" },
    }));
    const client = createFacilitatorClient({ url: BASE_URL, fetch: stub.fetch });

    await expect(client.performAction(performActionEntityKeyedInput)).resolves.toEqual({
      ok: true,
      txHash: "0xabc",
    });
    // Body must be the entity-keyed shape (entityId, no exchangeId)
    // and the action query string must reflect `boson-withdrawFunds`.
    expect(stub.calls[0]!.url).toBe(
      `${BASE_URL}/perform-action?action=${encodeURIComponent("boson-withdrawFunds")}`,
    );
    expect(JSON.parse(stub.calls[0]!.init!.body!)).toEqual(performActionEntityKeyedInput);
  });

  it("throws FacilitatorHttpError(BAD_RESPONSE_BODY) when txHash is missing from a 2xx success body", async () => {
    const stub = makeStubFetch(() => ({
      status: 200,
      body: { ok: true, newExchangeState: "COMPLETED" }, // txHash missing
    }));
    const client = createFacilitatorClient({ url: BASE_URL, fetch: stub.fetch });

    await expect(client.performAction(performActionInput)).rejects.toMatchObject({
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

  describe("transport hardening", () => {
    // Synchronous setTimeout / clearTimeout overrides so retry backoff
    // sleeps + timeout firings are instant and deterministic without
    // touching the real clock.
    function fakeTimers() {
      let nextId = 1;
      const pending = new Map<number, () => void>();
      const setTimeoutImpl = ((fn: () => void) => {
        const id = nextId++;
        pending.set(id, fn);
        return id as unknown as ReturnType<typeof setTimeout>;
      }) as unknown as typeof setTimeout;
      const clearTimeoutImpl = ((id: unknown) => {
        pending.delete(id as number);
      }) as unknown as typeof clearTimeout;
      const fireAll = () => {
        for (const [id, fn] of [...pending]) {
          pending.delete(id);
          fn();
        }
      };
      return { setTimeoutImpl, clearTimeoutImpl, fireAll, pendingCount: () => pending.size };
    }

    it("aborts the request and throws TIMEOUT after timeoutMs", async () => {
      // Stub fetch that never resolves on its own — only the
      // AbortController abort can settle it. The promise rejects with
      // a synthetic abort error once the abort fires.
      const stub = makeStubFetch(() => ({}));
      const timers = fakeTimers();
      stub.fetch = (async (_url, init) => {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        });
      }) as FetchLike;

      const client = createFacilitatorClient({
        url: BASE_URL,
        fetch: stub.fetch,
        timeoutMs: 100,
        retry: { attempts: 1, backoffMs: 0 },
        setTimeout: timers.setTimeoutImpl,
        clearTimeout: timers.clearTimeoutImpl,
      });

      const verifyPromise = client.verify(verifyInput);
      // Let the fetch microtask register the abort listener, then fire
      // the pending timeout to simulate the timeoutMs elapsing.
      await Promise.resolve();
      await Promise.resolve();
      timers.fireAll();

      await expect(verifyPromise).rejects.toMatchObject({
        name: "FacilitatorHttpError",
        code: "TIMEOUT",
      });
    });

    it("retries 5xx and resolves once the facilitator recovers", async () => {
      let call = 0;
      const stub = makeStubFetch(() => {
        call += 1;
        if (call < 3) return { status: 502, body: { ok: false, code: "BAD_GATEWAY" } };
        return { status: 200, body: { ok: true } };
      });
      const timers = fakeTimers();

      const client = createFacilitatorClient({
        url: BASE_URL,
        fetch: stub.fetch,
        retry: { attempts: 3, backoffMs: 50 },
        setTimeout: timers.setTimeoutImpl,
        clearTimeout: timers.clearTimeoutImpl,
      });

      // Each retry awaits a backoff sleep — drain those instantly by
      // firing the fake timers whenever the test loop yields.
      const verifyPromise = (async () => {
        let result;
        const ticker = setInterval(timers.fireAll, 0);
        try {
          result = await client.verify(verifyInput);
        } finally {
          clearInterval(ticker);
        }
        return result;
      })();

      await expect(verifyPromise).resolves.toEqual({ ok: true });
      expect(stub.calls).toHaveLength(3);
    });

    it("retries NETWORK_ERROR and gives up after the attempt budget", async () => {
      const stub = makeStubFetch(() => ({ throwError: new Error("ECONNRESET") }));
      const timers = fakeTimers();

      const client = createFacilitatorClient({
        url: BASE_URL,
        fetch: stub.fetch,
        retry: { attempts: 3, backoffMs: 25 },
        setTimeout: timers.setTimeoutImpl,
        clearTimeout: timers.clearTimeoutImpl,
      });

      const verifyPromise = (async () => {
        const ticker = setInterval(timers.fireAll, 0);
        try {
          return await client.verify(verifyInput);
        } finally {
          clearInterval(ticker);
        }
      })();

      await expect(verifyPromise).rejects.toMatchObject({
        name: "FacilitatorHttpError",
        code: "NETWORK_ERROR",
      });
      expect(stub.calls).toHaveLength(3);
    });

    it("does not retry on 4xx (treat as a definitive answer)", async () => {
      const stub = makeStubFetch(() => ({
        status: 400,
        body: { random: "shape" }, // off-shape → BAD_HTTP_STATUS, not retryable
      }));
      const client = createFacilitatorClient({
        url: BASE_URL,
        fetch: stub.fetch,
        retry: { attempts: 3, backoffMs: 0 },
      });

      await expect(client.settle(settleInput)).rejects.toMatchObject({
        name: "FacilitatorHttpError",
        code: "BAD_HTTP_STATUS",
        status: 400,
      });
      expect(stub.calls).toHaveLength(1);
    });

    it("attaches x-x402b-idempotency-key on /settle only", async () => {
      const stub = makeStubFetch((req) => {
        if (req.url.endsWith("/settle")) {
          return { body: { ok: true, exchangeId: "1", txHash: "0xabc" } };
        }
        return { body: { ok: true, txHash: "0xdef" } };
      });
      const keys: string[] = [];
      let n = 0;
      const client = createFacilitatorClient({
        url: BASE_URL,
        fetch: stub.fetch,
        idempotencyKey: () => {
          n += 1;
          const k = `key-${n}`;
          keys.push(k);
          return k;
        },
      });

      await client.settle(settleInput);
      await client.verify(verifyInput);
      await client.performAction(performActionInput);

      // The /settle call carries the header; the other two do not.
      const settleCall = stub.calls.find((c) => c.url.endsWith("/settle"))!;
      const verifyCall = stub.calls.find((c) => c.url.endsWith("/verify"))!;
      const performCall = stub.calls.find((c) => c.url.includes("/perform-action"))!;
      expect(settleCall.init?.headers?.["x-x402b-idempotency-key"]).toBe("key-1");
      expect(verifyCall.init?.headers?.["x-x402b-idempotency-key"]).toBeUndefined();
      expect(performCall.init?.headers?.["x-x402b-idempotency-key"]).toBeUndefined();
      // The factory ran exactly once (only /settle pulls a key).
      expect(keys).toEqual(["key-1"]);
    });

    it("uses the same idempotency key across retry attempts of one settle call", async () => {
      let call = 0;
      const stub = makeStubFetch(() => {
        call += 1;
        if (call < 3) return { status: 503, body: { ok: false, code: "UPSTREAM_DOWN" } };
        return { body: { ok: true, exchangeId: "1", txHash: "0xabc" } };
      });
      const timers = fakeTimers();
      let n = 0;
      const client = createFacilitatorClient({
        url: BASE_URL,
        fetch: stub.fetch,
        retry: { attempts: 3, backoffMs: 25 },
        idempotencyKey: () => {
          n += 1;
          return `key-${n}`;
        },
        setTimeout: timers.setTimeoutImpl,
        clearTimeout: timers.clearTimeoutImpl,
      });

      const settlePromise = (async () => {
        const ticker = setInterval(timers.fireAll, 0);
        try {
          return await client.settle(settleInput);
        } finally {
          clearInterval(ticker);
        }
      })();
      await expect(settlePromise).resolves.toMatchObject({ ok: true });

      // All three /settle calls must carry the same key.
      const settleHeaders = stub.calls.map(
        (c) => c.init?.headers?.["x-x402b-idempotency-key"] as string | undefined,
      );
      expect(settleHeaders).toEqual(["key-1", "key-1", "key-1"]);
      // The factory ran exactly once (one logical settle → one key).
      expect(n).toBe(1);
    });
  });
});
