// Smoke tests for the example host. Routing-level coverage of the
// facilitator endpoints already lives in
// `@bosonprotocol/x402-facilitator-express`'s own suite — here we
// only verify that the example assembles cleanly and exposes
// `/health` + the facilitator routes under the host app.

import type { FacilitatorConfig } from "@bosonprotocol/x402-facilitator";
import supertest from "supertest";
import type { PublicClient, WalletClient } from "viem";
import { describe, expect, it } from "vitest";

import { createFacilitatorApp } from "../src/app.js";

const ESCROW = "0xdddddddddddddddddddddddddddddddddddddddd" as const;
const RELAYER = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" as const;
const NETWORK = "eip155:31337" as const;

function stubConfig(): FacilitatorConfig {
  const walletClient = {
    account: { address: RELAYER, type: "json-rpc" },
    chain: { id: 31337 },
  } as unknown as WalletClient;
  const publicClient = {} as unknown as PublicClient;
  return {
    url: "http://facilitator.example",
    supportedNetworks: [NETWORK],
    escrows: { [NETWORK]: ESCROW },
    walletClient,
    publicClient,
  };
}

describe("facilitator-http example app", () => {
  it("GET /health returns ok", async () => {
    const app = createFacilitatorApp(stubConfig());
    const res = await supertest(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it("POST /verify is mounted (returns 400 on empty body)", async () => {
    const app = createFacilitatorApp(stubConfig());
    const res = await supertest(app).post("/verify").send({});
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  it("POST /settle is mounted (returns 400 on empty body)", async () => {
    const app = createFacilitatorApp(stubConfig());
    const res = await supertest(app).post("/settle").send({});
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  it("POST /perform-action is mounted (returns 400 on empty body)", async () => {
    const app = createFacilitatorApp(stubConfig());
    const res = await supertest(app).post("/perform-action").send({});
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  it("unknown sub-routes return 404", async () => {
    const app = createFacilitatorApp(stubConfig());
    const res = await supertest(app).post("/does-not-exist").send({});
    expect(res.status).toBe(404);
  });
});
