// End-to-end coverage for the convenience handlers. The facilitator
// HTTP client is stubbed via the `fetch` override; the
// `ExchangeReader` is stubbed with an in-memory implementation so we
// can drive both the happy path and the state-verification mismatch.

import { DisputeState, ExchangeState } from "@bosonprotocol/x402-actions";
import type { BosonMetaTx } from "@bosonprotocol/x402-core/schemes/escrow";
import { encodeSignedPayload } from "@bosonprotocol/x402-evm";
import type { Hex } from "viem";
import { describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";

import {
  createX402bServer,
  type ExchangeReader,
  type ExchangeSnapshot,
  type FetchLike,
  type RedeemFulfillmentChannel,
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

function makeSequenceReader(snapshots: Array<ExchangeSnapshot | null>): ExchangeReader {
  let index = 0;
  return {
    read: async () => {
      const snapshot = snapshots[Math.min(index, snapshots.length - 1)] ?? null;
      index += 1;
      return snapshot;
    },
  };
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

describe("handlers.commit / commitAndRedeem", () => {
  it("happy path — settles + verifies + returns nextActions", async () => {
    const fx = await makePaymentFixture();
    const reader = makeReader({
      state: ExchangeState.COMMITTED,
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

    const result = await server.handlers.commit({
      paymentHeader: makeBuyerHeader(fx.payload),
      requirements: fx.requirements,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.body.exchangeId).toBe("42");
      expect(result.body.txHash).toBe("0xabc");
      expect(result.body.nextActions.exchangeState).toBe(ExchangeState.COMMITTED);
      expect(result.body.nextActions.exchangeId).toBe("42");

      // Every nextAction advertising `facilitator` in `channels` must
      // also carry an `endpoints.facilitator` URL; otherwise clients
      // see the channel advertised but have nowhere to route. The
      // commit-time challenge stamps these in `buildPaymentRequirements`;
      // the post-commit envelope stamps them in `emitNextActions`.
      const facilitatorEntries = result.body.nextActions.next.filter((entry) =>
        entry.channels.includes("facilitator"),
      );
      expect(facilitatorEntries.length).toBeGreaterThan(0);
      for (const entry of facilitatorEntries) {
        expect(entry.endpoints?.facilitator).toBe(
          `${facilitatorUrl}/perform-action?action=${encodeURIComponent(entry.id)}`,
        );
      }
    }
  });

  it("400s before settle when the route does not match the signed action", async () => {
    const fx = await makePaymentFixture();
    const { server, fetchStub } = await buildServerWithStubs({
      facilitator: () => ({ ok: true, exchangeId: "42", txHash: "0xabc" }),
      reader: makeReader(null),
    });

    const result = await server.handlers.commitAndRedeem({
      paymentHeader: makeBuyerHeader(fx.payload),
      requirements: fx.requirements,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.body.code).toBe("ACTION_ROUTE_MISMATCH");
    }
    expect(fetchStub.calls).toHaveLength(0);
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

    const result = await server.handlers.commit({
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

    const result = await server.handlers.commit({
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
      state: ExchangeState.REDEEMED, // expected COMMITTED for Flow A
      seller: fx.requirements.offer.creator,
      exchangeToken: TOKEN,
      price: fx.requirements.amount,
    });
    const { server } = await buildServerWithStubs({
      facilitator: () => ({ ok: true, exchangeId: "42", txHash: "0xabc" }),
      reader,
    });

    const result = await server.handlers.commit({
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
      server.handlers.commit({
        paymentHeader: makeBuyerHeader(fx.payload),
        requirements: fx.requirements,
      }),
    ).rejects.toThrow(/requires `exchangeReader`/);
  });
});

describe("handlers.complete (perform-action wrapper)", () => {
  it("happy path — forwards to facilitator and verifies COMPLETED", async () => {
    const fx = await makePaymentFixture();
    const reader = makeSequenceReader([
      {
        state: ExchangeState.REDEEMED,
        seller: fx.requirements.offer.creator,
        exchangeToken: TOKEN,
        price: fx.requirements.amount,
      },
      {
        state: ExchangeState.COMPLETED,
        seller: fx.requirements.offer.creator,
        exchangeToken: TOKEN,
        price: fx.requirements.amount,
      },
    ]);
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

  it("502s before facilitator call when the server cannot read the exchange reference", async () => {
    const { server, fetchStub } = await buildServerWithStubs({ reader: makeReader(null) });

    const result = await server.handlers.complete({
      exchangeId: "42",
      signedPayload: "0xc0ffee",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(502);
      expect(result.body.code).toBe("STATE_VERIFY_EXCHANGE_NOT_FOUND");
    }
    expect(fetchStub.calls).toHaveLength(0);
  });
});

describe("handlers.disputeRaise — DISPUTED post-state path", () => {
  it("stamps nextActions with disputeState=RESOLVING", async () => {
    const fx = await makePaymentFixture();
    const reader = makeSequenceReader([
      {
        state: ExchangeState.REDEEMED,
        seller: fx.requirements.offer.creator,
        exchangeToken: TOKEN,
        price: fx.requirements.amount,
      },
      {
        state: ExchangeState.DISPUTED,
        disputeState: DisputeState.RESOLVING,
        seller: fx.requirements.offer.creator,
        exchangeToken: TOKEN,
        price: fx.requirements.amount,
      },
    ]);
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
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.body.nextActions.exchangeState).toBe(ExchangeState.DISPUTED);
        if ("disputeState" in result.body.nextActions) {
          expect(result.body.nextActions.disputeState).toBe("RESOLVING");
        }

        // Facilitator endpoints get stamped on the DISPUTED path too.
        const facilitatorEntries = result.body.nextActions.next.filter((entry) =>
          entry.channels.includes("facilitator"),
        );
        expect(facilitatorEntries.length).toBeGreaterThan(0);
        for (const entry of facilitatorEntries) {
          expect(entry.endpoints?.facilitator).toBe(
            `${facilitatorUrl}/perform-action?action=${encodeURIComponent(entry.id)}`,
          );
        }
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("handlers.redeem — wallet-rebinding + fulfillment update", () => {
  function makeRedeemSignedPayload(from: string): Hex {
    const metaTx: BosonMetaTx = {
      from,
      nonce: "1",
      functionName: "redeemVoucher(uint256)",
      functionSignature: `0x${"ab".repeat(36)}`,
      sig: { v: 28, r: `0x${"11".repeat(32)}`, s: `0x${"22".repeat(32)}` },
    };
    return encodeSignedPayload(metaTx);
  }

  function makeRedeemReader(fx: { requirements: { offer: { creator: string }; amount: string } }) {
    return makeSequenceReader([
      {
        state: ExchangeState.COMMITTED,
        seller: fx.requirements.offer.creator,
        exchangeToken: TOKEN,
        price: fx.requirements.amount,
      },
      {
        state: ExchangeState.REDEEMED,
        seller: fx.requirements.offer.creator,
        exchangeToken: TOKEN,
        price: fx.requirements.amount,
      },
    ]);
  }

  /**
   * Spy channel that records every `validate` and `onCommit` call.
   * `validate` flips to `{ ok: false }` when `failNext` is set.
   */
  function makeSpyChannel(id = "email"): RedeemFulfillmentChannel & {
    validations: Array<Record<string, unknown> | null>;
    commits: Array<{ exchangeId: string; data: Record<string, unknown> | null }>;
    failNext: boolean;
  } {
    const spy: ReturnType<typeof makeSpyChannel> = {
      id,
      validations: [],
      commits: [],
      failNext: false,
      validate(data) {
        spy.validations.push(data);
        return spy.failNext ? { ok: false, reason: "bad data" } : { ok: true };
      },
      async onCommit(exchangeId, data) {
        spy.commits.push({ exchangeId, data });
      },
    };
    return spy;
  }

  async function buildRedeemServer(opts: {
    facilitator?: (path: string) => unknown;
    reader: ExchangeReader;
    buyerStore: Map<string, `0x${string}`>;
    channels?: readonly RedeemFulfillmentChannel[];
  }) {
    const seller = privateKeyToAccount(TEST_SELLER_PK);
    const stub = makeStubFacilitatorFetch(
      opts.facilitator ?? (() => ({ ok: true, txHash: "0xfed", newExchangeState: "REDEEMED" })),
    );
    const originalFetch = globalThis.fetch;
    globalThis.fetch = stub.fetch as unknown as typeof globalThis.fetch;
    const server = createX402bServer({
      network: NETWORK,
      chainId: CHAIN_ID,
      escrow: ESCROW,
      signer: seller,
      facilitator: { url: facilitatorUrl },
      channelRegistry: { channels: ["server", "facilitator", "onchain"], escrow: ESCROW },
      exchangeReader: opts.reader,
      exchangeBuyerStore: opts.buyerStore,
      ...(opts.channels !== undefined ? { fulfillmentChannels: opts.channels } : {}),
    });
    return { server, stub, restore: () => (globalThis.fetch = originalFetch) };
  }

  it("Flow A commit writes committer wallet into exchangeBuyerStore", async () => {
    const fx = await makePaymentFixture();
    const buyerStore = new Map<string, `0x${string}`>();
    const reader = makeReader({
      state: ExchangeState.COMMITTED,
      seller: fx.requirements.offer.creator,
      exchangeToken: TOKEN,
      price: fx.requirements.amount,
    });
    const seller = privateKeyToAccount(TEST_SELLER_PK);
    const stub = makeStubFacilitatorFetch((path) =>
      path === "/settle"
        ? { ok: true, exchangeId: "42", txHash: "0xabc" }
        : { ok: false, code: "INTERNAL_ERROR", reason: "unexpected" },
    );
    const originalFetch = globalThis.fetch;
    globalThis.fetch = stub.fetch as unknown as typeof globalThis.fetch;
    try {
      const server = createX402bServer({
        network: NETWORK,
        chainId: CHAIN_ID,
        escrow: ESCROW,
        signer: seller,
        facilitator: { url: facilitatorUrl },
        channelRegistry: { channels: ["server", "facilitator", "onchain"], escrow: ESCROW },
        exchangeReader: reader,
        exchangeBuyerStore: buyerStore,
      });
      const result = await server.handlers.commit({
        paymentHeader: makeBuyerHeader(fx.payload),
        requirements: fx.requirements,
      });
      expect(result.ok).toBe(true);
      expect(buyerStore.get("42")).toBe(fx.buyer.address);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("same-wallet redeemer without fulfillment → 200, no channel calls", async () => {
    const fx = await makePaymentFixture();
    const buyerStore = new Map<string, `0x${string}`>([["42", fx.buyer.address]]);
    const channel = makeSpyChannel();
    const { server, restore } = await buildRedeemServer({
      reader: makeRedeemReader(fx),
      buyerStore,
      channels: [channel],
    });
    try {
      const result = await server.handlers.redeem({
        exchangeId: "42",
        signedPayload: makeRedeemSignedPayload(fx.buyer.address),
      });
      expect(result.ok).toBe(true);
      expect(channel.validations).toHaveLength(0);
      expect(channel.commits).toHaveLength(0);
    } finally {
      restore();
    }
  });

  it("same-wallet redeemer with valid fulfillment → 200, channel.onCommit called", async () => {
    const fx = await makePaymentFixture();
    const buyerStore = new Map<string, `0x${string}`>([["42", fx.buyer.address]]);
    const channel = makeSpyChannel();
    const { server, restore } = await buildRedeemServer({
      reader: makeRedeemReader(fx),
      buyerStore,
      channels: [channel],
    });
    try {
      const result = await server.handlers.redeem({
        exchangeId: "42",
        signedPayload: makeRedeemSignedPayload(fx.buyer.address),
        fulfillment: { option: "email", data: { email: "new@example.com" } },
      });
      expect(result.ok).toBe(true);
      expect(channel.commits).toEqual([{ exchangeId: "42", data: { email: "new@example.com" } }]);
    } finally {
      restore();
    }
  });

  it("different-wallet redeemer without fulfillment → 400 FULFILLMENT_REQUIRED_ON_WALLET_CHANGE", async () => {
    const fx = await makePaymentFixture();
    const buyerStore = new Map<string, `0x${string}`>([["42", fx.buyer.address]]);
    const channel = makeSpyChannel();
    const { server, stub, restore } = await buildRedeemServer({
      reader: makeRedeemReader(fx),
      buyerStore,
      channels: [channel],
    });
    try {
      const result = await server.handlers.redeem({
        exchangeId: "42",
        signedPayload: makeRedeemSignedPayload("0x9999999999999999999999999999999999999999"),
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.status).toBe(400);
        expect(result.body.code).toBe("FULFILLMENT_REQUIRED_ON_WALLET_CHANGE");
      }
      // Must short-circuit before contacting the facilitator.
      expect(stub.calls).toHaveLength(0);
      expect(channel.commits).toHaveLength(0);
    } finally {
      restore();
    }
  });

  it("different-wallet redeemer with valid fulfillment → 200, channel.onCommit called", async () => {
    const fx = await makePaymentFixture();
    const buyerStore = new Map<string, `0x${string}`>([["42", fx.buyer.address]]);
    const channel = makeSpyChannel();
    const { server, restore } = await buildRedeemServer({
      reader: makeRedeemReader(fx),
      buyerStore,
      channels: [channel],
    });
    try {
      const result = await server.handlers.redeem({
        exchangeId: "42",
        signedPayload: makeRedeemSignedPayload("0x9999999999999999999999999999999999999999"),
        fulfillment: { option: "email", data: { email: "new-owner@example.com" } },
      });
      expect(result.ok).toBe(true);
      expect(channel.commits).toEqual([
        { exchangeId: "42", data: { email: "new-owner@example.com" } },
      ]);
    } finally {
      restore();
    }
  });

  it("fulfillment with unknown option → 400 FULFILLMENT_OPTION_UNKNOWN", async () => {
    const fx = await makePaymentFixture();
    const buyerStore = new Map<string, `0x${string}`>([["42", fx.buyer.address]]);
    const channel = makeSpyChannel("email");
    const { server, restore } = await buildRedeemServer({
      reader: makeRedeemReader(fx),
      buyerStore,
      channels: [channel],
    });
    try {
      const result = await server.handlers.redeem({
        exchangeId: "42",
        signedPayload: makeRedeemSignedPayload(fx.buyer.address),
        fulfillment: { option: "ipfs-pointer", data: null },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.body.code).toBe("FULFILLMENT_OPTION_UNKNOWN");
      }
    } finally {
      restore();
    }
  });

  it("fulfillment that fails channel.validate → 400 FULFILLMENT_DATA_INVALID", async () => {
    const fx = await makePaymentFixture();
    const buyerStore = new Map<string, `0x${string}`>([["42", fx.buyer.address]]);
    const channel = makeSpyChannel();
    channel.failNext = true;
    const { server, restore } = await buildRedeemServer({
      reader: makeRedeemReader(fx),
      buyerStore,
      channels: [channel],
    });
    try {
      const result = await server.handlers.redeem({
        exchangeId: "42",
        signedPayload: makeRedeemSignedPayload(fx.buyer.address),
        fulfillment: { option: "email", data: { email: "" } },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.body.code).toBe("FULFILLMENT_DATA_INVALID");
      }
      expect(channel.commits).toHaveLength(0);
    } finally {
      restore();
    }
  });

  it("fulfillment without fulfillmentChannels configured → 400 FULFILLMENT_CHANNELS_NOT_CONFIGURED", async () => {
    const fx = await makePaymentFixture();
    const buyerStore = new Map<string, `0x${string}`>([["42", fx.buyer.address]]);
    const { server, restore } = await buildRedeemServer({
      reader: makeRedeemReader(fx),
      buyerStore,
    });
    try {
      const result = await server.handlers.redeem({
        exchangeId: "42",
        signedPayload: makeRedeemSignedPayload(fx.buyer.address),
        fulfillment: { option: "email", data: { email: "x@example.com" } },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.body.code).toBe("FULFILLMENT_CHANNELS_NOT_CONFIGURED");
      }
    } finally {
      restore();
    }
  });

  it("redeem against an exchange with no committer record → wallet check skipped", async () => {
    const fx = await makePaymentFixture();
    const buyerStore = new Map<string, `0x${string}`>(); // empty — legacy
    const { server, restore } = await buildRedeemServer({
      reader: makeRedeemReader(fx),
      buyerStore,
    });
    try {
      const result = await server.handlers.redeem({
        exchangeId: "42",
        signedPayload: makeRedeemSignedPayload("0x9999999999999999999999999999999999999999"),
      });
      expect(result.ok).toBe(true);
    } finally {
      restore();
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

  it("verifyExchange retries transient EXCHANGE_NOT_FOUND", async () => {
    const { verifyExchange } = await import("../src/index.js");
    const reader = makeSequenceReader([
      null,
      {
        state: ExchangeState.REDEEMED,
        seller: "0x1111111111111111111111111111111111111111",
        exchangeToken: TOKEN,
        price: "1000000",
      },
    ]);

    const result = await verifyExchange(
      reader,
      "42",
      {
        state: ExchangeState.REDEEMED,
        seller: "0x1111111111111111111111111111111111111111",
        exchangeToken: TOKEN,
        price: "1000000",
      },
      { attempts: 2, delayMs: 0 },
    );

    expect(result.ok).toBe(true);
  });
});
