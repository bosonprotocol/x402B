// Integration tests for the Express adapter. Use `supertest` against
// an in-process Express app wired to a real `createX402bServer`. The
// facilitator HTTP layer is stubbed via the global `fetch`; the
// `ExchangeReader` is an in-memory stub.

import { ExchangeState } from "@bosonprotocol/x402-actions";
import { buildCreateOfferAndCommitCalldata } from "@bosonprotocol/x402-evm";
import { metaTransactionTypedData } from "@bosonprotocol/x402-core/eip712";
import {
  createX402bServer,
  signFullOffer,
  type ExchangeReader,
  type FetchLike,
  type X402bServer,
} from "@bosonprotocol/x402-server";
import express from "express";
import supertest from "supertest";
import { describe, expect, it, vi } from "vitest";
import { parseSignature } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { expressMiddleware, INVALID_REQUEST_BODY, mountX402b } from "../src/index.js";

const ESCROW = "0xdddddddddddddddddddddddddddddddddddddddd" as const;
const TOKEN = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" as const;
const SELLER_PK = `0x${"22".repeat(32)}` as const;
const BUYER_PK = `0x${"33".repeat(32)}` as const;
const NETWORK = "eip155:8453" as const;
const CHAIN_ID = 8453;
const ZERO = "0x0000000000000000000000000000000000000000" as const;

const baseOffer = {
  price: "1000000",
  sellerDeposit: "0",
  agentId: "0",
  buyerCancelPenalty: "0",
  quantityAvailable: "1",
  validFromDateInMS: "1900000000000",
  validUntilDateInMS: "1900003600000",
  voucherRedeemableFromDateInMS: "1900000000000",
  voucherRedeemableUntilDateInMS: "1900003600000",
  disputePeriodDurationInMS: "86400000",
  voucherValidDurationInMS: "0",
  resolutionPeriodDurationInMS: "604800000",
  exchangeToken: TOKEN,
  disputeResolverId: "1",
  metadataUri: "ipfs://QmDeadBeef",
  metadataHash: "QmDeadBeef",
  collectionIndex: "0",
  feeLimit: "0",
  offerCreator: ZERO,
  committer: ZERO,
  condition: {
    method: 0,
    tokenType: 0,
    tokenAddress: ZERO,
    gatingType: 0,
    minTokenId: "0",
    threshold: "0",
    maxCommits: "0",
    maxTokenId: "0",
  },
  useDepositedFunds: false,
  sellerId: "12345",
  buyerId: "0",
  sellerOfferParams: {
    collectionIndex: "0",
    royaltyInfo: { recipients: [], bps: [] },
    mutualizerAddress: ZERO,
  },
};

function makeStubFetch(handler: (path: string) => unknown): FetchLike {
  return async (url, _init) => {
    const path = url.replace(/^https?:\/\/[^/]+/, "");
    const response = handler(path);
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify(response),
    };
  };
}

// Default reader returns COMMITTED — matches the Flow A
// (`boson-createOfferAndCommit`) post-state that the fixture's signed
// meta-tx targets. Per-test readers override below where needed.
const reader: ExchangeReader = {
  read: async () => ({
    state: ExchangeState.COMMITTED,
    seller: privateKeyToAccount(SELLER_PK).address,
    exchangeToken: TOKEN,
    price: "1000000",
  }),
};

async function buildServer(stub: FetchLike) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = stub as unknown as typeof globalThis.fetch;
  try {
    return createX402bServer({
      network: NETWORK,
      chainId: CHAIN_ID,
      escrow: ESCROW,
      signer: privateKeyToAccount(SELLER_PK),
      facilitator: { url: "https://facilitator.example" },
      channelRegistry: { channels: ["server", "facilitator", "onchain"], escrow: ESCROW },
      exchangeReader: reader,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function buildBuyerPayload() {
  const seller = privateKeyToAccount(SELLER_PK);
  const buyer = privateKeyToAccount(BUYER_PK);

  const offerRef = await signFullOffer({
    fullOffer: { ...baseOffer, offerCreator: seller.address },
    signer: seller,
    escrow: ESCROW,
    chainId: CHAIN_ID,
  });
  const calldata = await buildCreateOfferAndCommitCalldata({
    fullOffer: {
      ...offerRef.fullOffer,
      signature: offerRef.sellerSig,
    } as Parameters<typeof buildCreateOfferAndCommitCalldata>[0]["fullOffer"],
  });
  const td = await metaTransactionTypedData({
    chainId: CHAIN_ID,
    verifyingContract: ESCROW,
    message: {
      nonce: 1n,
      from: buyer.address,
      contractAddress: ESCROW,
      functionName: calldata.functionName,
      functionSignature: calldata.functionSignature,
    },
  });
  const sig = await buyer.signTypedData({
    domain: td.domain,
    types: td.types,
    primaryType: td.primaryType,
    message: td.message,
  });
  const parsed = parseSignature(sig);
  const v = parsed.v !== undefined ? Number(parsed.v) : parsed.yParity === 0 ? 27 : 28;

  const requirements = {
    scheme: "escrow" as const,
    network: NETWORK,
    asset: TOKEN,
    amount: "1000000",
    escrowAddress: ESCROW,
    recipientId: "did:boson:seller:12345",
    maxTimeoutSeconds: 3600,
    offer: offerRef,
    tokenAuthStrategies: ["none" as const],
    actions: {
      next: [
        {
          id: "boson-createOfferAndCommit",
          channels: ["server", "facilitator", "onchain"] as const,
        },
        {
          id: "boson-createOfferCommitAndRedeem",
          channels: ["server", "facilitator", "onchain"] as const,
        },
      ],
    },
  };

  const payload = {
    x402Version: 2,
    scheme: "escrow" as const,
    network: NETWORK,
    payload: {
      action: "boson-createOfferAndCommit",
      tokenAuthStrategy: "none" as const,
      offerRef: { fullOffer: offerRef.fullOffer, sellerSig: offerRef.sellerSig },
      buyer: buyer.address,
      metaTx: {
        from: buyer.address,
        nonce: "1",
        functionName: calldata.functionName,
        functionSignature: calldata.functionSignature,
        sig: { v, r: parsed.r, s: parsed.s },
      },
    },
  };

  return {
    requirements,
    payload,
    headerValue: Buffer.from(JSON.stringify(payload), "utf8").toString("base64"),
  };
}

describe("mountX402b — convenience routes", () => {
  // The fixture signs the Flow A meta-tx (`boson-createOfferAndCommit`)
  // and exercises the matching `/commit` route here. Flow B
  // (`/commit-and-redeem`) has its own happy-path test below.
  it("POST /x402b/commit returns 200 + nextActions", async () => {
    const { requirements, headerValue } = await buildBuyerPayload();
    const server = await buildServer(
      makeStubFetch(() => ({ ok: true, exchangeId: "42", txHash: "0xabc" })),
    );

    const app = express();
    app.use(express.json());
    app.use(
      mountX402b(server, {
        resolveRequirements: () =>
          requirements as unknown as Parameters<
            typeof server.buildPaymentRequirements
          >[0] extends never
            ? never
            : typeof requirements,
      }),
    );

    const res = await supertest(app).post("/x402b/commit").set("X-PAYMENT", headerValue).send();
    expect(res.status).toBe(200);
    expect(res.body.exchangeId).toBe("42");
    expect(res.body.txHash).toBe("0xabc");
    expect(res.body.nextActions.exchangeId).toBe("42");

    // X-PAYMENT-RESPONSE mirrors the JSON body so the buyer's client
    // can pick up exchange metadata without reading the resource body.
    const xpr = res.headers["x-payment-response"];
    expect(typeof xpr).toBe("string");
    const decoded = JSON.parse(Buffer.from(xpr as string, "base64").toString("utf8"));
    expect(decoded.exchangeId).toBe("42");
    expect(decoded.txHash).toBe("0xabc");
  });

  it("POST /x402b/complete forwards to performAction and returns 200", async () => {
    const { requirements } = await buildBuyerPayload();
    const completedReader: ExchangeReader = {
      read: async () => ({
        state: ExchangeState.COMPLETED,
        seller: privateKeyToAccount(SELLER_PK).address,
        exchangeToken: TOKEN,
        price: "1000000",
      }),
    };

    // Build a server pre-wired with the completed reader so the
    // facilitator client + reader are paired at construction time.
    const originalFetch = globalThis.fetch;
    globalThis.fetch = makeStubFetch((path) => {
      // The client appends `?action=<id>` to the perform-action path
      // so the facilitator can route per-action; match on the prefix.
      if (path.startsWith("/perform-action")) {
        return { ok: true, txHash: "0xfed", newExchangeState: "COMPLETED" };
      }
      return { ok: false, code: "INTERNAL_ERROR", reason: "unexpected path" };
    }) as unknown as typeof globalThis.fetch;
    let server;
    try {
      server = createX402bServer({
        network: NETWORK,
        chainId: CHAIN_ID,
        escrow: ESCROW,
        signer: privateKeyToAccount(SELLER_PK),
        facilitator: { url: "https://facilitator.example" },
        channelRegistry: { channels: ["server", "facilitator", "onchain"], escrow: ESCROW },
        exchangeReader: completedReader,
      });
    } finally {
      globalThis.fetch = originalFetch;
    }

    const app = express();
    app.use(express.json());
    app.use(
      mountX402b(server, {
        resolveRequirements: () =>
          requirements as unknown as Awaited<ReturnType<typeof server.buildPaymentRequirements>>,
      }),
    );

    const res = await supertest(app).post("/x402b/complete").send({
      exchangeId: "42",
      signedPayload: "0xc0ffee",
    });
    expect(res.status).toBe(200);
    expect(res.body.txHash).toBe("0xfed");

    // Post-commit actions don't carry a payment, so the response must
    // NOT include `X-PAYMENT-RESPONSE`. The header is reserved for
    // commit-time settlement responses (and the future deposit-paying
    // `escalateDispute` flow).
    expect(res.headers["x-payment-response"]).toBeUndefined();
  });

  it("POST /x402b/redeem forwards optional fulfillment data", async () => {
    const redeem = vi.fn(async () => ({
      ok: true as const,
      status: 200 as const,
      body: { txHash: "0xfed", nextActions: { next: [] } },
    }));
    const server = { handlers: { redeem } } as unknown as X402bServer;

    const app = express();
    app.use(express.json());
    app.use(mountX402b(server, { resolveRequirements: () => ({}) as never }));

    const fulfillment = { option: "email", data: { email: "new@example.com" } };
    const res = await supertest(app).post("/x402b/redeem").send({
      exchangeId: "42",
      signedPayload: "0xc0ffee",
      fulfillment,
    });

    expect(res.status).toBe(200);
    expect(redeem).toHaveBeenCalledWith({
      exchangeId: "42",
      signedPayload: "0xc0ffee",
      fulfillment,
    });
  });

  it("POST /x402b/redeem rejects a non-hex signedPayload with 400", async () => {
    const redeem = vi.fn();
    const server = { handlers: { redeem } } as unknown as X402bServer;
    const app = express();
    app.use(express.json());
    app.use(mountX402b(server, { resolveRequirements: () => ({}) as never }));

    const res = await supertest(app).post("/x402b/redeem").send({
      exchangeId: "42",
      signedPayload: "not-hex",
    });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe(INVALID_REQUEST_BODY);
    expect(redeem).not.toHaveBeenCalled();
  });

  it("POST /x402b/redeem rejects malformed fulfillment payload with 400", async () => {
    const redeem = vi.fn();
    const server = { handlers: { redeem } } as unknown as X402bServer;
    const app = express();
    app.use(express.json());
    app.use(mountX402b(server, { resolveRequirements: () => ({}) as never }));

    const res = await supertest(app).post("/x402b/redeem").send({
      exchangeId: "42",
      signedPayload: "0xc0ffee",
      fulfillment: "not-an-object",
    });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe(INVALID_REQUEST_BODY);
    expect(redeem).not.toHaveBeenCalled();
  });

  it("POST /x402b/complete rejects malformed body with 400", async () => {
    const server = await buildServer(makeStubFetch(() => ({ ok: true, txHash: "0x" })));
    const app = express();
    app.use(express.json());
    app.use(mountX402b(server, { resolveRequirements: () => ({}) as never }));

    const res = await supertest(app).post("/x402b/complete").send({ foo: "bar" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe(INVALID_REQUEST_BODY);
  });

  it("POST /x402b/withdraw-funds forwards to performAction and returns 200", async () => {
    const stubCoreSdk = {
      getFunds: async () => [],
      getSellersByAddress: async () => [],
      getBuyers: async () => [],
    };
    const originalFetch = globalThis.fetch;
    globalThis.fetch = makeStubFetch((path) => {
      if (path.startsWith("/perform-action")) {
        return { ok: true, txHash: "0xfed" };
      }
      return { ok: false, code: "INTERNAL_ERROR", reason: "unexpected path" };
    }) as unknown as typeof globalThis.fetch;
    let server;
    try {
      server = createX402bServer({
        network: NETWORK,
        chainId: CHAIN_ID,
        escrow: ESCROW,
        signer: privateKeyToAccount(SELLER_PK),
        facilitator: { url: "https://facilitator.example" },
        channelRegistry: { channels: ["server", "facilitator", "onchain"], escrow: ESCROW },
        coreSdkRead: stubCoreSdk,
      });
    } finally {
      globalThis.fetch = originalFetch;
    }

    const app = express();
    app.use(express.json());
    app.use(mountX402b(server, { resolveRequirements: () => ({}) as never }));

    const res = await supertest(app).post("/x402b/withdraw-funds").send({
      entityId: "42",
      signedPayload: "0xc0ffee",
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ txHash: "0xfed", entityId: "42" });
  });

  it("POST /x402b/withdraw-funds 400s when entityId and address are both set", async () => {
    const server = await buildServer(makeStubFetch(() => ({ ok: true })));
    const app = express();
    app.use(express.json());
    app.use(mountX402b(server, { resolveRequirements: () => ({}) as never }));

    const res = await supertest(app).post("/x402b/withdraw-funds").send({
      entityId: "42",
      address: "0x1111111111111111111111111111111111111111",
      signedPayload: "0xc0ffee",
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_REQUEST_BODY");
  });

  it("POST /x402b/withdraw-funds rejects a non-hex signedPayload with 400", async () => {
    const withdrawFunds = vi.fn();
    const server = { handlers: { withdrawFunds } } as unknown as X402bServer;
    const app = express();
    app.use(express.json());
    app.use(mountX402b(server, { resolveRequirements: () => ({}) as never }));

    const res = await supertest(app).post("/x402b/withdraw-funds").send({
      entityId: "42",
      signedPayload: "not-hex",
    });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe(INVALID_REQUEST_BODY);
    expect(withdrawFunds).not.toHaveBeenCalled();
  });

  it("GET /x402b/available-funds returns the reshaped funds list", async () => {
    const stubCoreSdk = {
      getFunds: async (queryVars: { fundsFilter: { accountId: string } }) => {
        expect(queryVars.fundsFilter.accountId).toBe("42");
        return [
          {
            accountId: "42",
            availableAmount: "1500000",
            token: {
              address: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
              decimals: "6",
              symbol: "USDC",
              name: "USD Coin",
            },
          },
        ];
      },
      getSellersByAddress: async () => [],
      getBuyers: async () => [],
    };
    const server = createX402bServer({
      network: NETWORK,
      chainId: CHAIN_ID,
      escrow: ESCROW,
      signer: privateKeyToAccount(SELLER_PK),
      facilitator: { url: "https://facilitator.example" },
      channelRegistry: { channels: ["server", "facilitator", "onchain"], escrow: ESCROW },
      coreSdkRead: stubCoreSdk,
    });

    const app = express();
    app.use(express.json());
    app.use(mountX402b(server, { resolveRequirements: () => ({}) as never }));

    const res = await supertest(app).get("/x402b/available-funds?entityId=42");
    expect(res.status).toBe(200);
    expect(res.body.entityId).toBe("42");
    expect(res.body.funds).toHaveLength(1);
    expect(res.body.funds[0].tokenSymbol).toBe("USDC");
    expect(res.body.funds[0].availableAmount).toBe("1500000");
  });

  it("GET /x402b/available-funds 400s when neither entityId nor address is set", async () => {
    const server = await buildServer(makeStubFetch(() => ({ ok: true })));
    const app = express();
    app.use(express.json());
    app.use(mountX402b(server, { resolveRequirements: () => ({}) as never }));

    const res = await supertest(app).get("/x402b/available-funds");
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_REQUEST_QUERY");
  });

  it.each([["/x402b/commit"], ["/x402b/commit-and-redeem"]])(
    "POST %s without X-PAYMENT returns the canonical x402 challenge",
    async (path) => {
      // Commit routes hit without `X-PAYMENT` should emit the same
      // `{ x402Version, accepts: [...] }` body as `expressMiddleware()`,
      // not the handler's structured-error 402. This is what x402
      // clients pattern-match on to retry with the signed payment.
      const { requirements } = await buildBuyerPayload();
      const server = await buildServer(makeStubFetch(() => ({ ok: true })));

      const app = express();
      app.use(express.json());
      app.use(
        mountX402b(server, {
          resolveRequirements: () =>
            requirements as unknown as Awaited<ReturnType<typeof server.buildPaymentRequirements>>,
        }),
      );

      const res = await supertest(app).post(path).send();
      expect(res.status).toBe(402);
      expect(res.body.x402Version).toBe(2);
      expect(Array.isArray(res.body.accepts)).toBe(true);
      expect(res.body.accepts[0].scheme).toBe("escrow");
      // Structured-error fields must NOT leak when emitting the
      // canonical challenge.
      expect(res.body.code).toBeUndefined();
      expect(res.body.reason).toBeUndefined();
    },
  );
});

describe("expressMiddleware — 402 challenge + settle gating", () => {
  it("issues 402 with the resolved PaymentRequirements when X-PAYMENT is missing", async () => {
    const { requirements } = await buildBuyerPayload();
    const server = await buildServer(makeStubFetch(() => ({ ok: true })));

    const app = express();
    app.use(express.json());
    app.get(
      "/datafeed",
      expressMiddleware(server, {
        resolveRequirements: () =>
          requirements as unknown as Awaited<ReturnType<typeof server.buildPaymentRequirements>>,
      }),
      (_req, res) => res.json({ kpi: 42 }),
    );

    const res = await supertest(app).get("/datafeed");
    expect(res.status).toBe(402);
    expect(res.body.x402Version).toBe(2);
    expect(res.body.accepts[0]).toBeDefined();
    expect(res.body.accepts[0].scheme).toBe("escrow");
  });

  it("proxies to the route handler when X-PAYMENT validates", async () => {
    const { requirements, headerValue } = await buildBuyerPayload();
    const server = await buildServer(
      makeStubFetch(() => ({ ok: true, exchangeId: "99", txHash: "0xfeedface" })),
    );

    const app = express();
    app.use(express.json());
    app.get(
      "/datafeed",
      // Fixture signs Flow A; configure the middleware accordingly.
      expressMiddleware(server, {
        flow: "commit",
        resolveRequirements: () =>
          requirements as unknown as Awaited<ReturnType<typeof server.buildPaymentRequirements>>,
      }),
      (_req, res) => {
        res.json({ kpi: 42, x402b: res.locals.x402b });
      },
    );

    const res = await supertest(app).get("/datafeed").set("X-PAYMENT", headerValue);
    expect(res.status).toBe(200);
    expect(res.body.kpi).toBe(42);
    expect(res.body.x402b.exchangeId).toBe("99");

    // The middleware also stamps X-PAYMENT-RESPONSE on successful settle.
    const xpr = res.headers["x-payment-response"];
    expect(typeof xpr).toBe("string");
    const decoded = JSON.parse(Buffer.from(xpr as string, "base64").toString("utf8"));
    expect(decoded.exchangeId).toBe("99");
    expect(decoded.txHash).toBe("0xfeedface");
  });

  it("defaults to the commit handler (Flow A) when `flow` is omitted", async () => {
    // The fixture signs `boson-createOfferAndCommit` (Flow A). With the
    // default in place this path settles cleanly; under the previous
    // `commit-and-redeem` default the action wouldn't match.
    const { requirements, headerValue } = await buildBuyerPayload();
    const server = await buildServer(
      makeStubFetch(() => ({ ok: true, exchangeId: "101", txHash: "0xc0ffee" })),
    );

    const app = express();
    app.use(express.json());
    app.get(
      "/datafeed",
      expressMiddleware(server, {
        resolveRequirements: () =>
          requirements as unknown as Awaited<ReturnType<typeof server.buildPaymentRequirements>>,
      }),
      (_req, res) => res.json({ x402b: res.locals.x402b }),
    );

    const res = await supertest(app).get("/datafeed").set("X-PAYMENT", headerValue);
    expect(res.status).toBe(200);
    expect(res.body.x402b.exchangeId).toBe("101");
  });

  it("forwards validator failures as the suggested status", async () => {
    const { requirements, payload } = await buildBuyerPayload();
    const server = await buildServer(makeStubFetch(() => ({ ok: true })));

    const tampered = {
      ...payload,
      payload: {
        ...payload.payload,
        offerRef: { ...payload.payload.offerRef, sellerSig: "0xdeadbeef" },
      },
    };
    const tamperedHeader = Buffer.from(JSON.stringify(tampered), "utf8").toString("base64");

    const app = express();
    app.use(express.json());
    app.get(
      "/datafeed",
      expressMiddleware(server, {
        flow: "commit",
        resolveRequirements: () =>
          requirements as unknown as Awaited<ReturnType<typeof server.buildPaymentRequirements>>,
      }),
      (_req, res) => res.json({ kpi: 42 }),
    );

    const res = await supertest(app).get("/datafeed").set("X-PAYMENT", tamperedHeader);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("SELLER_SIG_MISMATCH");
  });
});
