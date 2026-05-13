// End-to-end coverage for the convenience handlers. The facilitator
// HTTP client is stubbed via the `fetch` override; the
// `ExchangeReader` is stubbed with an in-memory implementation so we
// can drive both the happy path and the state-verification mismatch.

import { ExchangeState } from "@bosonprotocol/x402-actions";
import { describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";

import {
  createX402bServer,
  type ExchangeReader,
  type ExchangeSnapshot,
  type FetchLike,
} from "../src/index.js";
import {
  CHAIN_ID,
  ESCROW,
  makePaymentFixture,
  NETWORK,
  TEST_SELLER_PK,
  TOKEN,
} from "./fixtures.js";

function makeStubFacilitatorFetch(handler: (path: string) => unknown): {
  fetch: FetchLike;
  calls: Array<{ url: string; body: unknown }>;
} {
  const calls: Array<{ url: string; body: unknown }> = [];
  const fetch: FetchLike = async (url, init) => {
    const path = url.replace(/^https?:\/\/[^/]+/, "");
    const parsedBody = init?.body !== undefined ? JSON.parse(init.body) : undefined;
    calls.push({ url, body: parsedBody });
    const response = handler(path);
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify(response),
    };
  };
  return { fetch, calls };
}

function makeReader(snapshot: ExchangeSnapshot | null): ExchangeReader {
  return { read: async () => snapshot };
}

function makeBuyerHeader(payload: unknown): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
}

const facilitatorUrl = "https://facilitator.example";

async function buildServerWithStubs(
  opts: {
    facilitator?: (path: string) => unknown;
    reader?: ExchangeReader;
  } = {},
) {
  const seller = privateKeyToAccount(TEST_SELLER_PK);
  const fetchStub = makeStubFacilitatorFetch(opts.facilitator ?? (() => ({ ok: true })));
  // Slip the fetch override into the global so the facilitator client
  // picks it up at construction time.
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchStub.fetch as unknown as typeof globalThis.fetch;
  try {
    const server = createX402bServer({
      network: NETWORK,
      chainId: CHAIN_ID,
      escrow: ESCROW,
      signer: seller,
      facilitator: { url: facilitatorUrl },
      channelRegistry: {
        channels: ["server", "facilitator", "onchain"],
        escrow: ESCROW,
      },
      ...(opts.reader !== undefined ? { exchangeReader: opts.reader } : {}),
    });
    return { server, fetchStub, seller };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

describe("handlers.commitAndRedeem", () => {
  it("happy path — settles + verifies + returns nextActions", async () => {
    const fx = await makePaymentFixture();
    const reader = makeReader({
      state: ExchangeState.REDEEMED,
      seller: fx.requirements.offer.creator,
      exchangeToken: TOKEN,
      price: fx.requirements.amount,
    });
    const { server } = await buildServerWithStubs({
      facilitator: (path) => {
        if (path === "/settle") return { ok: true, exchangeId: "42", txHash: "0xabc" };
        return { ok: false, code: "INTERNAL_ERROR", reason: "unexpected path" };
      },
      reader,
    });

    const result = await server.handlers.commitAndRedeem({
      paymentHeader: makeBuyerHeader(fx.payload),
      requirements: fx.requirements,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.body.exchangeId).toBe("42");
      expect(result.body.txHash).toBe("0xabc");
      expect(result.body.nextActions.exchangeState).toBe(ExchangeState.REDEEMED);
      expect(result.body.nextActions.exchangeId).toBe("42");
    }
  });

  it("402 when X-PAYMENT is missing", async () => {
    const fx = await makePaymentFixture();
    const reader = makeReader(null);
    const { server } = await buildServerWithStubs({ reader });

    const result = await server.handlers.commitAndRedeem({
      paymentHeader: undefined,
      requirements: fx.requirements,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(402);
      expect(result.body.code).toBe("MISSING_HEADER");
    }
  });

  it("400 when the 13-rule validator rejects", async () => {
    const fx = await makePaymentFixture();
    const tampered = {
      ...fx.payload,
      payload: {
        ...fx.payload.payload,
        offerRef: { ...fx.payload.payload.offerRef, sellerSig: "0xdeadbeef" },
      },
    };
    const reader = makeReader(null);
    const { server } = await buildServerWithStubs({ reader });

    const result = await server.handlers.commitAndRedeem({
      paymentHeader: makeBuyerHeader(tampered),
      requirements: fx.requirements,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.body.code).toBe("SELLER_SIG_MISMATCH");
    }
  });

  it("502 when facilitator rejects with a domain error", async () => {
    const fx = await makePaymentFixture();
    const { server } = await buildServerWithStubs({
      facilitator: () => ({ ok: false, code: "SIMULATION_REVERT", reason: "boom" }),
      reader: makeReader(null),
    });

    const result = await server.handlers.commitAndRedeem({
      paymentHeader: makeBuyerHeader(fx.payload),
      requirements: fx.requirements,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(502);
      expect(result.body.code).toBe("FACILITATOR_REJECTED");
    }
  });

  it("502 when on-chain state doesn't match expected post-state", async () => {
    const fx = await makePaymentFixture();
    const reader = makeReader({
      state: ExchangeState.COMMITTED, // expected REDEEMED for Flow B
      seller: fx.requirements.offer.creator,
      exchangeToken: TOKEN,
      price: fx.requirements.amount,
    });
    const { server } = await buildServerWithStubs({
      facilitator: () => ({ ok: true, exchangeId: "42", txHash: "0xabc" }),
      reader,
    });

    const result = await server.handlers.commitAndRedeem({
      paymentHeader: makeBuyerHeader(fx.payload),
      requirements: fx.requirements,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(502);
      expect(result.body.code).toBe("STATE_VERIFY_STATE_MISMATCH");
    }
  });

  it("throws when invoked without exchangeReader in config", async () => {
    const fx = await makePaymentFixture();
    const { server } = await buildServerWithStubs({ reader: undefined });

    await expect(
      server.handlers.commitAndRedeem({
        paymentHeader: makeBuyerHeader(fx.payload),
        requirements: fx.requirements,
      }),
    ).rejects.toThrow(/requires `exchangeReader`/);
  });
});

describe("handlers.complete (perform-action wrapper)", () => {
  it("happy path — forwards to facilitator and verifies COMPLETED", async () => {
    const fx = await makePaymentFixture();
    const reader = makeReader({
      state: ExchangeState.COMPLETED,
      seller: fx.requirements.offer.creator,
      exchangeToken: TOKEN,
      price: fx.requirements.amount,
    });
    const stub = makeStubFacilitatorFetch(() => ({
      ok: true,
      txHash: "0xfed",
      newExchangeState: "COMPLETED",
    }));
    const originalFetch = globalThis.fetch;
    globalThis.fetch = stub.fetch as unknown as typeof globalThis.fetch;
    try {
      const seller = privateKeyToAccount(TEST_SELLER_PK);
      const server = createX402bServer({
        network: NETWORK,
        chainId: CHAIN_ID,
        escrow: ESCROW,
        signer: seller,
        facilitator: { url: facilitatorUrl },
        channelRegistry: { channels: ["server", "facilitator", "onchain"], escrow: ESCROW },
        exchangeReader: reader,
      });

      const result = await server.handlers.complete({
        exchangeId: "42",
        signedPayload: "0xc0ffee",
        requirementsRef: {
          asset: fx.requirements.asset,
          amount: fx.requirements.amount,
          offer: fx.requirements.offer,
        },
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.body.txHash).toBe("0xfed");
        expect(result.body.nextActions.exchangeState).toBe(ExchangeState.COMPLETED);
      }
      // Verify the request forwarded the right action.
      expect(stub.calls[0]!.url).toContain("/perform-action");
      expect((stub.calls[0]!.body as { action: string }).action).toBe("boson-completeExchange");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("handlers.disputeRaise — DISPUTED post-state path", () => {
  it("stamps nextActions with disputeState=RESOLVING", async () => {
    const fx = await makePaymentFixture();
    const reader: ExchangeReader = {
      read: async () => ({
        state: ExchangeState.DISPUTED,
        disputeState: (await import("@bosonprotocol/x402-actions")).DisputeState.RESOLVING,
        seller: fx.requirements.offer.creator,
        exchangeToken: TOKEN,
        price: fx.requirements.amount,
      }),
    };
    const stub = makeStubFacilitatorFetch(() => ({
      ok: true,
      txHash: "0x111",
      newExchangeState: "DISPUTED",
      newDisputeState: "RESOLVING",
    }));
    const originalFetch = globalThis.fetch;
    globalThis.fetch = stub.fetch as unknown as typeof globalThis.fetch;
    try {
      const seller = privateKeyToAccount(TEST_SELLER_PK);
      const server = createX402bServer({
        network: NETWORK,
        chainId: CHAIN_ID,
        escrow: ESCROW,
        signer: seller,
        facilitator: { url: facilitatorUrl },
        channelRegistry: { channels: ["server", "facilitator", "onchain"], escrow: ESCROW },
        exchangeReader: reader,
      });

      const result = await server.handlers.disputeRaise({
        exchangeId: "42",
        signedPayload: "0xdef",
        requirementsRef: {
          asset: fx.requirements.asset,
          amount: fx.requirements.amount,
          offer: fx.requirements.offer,
        },
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.body.nextActions.exchangeState).toBe(ExchangeState.DISPUTED);
        if ("disputeState" in result.body.nextActions) {
          expect(result.body.nextActions.disputeState).toBe("RESOLVING");
        }
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("verifyExchangeSnapshot — pure comparison", () => {
  it("passes when all four fields match", async () => {
    const { verifyExchangeSnapshot } = await import("../src/index.js");
    const result = verifyExchangeSnapshot(
      {
        state: ExchangeState.REDEEMED,
        seller: "0x1111111111111111111111111111111111111111",
        exchangeToken: TOKEN,
        price: "1000000",
      },
      {
        state: ExchangeState.REDEEMED,
        seller: "0x1111111111111111111111111111111111111111",
        exchangeToken: TOKEN,
        price: "1000000",
      },
    );
    expect(result.ok).toBe(true);
  });

  it("EXCHANGE_NOT_FOUND when snapshot is null", async () => {
    const { verifyExchangeSnapshot } = await import("../src/index.js");
    const result = verifyExchangeSnapshot(null, {
      state: ExchangeState.REDEEMED,
      seller: "0x1111111111111111111111111111111111111111",
      exchangeToken: TOKEN,
      price: "1000000",
    });
    expect(result).toMatchObject({ ok: false, code: "EXCHANGE_NOT_FOUND" });
  });

  it("PRICE_MISMATCH on price drift", async () => {
    const { verifyExchangeSnapshot } = await import("../src/index.js");
    const result = verifyExchangeSnapshot(
      {
        state: ExchangeState.REDEEMED,
        seller: "0x1111111111111111111111111111111111111111",
        exchangeToken: TOKEN,
        price: "1",
      },
      {
        state: ExchangeState.REDEEMED,
        seller: "0x1111111111111111111111111111111111111111",
        exchangeToken: TOKEN,
        price: "1000000",
      },
    );
    expect(result).toMatchObject({ ok: false, code: "PRICE_MISMATCH" });
  });
});
