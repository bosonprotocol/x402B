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
  type RedeemFulfillmentUpdate,
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
    channels?: readonly RedeemFulfillmentChannel[];
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
      ...(opts.channels !== undefined ? { fulfillmentChannels: opts.channels } : {}),
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

describe("handlers.disputeResolve — withdraw carved into next[]", () => {
  it("surfaces boson-withdrawFunds in nextActions after resolveDispute", async () => {
    // Once `resolveDispute` lands, both parties' escrowed funds are
    // released to their available balances. `clientLegalActions` for
    // `(DISPUTED, RESOLVED)` returns just `boson-withdrawFunds` so the
    // 200 envelope nudges the buyer (or seller) straight at the withdraw
    // endpoint — no out-of-band knowledge required.
    const fx = await makePaymentFixture();
    const reader = makeSequenceReader([
      {
        state: ExchangeState.DISPUTED,
        disputeState: DisputeState.RESOLVING,
        seller: fx.requirements.offer.creator,
        exchangeToken: TOKEN,
        price: fx.requirements.amount,
      },
      {
        state: ExchangeState.DISPUTED,
        disputeState: DisputeState.RESOLVED,
        seller: fx.requirements.offer.creator,
        exchangeToken: TOKEN,
        price: fx.requirements.amount,
      },
    ]);
    const stub = makeStubFacilitatorFetch(() => ({
      ok: true,
      txHash: "0x222",
      newExchangeState: "DISPUTED",
      newDisputeState: "RESOLVED",
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

      const result = await server.handlers.disputeResolve({
        exchangeId: "42",
        signedPayload: "0xdef",
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.body.nextActions.exchangeState).toBe(ExchangeState.DISPUTED);
        // `disputeState` is part of the DISPUTED-branch envelope shape;
        // assert it is present AND set, so the test fails loudly if the
        // field is ever dropped (a previous `if ("disputeState" in ...)`
        // guard would have silently passed in that case).
        expect("disputeState" in result.body.nextActions).toBe(true);
        if ("disputeState" in result.body.nextActions) {
          expect(result.body.nextActions.disputeState).toBe("RESOLVED");
        }

        const ids = result.body.nextActions.next.map((entry) => entry.id);
        expect(ids).toEqual(["boson-withdrawFunds"]);

        // Facilitator URL for withdraw routes through the same
        // `/perform-action?action=...` endpoint as every other
        // post-commit action — the relayer dispatches on the
        // signed metaTx, not the action's keying.
        const withdraw = result.body.nextActions.next[0]!;
        expect(withdraw.channels).toContain("facilitator");
        expect(withdraw.channels).toContain("onchain");
        expect(withdraw.endpoints?.facilitator).toBe(
          `${facilitatorUrl}/perform-action?action=${encodeURIComponent("boson-withdrawFunds")}`,
        );

        // Onchain fallback for the withdraw entry points at the funds
        // facet, sourced from the central `ACTION_FACETS` map.
        expect(result.body.nextActions.fallback?.onchainHints?.actionFacets).toMatchObject({
          "boson-withdrawFunds": "FundsHandlerFacet",
        });
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("handlers.redeem — fulfillment update", () => {
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
    throwOnCommit: boolean;
  } {
    const spy: ReturnType<typeof makeSpyChannel> = {
      id,
      validations: [],
      commits: [],
      failNext: false,
      throwOnCommit: false,
      validate(data) {
        spy.validations.push(data);
        return spy.failNext ? { ok: false, reason: "bad data" } : { ok: true };
      },
      async onCommit(exchangeId, data) {
        if (spy.throwOnCommit) throw new Error("store unavailable");
        spy.commits.push({ exchangeId, data });
      },
    };
    return spy;
  }

  async function buildRedeemServer(opts: {
    facilitator?: (path: string) => unknown;
    reader: ExchangeReader;
    optionStore?: Map<string, readonly string[]>;
    pendingStore?: Map<string, RedeemFulfillmentUpdate>;
    channels?: readonly RedeemFulfillmentChannel[];
  }) {
    const seller = privateKeyToAccount(TEST_SELLER_PK);
    const stub = makeStubFacilitatorFetch(
      opts.facilitator ?? (() => ({ ok: true, txHash: "0xfed", newExchangeState: "REDEEMED" })),
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
        exchangeReader: opts.reader,
        ...(opts.optionStore !== undefined
          ? { exchangeFulfillmentOptionStore: opts.optionStore }
          : {}),
        ...(opts.pendingStore !== undefined
          ? { redeemFulfillmentUpdateStore: opts.pendingStore }
          : {}),
        ...(opts.channels !== undefined ? { fulfillmentChannels: opts.channels } : {}),
      });
      return { server, stub, restore: () => (globalThis.fetch = originalFetch) };
    } catch (e) {
      globalThis.fetch = originalFetch;
      throw e;
    }
  }

  it("Flow A commit writes advertised fulfillment option ids for redeem-time policy", async () => {
    const fx = await makePaymentFixture();
    const optionStore = new Map<string, readonly string[]>();
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
    const requirements = {
      ...fx.requirements,
      fulfillment: {
        required: true,
        options: [
          { id: "email", schema: null },
          { id: "xmtp", schema: null },
        ],
      },
    };
    const payload = {
      ...fx.payload,
      fulfillment: { option: "email" },
    };
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
        exchangeFulfillmentOptionStore: optionStore,
      });
      const result = await server.handlers.commit({
        paymentHeader: makeBuyerHeader(payload),
        requirements,
      });
      expect(result.ok).toBe(true);
      expect(optionStore.get("42")).toEqual(["email", "xmtp"]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("Flow B commit-and-redeem calls channel.onCommit with the buyer's data", async () => {
    const fx = await makePaymentFixture({ action: "boson-createOfferCommitAndRedeem" });
    const channel = makeSpyChannel("email");
    const reader = makeReader({
      state: ExchangeState.REDEEMED,
      seller: fx.requirements.offer.creator,
      exchangeToken: TOKEN,
      price: fx.requirements.amount,
    });
    const requirements = {
      ...fx.requirements,
      actions: {
        ...fx.requirements.actions,
        next: [
          ...fx.requirements.actions.next,
          { id: "boson-createOfferCommitAndRedeem" as const, channels: ["server" as const] },
        ],
      },
      fulfillment: {
        required: true,
        options: [{ id: "email", schema: { type: "object" as const } }],
      },
    };
    const payload = {
      ...fx.payload,
      fulfillment: { option: "email", data: { email: "buyer@example.com" } },
    };
    const { server } = await buildServerWithStubs({
      facilitator: () => ({ ok: true, exchangeId: "42", txHash: "0xabc" }),
      reader,
      channels: [channel],
    });
    const result = await server.handlers.commitAndRedeem({
      paymentHeader: makeBuyerHeader(payload),
      requirements,
    });
    expect(result.ok).toBe(true);
    expect(channel.validations).toEqual([{ email: "buyer@example.com" }]);
    expect(channel.commits).toEqual([{ exchangeId: "42", data: { email: "buyer@example.com" } }]);
    if (result.ok) {
      expect(result.body.warnings).toBeUndefined();
    }
  });

  it("Flow B onCommit failure → 200 + FULFILLMENT_COMMIT_DEFERRED warning", async () => {
    const fx = await makePaymentFixture({ action: "boson-createOfferCommitAndRedeem" });
    const channel = makeSpyChannel("email");
    channel.throwOnCommit = true;
    const reader = makeReader({
      state: ExchangeState.REDEEMED,
      seller: fx.requirements.offer.creator,
      exchangeToken: TOKEN,
      price: fx.requirements.amount,
    });
    const requirements = {
      ...fx.requirements,
      actions: {
        ...fx.requirements.actions,
        next: [
          ...fx.requirements.actions.next,
          { id: "boson-createOfferCommitAndRedeem" as const, channels: ["server" as const] },
        ],
      },
      fulfillment: {
        required: true,
        options: [{ id: "email", schema: { type: "object" as const } }],
      },
    };
    const payload = {
      ...fx.payload,
      fulfillment: { option: "email", data: { email: "buyer@example.com" } },
    };
    const { server } = await buildServerWithStubs({
      facilitator: () => ({ ok: true, exchangeId: "42", txHash: "0xabc" }),
      reader,
      channels: [channel],
    });
    const result = await server.handlers.commitAndRedeem({
      paymentHeader: makeBuyerHeader(payload),
      requirements,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.body.warnings).toEqual([
        expect.objectContaining({ code: "FULFILLMENT_COMMIT_DEFERRED" }),
      ]);
    }
  });

  it("redeemer without fulfillment → 200, no channel calls", async () => {
    const fx = await makePaymentFixture();
    const channel = makeSpyChannel();
    const { server, restore } = await buildRedeemServer({
      reader: makeRedeemReader(fx),
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

  it("redeemer with valid fulfillment → 200, channel.onCommit called", async () => {
    const fx = await makePaymentFixture();
    const optionStore = new Map<string, readonly string[]>([["42", ["email"]]]);
    const channel = makeSpyChannel();
    const { server, restore } = await buildRedeemServer({
      reader: makeRedeemReader(fx),
      optionStore,
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

  it("fulfillment option not advertised for the exchange → 400 FULFILLMENT_OPTION_NOT_ADVERTISED", async () => {
    const fx = await makePaymentFixture();
    const optionStore = new Map<string, readonly string[]>([["42", ["email"]]]);
    const email = makeSpyChannel("email");
    const webhook = makeSpyChannel("webhook");
    const { server, stub, restore } = await buildRedeemServer({
      reader: makeRedeemReader(fx),
      optionStore,
      channels: [email, webhook],
    });
    try {
      const result = await server.handlers.redeem({
        exchangeId: "42",
        signedPayload: makeRedeemSignedPayload(fx.buyer.address),
        fulfillment: { option: "webhook", data: { url: "https://buyer.example/hook" } },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.status).toBe(400);
        expect(result.body.code).toBe("FULFILLMENT_OPTION_NOT_ADVERTISED");
      }
      expect(stub.calls).toHaveLength(0);
      expect(webhook.validations).toHaveLength(0);
      expect(webhook.commits).toHaveLength(0);
    } finally {
      restore();
    }
  });

  it("fulfillment with unknown option → 400 FULFILLMENT_OPTION_UNKNOWN", async () => {
    const fx = await makePaymentFixture();
    const optionStore = new Map<string, readonly string[]>([["42", ["ipfs-pointer"]]]);
    const channel = makeSpyChannel("email");
    const { server, restore } = await buildRedeemServer({
      reader: makeRedeemReader(fx),
      optionStore,
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
    const optionStore = new Map<string, readonly string[]>([["42", ["email"]]]);
    const channel = makeSpyChannel();
    channel.failNext = true;
    const { server, restore } = await buildRedeemServer({
      reader: makeRedeemReader(fx),
      optionStore,
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

  it("fulfillment whose channel.validate throws → 400 FULFILLMENT_DATA_INVALID (not 500)", async () => {
    const fx = await makePaymentFixture();
    const optionStore = new Map<string, readonly string[]>([["42", ["email"]]]);
    const throwingChannel: RedeemFulfillmentChannel = {
      id: "email",
      validate() {
        throw new Error("adapter blew up");
      },
      async onCommit() {
        // never reached — validate throws first
      },
    };
    const { server, restore } = await buildRedeemServer({
      reader: makeRedeemReader(fx),
      optionStore,
      channels: [throwingChannel],
    });
    try {
      const result = await server.handlers.redeem({
        exchangeId: "42",
        signedPayload: makeRedeemSignedPayload(fx.buyer.address),
        fulfillment: { option: "email", data: { email: "x@example.com" } },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.status).toBe(400);
        expect(result.body.code).toBe("FULFILLMENT_DATA_INVALID");
        expect(result.body.reason).toContain("adapter blew up");
      }
    } finally {
      restore();
    }
  });

  it("fulfillment without fulfillmentChannels configured → 400 FULFILLMENT_CHANNELS_NOT_CONFIGURED", async () => {
    const fx = await makePaymentFixture();
    const optionStore = new Map<string, readonly string[]>([["42", ["email"]]]);
    const { server, restore } = await buildRedeemServer({
      reader: makeRedeemReader(fx),
      optionStore,
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

  it("successful redeem with fulfillment clears the option-policy entry", async () => {
    const fx = await makePaymentFixture();
    const optionStore = new Map<string, readonly string[]>([["42", ["email"]]]);
    const channel = makeSpyChannel();
    const { server, restore } = await buildRedeemServer({
      reader: makeRedeemReader(fx),
      optionStore,
      channels: [channel],
    });
    try {
      const result = await server.handlers.redeem({
        exchangeId: "42",
        signedPayload: makeRedeemSignedPayload(fx.buyer.address),
        fulfillment: { option: "email", data: { email: "x@example.com" } },
      });
      expect(result.ok).toBe(true);
      expect(optionStore.has("42")).toBe(false);
    } finally {
      restore();
    }
  });

  it("onCommit failure after confirmed redeem returns 200 with a pending recovery update", async () => {
    const fx = await makePaymentFixture();
    const optionStore = new Map<string, readonly string[]>([["42", ["email"]]]);
    const pendingStore = new Map<string, RedeemFulfillmentUpdate>();
    const channel = makeSpyChannel();
    channel.throwOnCommit = true;
    const { server, restore } = await buildRedeemServer({
      reader: makeRedeemReader(fx),
      optionStore,
      pendingStore,
      channels: [channel],
    });
    try {
      const result = await server.handlers.redeem({
        exchangeId: "42",
        signedPayload: makeRedeemSignedPayload(fx.buyer.address),
        fulfillment: { option: "email", data: { email: "new@example.com" } },
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.body.warnings?.[0]?.code).toBe("FULFILLMENT_UPDATE_DEFERRED");
      }
      expect(pendingStore.get("42")).toMatchObject({
        exchangeId: "42",
        option: "email",
        data: { email: "new@example.com" },
        redeemer: fx.buyer.address,
        error: "store unavailable",
      });
      expect(optionStore.has("42")).toBe(false);
    } finally {
      restore();
    }
  });

  it("failed redeem (state-verify mismatch) leaves the option-policy entry AND channel store untouched", async () => {
    const fx = await makePaymentFixture();
    const optionStore = new Map<string, readonly string[]>([["42", ["email"]]]);
    const channel = makeSpyChannel();
    // Sequence: pre-action read finds COMMITTED, post-action read
    // returns COMMITTED again (facilitator lied about REDEEMED).
    const stuckReader = makeSequenceReader([
      {
        state: ExchangeState.COMMITTED,
        seller: fx.requirements.offer.creator,
        exchangeToken: TOKEN,
        price: fx.requirements.amount,
      },
      {
        state: ExchangeState.COMMITTED,
        seller: fx.requirements.offer.creator,
        exchangeToken: TOKEN,
        price: fx.requirements.amount,
      },
    ]);
    const { server, restore } = await buildRedeemServer({
      reader: stuckReader,
      optionStore,
      channels: [channel],
    });
    try {
      const result = await server.handlers.redeem({
        exchangeId: "42",
        signedPayload: makeRedeemSignedPayload(fx.buyer.address),
        fulfillment: { option: "email", data: { email: "new@example.com" } },
      });
      expect(result.ok).toBe(false);
      expect(channel.commits).toHaveLength(0);
      expect(optionStore.get("42")).toEqual(["email"]);
    } finally {
      restore();
    }
  });
});

describe("config validation — fulfillmentChannels", () => {
  it("rejects duplicate channel ids at createX402bServer time", async () => {
    const seller = privateKeyToAccount(TEST_SELLER_PK);
    const duplicate = {
      id: "email",
      validate: () => ({ ok: true as const }),
      onCommit: async () => undefined,
    };
    expect(() =>
      createX402bServer({
        network: NETWORK,
        chainId: CHAIN_ID,
        escrow: ESCROW,
        signer: seller,
        facilitator: { url: facilitatorUrl },
        channelRegistry: { channels: ["server", "facilitator", "onchain"], escrow: ESCROW },
        fulfillmentChannels: [duplicate, duplicate],
      }),
    ).toThrow(/duplicate id/);
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
