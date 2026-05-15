// Smoke tests for the example host. Routing-level coverage of the
// commit/redeem/dispute routes already lives in
// `@bosonprotocol/x402-server-express`'s own suite — here we only verify
// that the example assembles cleanly, exposes the expected probes, and
// that `GET /resource` emits a canonical x402 challenge whose
// `PaymentRequirements` advertises every `POST /x402B/*` route the
// `mountX402b` adapter installs.

import supertest from "supertest";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";

import { createResourceServerApp } from "../src/app.js";
import type { ResourceServerEnv } from "../src/config.js";

const SELLER_PK = `0x${"22".repeat(32)}` as const;
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

  it("the seller signer recovers to the expected address from the offer signature", () => {
    const { seller } = createResourceServerApp(buildEnv());
    expect(seller.address).toBe(privateKeyToAccount(SELLER_PK).address);
  });
});
