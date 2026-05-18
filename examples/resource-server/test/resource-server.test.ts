// Smoke tests for the example host. Routing-level coverage of the
// commit/redeem/dispute routes already lives in
// `@bosonprotocol/x402-server-express`'s own suite — here we only verify
// that the example assembles cleanly, exposes the expected probes, and
// that `GET /resource` emits a canonical x402 challenge whose
// `PaymentRequirements` advertises every `POST /x402B/*` route the
// `mountX402b` adapter installs.

import { ExchangeState } from "@bosonprotocol/x402-actions";
import { metaTransactionTypedData } from "@bosonprotocol/x402-core/eip712";
import { buildCreateOfferAndCommitCalldata } from "@bosonprotocol/x402-evm";
import type { ExchangeReader, FetchLike } from "@bosonprotocol/x402-server";
import supertest from "supertest";
import { parseSignature } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";

import { createResourceServerApp } from "../src/app.js";
import { buildExampleChannelRegistry } from "../src/channel-registry.js";
import type { ResourceServerEnv } from "../src/config.js";

const SELLER_PK = `0x${"22".repeat(32)}` as const;
const BUYER_PK = `0x${"33".repeat(32)}` as const;
const ESCROW = "0xdddddddddddddddddddddddddddddddddddddddd" as const;
const TOKEN = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" as const;

function buildEnv(overrides: Partial<ResourceServerEnv> = {}): ResourceServerEnv {
  return {
    publicUrl: "http://resource.example",
    rpcNode: "http://rpc.example",
    chainId: 31337,
    network: "eip155:31337",
    escrowAddress: ESCROW,
    facilitatorUrl: "http://facilitator.example",
    sellerPk: SELLER_PK,
    sellerId: "12345",
    disputeResolverId: "1",
    assetAddress: TOKEN,
    amount: "1000000",
    maxTimeoutSeconds: 3600,
    port: 4001,
    ...overrides,
  };
}

describe("resource-server example app", () => {
  it("GET /health returns ok", async () => {
    const { app } = createResourceServerApp(buildEnv());
    const res = await supertest(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it("GET /resource without X-PAYMENT emits a 402 with PaymentRequirements", async () => {
    const { app } = createResourceServerApp(buildEnv());
    const res = await supertest(app).get("/resource");

    expect(res.status).toBe(402);
    expect(res.body.x402Version).toBe(2);
    expect(Array.isArray(res.body.accepts)).toBe(true);
    expect(res.body.accepts).toHaveLength(1);

    const requirements = res.body.accepts[0];
    expect(requirements.scheme).toBe("escrow");
    expect(requirements.network).toBe("eip155:31337");
    expect(requirements.escrowAddress.toLowerCase()).toBe(ESCROW);
    expect(requirements.asset.toLowerCase()).toBe(TOKEN);
    expect(requirements.amount).toBe("1000000");
  });

  it("the 402 challenge advertises the server-channel commit endpoint under RESOURCE_SERVER_URL", async () => {
    const { app } = createResourceServerApp(buildEnv());
    const res = await supertest(app).get("/resource");

    const next = res.body.accepts[0].actions.next;
    expect(Array.isArray(next)).toBe(true);

    const commit = next.find((a: { id: string }) => a.id === "boson-createOfferAndCommit");
    expect(commit).toBeDefined();
    expect(commit.channels).toContain("server");
    expect(commit.endpoints?.server).toBe("http://resource.example/x402B/commit");
  });

  // The 402 challenge `next` only surfaces the two PRE_COMMIT actions, so
  // the assertion above can't catch a typo in any of the other seven
  // mapped routes (redeem / complete / dispute/* / withdraw-funds). Pin
  // the full action→URL map produced by `buildExampleChannelRegistry`
  // so a stale path in `ROUTE_FOR_ACTION` fails this package's tests
  // rather than turning into a buyer-facing 404 mid-flow.
  it("buildExampleChannelRegistry maps every advertised action to its mountX402b path", () => {
    const registry = buildExampleChannelRegistry(buildEnv());
    expect(registry.endpoints).toEqual({
      "boson-createOfferAndCommit": "http://resource.example/x402B/commit",
      "boson-createOfferCommitAndRedeem": "http://resource.example/x402B/commit-and-redeem",
      "boson-redeem": "http://resource.example/x402B/redeem",
      "boson-completeExchange": "http://resource.example/x402B/complete",
      "boson-raiseDispute": "http://resource.example/x402B/dispute/raise",
      "boson-resolveDispute": "http://resource.example/x402B/dispute/resolve",
      "boson-retractDispute": "http://resource.example/x402B/dispute/retract",
      "boson-escalateDispute": "http://resource.example/x402B/dispute/escalate",
      "boson-withdrawFunds": "http://resource.example/x402B/withdraw-funds",
    });
  });

  // Closes the loop on the pin above: even if the registry and
  // `mountX402b` agreed on the *same* typo, the URL would still not
  // resolve to a real route. POST to every advertised path and assert
  // non-404. Route-internal failures (402 for missing X-PAYMENT, 400
  // INVALID_REQUEST_BODY for missing payload) all prove the path
  // resolved — only Express's default 404 indicates a dead endpoint.
  it("every channel-registry endpoint resolves to a mounted POST route", async () => {
    const env = buildEnv();
    const { app } = createResourceServerApp(env);
    const registry = buildExampleChannelRegistry(env);
    const entries = Object.entries(registry.endpoints ?? {}) as [string, string][];
    expect(entries.length).toBeGreaterThan(0);
    for (const [action, url] of entries) {
      const path = new URL(url).pathname;
      const res = await supertest(app).post(path).send();
      expect(res.status, `${action} → POST ${path} returned 404`).not.toBe(404);
    }
  });

  it("POST /x402B/commit without X-PAYMENT emits the same 402 challenge as /resource", async () => {
    const { app } = createResourceServerApp(buildEnv());
    const res = await supertest(app).post("/x402B/commit").send();
    expect(res.status).toBe(402);
    expect(res.body.x402Version).toBe(2);
    expect(res.body.accepts).toHaveLength(1);
  });

  it("POST /x402b/commit (lowercase alias) routes to the same handler", async () => {
    const { app } = createResourceServerApp(buildEnv());
    const res = await supertest(app).post("/x402b/commit").send();
    expect(res.status).toBe(402);
  });

  it("GET /config echoes the resolved PaymentRequirements for debugging", async () => {
    const { app } = createResourceServerApp(buildEnv());
    const res = await supertest(app).get("/config");
    expect(res.status).toBe(200);
    expect(res.body.scheme).toBe("escrow");
    expect(res.body.network).toBe("eip155:31337");
  });

  it("the seller signer address matches the configured private key", () => {
    const { seller } = createResourceServerApp(buildEnv());
    expect(seller.address).toBe(privateKeyToAccount(SELLER_PK).address);
  });

  // Regression: the express adapters call `resolveRequirements` once
  // for the 402 challenge and again when the buyer retries with
  // `X-PAYMENT`. If the second call rebuilds the offer with a fresh
  // `Date.now()`, the validator's Rule 3 deep-equality on
  // `payload.offerRef.fullOffer` vs `requirements.offer.fullOffer`
  // fails (`FULL_OFFER_MISMATCH`) and the settle returns 4xx even
  // when the buyer behaved correctly. The cache in
  // `createResourceServerApp` must hold the same signed offer across
  // the two calls.
  it("POST /x402B/commit accepts the X-PAYMENT signed against the 402 challenge body", async () => {
    // `now` advances on every call so that *without* the cache the
    // settle-time `buildUnsignedOffer` would see a different timestamp
    // than the challenge-time one and the validator would hit Rule 3.
    // Anchor at the real clock so `buildCreateOfferAndCommitCalldata`'s
    // core-sdk yup schema (which checks `validUntilDateInMS` against the
    // process's wall-clock `Date.now`) accepts the offer.
    let tick = Date.now();
    const now = () => tick++;

    const reader: ExchangeReader = {
      read: async () => ({
        state: ExchangeState.COMMITTED,
        seller: privateKeyToAccount(SELLER_PK).address,
        exchangeToken: TOKEN,
        price: "1000000",
      }),
    };

    const stubFetch: FetchLike = async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ ok: true, exchangeId: "42", txHash: "0xabc" }),
    });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = stubFetch as unknown as typeof globalThis.fetch;
    try {
      const { app } = createResourceServerApp(buildEnv(), {
        exchangeReader: reader,
        now,
      });

      const challenge = await supertest(app).get("/resource");
      expect(challenge.status).toBe(402);
      const requirements = challenge.body.accepts[0];

      const buyer = privateKeyToAccount(BUYER_PK);
      const calldata = await buildCreateOfferAndCommitCalldata({
        fullOffer: {
          ...requirements.offer.fullOffer,
          signature: requirements.offer.sellerSig,
        } as Parameters<typeof buildCreateOfferAndCommitCalldata>[0]["fullOffer"],
      });
      const td = await metaTransactionTypedData({
        chainId: 31337,
        verifyingContract: requirements.escrowAddress,
        message: {
          nonce: 1n,
          from: buyer.address,
          contractAddress: requirements.escrowAddress,
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

      const payload = {
        x402Version: 2,
        scheme: "escrow" as const,
        network: requirements.network,
        payload: {
          action: "boson-createOfferAndCommit" as const,
          tokenAuthStrategy: "none" as const,
          offerRef: {
            fullOffer: requirements.offer.fullOffer,
            sellerSig: requirements.offer.sellerSig,
          },
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
      const headerValue = Buffer.from(JSON.stringify(payload), "utf8").toString("base64");

      const settle = await supertest(app)
        .post("/x402B/commit")
        .set("X-PAYMENT", headerValue)
        .send();

      expect(settle.status).toBe(200);
      expect(settle.body.exchangeId).toBe("42");
      expect(settle.body.txHash).toBe("0xabc");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
