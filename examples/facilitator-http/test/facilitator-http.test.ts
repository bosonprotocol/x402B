// Smoke tests for the example host. Routing-level coverage of the
// facilitator endpoints already lives in
// `@bosonprotocol/x402-facilitator-express`'s own suite — here we
// only verify that the example assembles cleanly and exposes
// `/health` + the facilitator routes under the host app.
//
// The `walletClient` / `publicClient` stubs below carry rejecting
// implementations of every method `@bosonprotocol/x402-facilitator`
// might reach for. With today's upstream, `{}` request bodies are
// rejected by the structural / config guards in `verify()` long before
// either client is touched, so the stubs are inert. They exist as
// defence-in-depth: if a future upstream change reorders validation —
// or relaxes the schemas so `{}` slips past Zod — these tests would
// otherwise start throwing `TypeError: x is not a function` and read
// as a regression in this package rather than upstream. With the
// stubs in place, any reach into a client method surfaces as a
// rejected promise that `verify()`'s `try/catch` normalises to
// `{ ok: false, code: "INTERNAL_ERROR" }` (still HTTP 400), keeping
// the assertions below honest.

import type { FacilitatorConfig } from "@bosonprotocol/x402-facilitator";
import supertest from "supertest";
import type { PublicClient, WalletClient } from "viem";
import { describe, expect, it } from "vitest";

import { createFacilitatorApp } from "../src/app.js";

const ESCROW = "0xdddddddddddddddddddddddddddddddddddddddd" as const;
const RELAYER = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" as const;
const CHAIN_ID = 31337;
const NETWORK = "eip155:31337" as const;

function rejectingStub(method: string): (...args: unknown[]) => Promise<never> {
  return () =>
    Promise.reject(new Error(`smoke-test stub: ${method} should not be reached for {} bodies`));
}

function stubConfig(): FacilitatorConfig {
  const walletClient = {
    account: { address: RELAYER, type: "json-rpc" },
    chain: { id: CHAIN_ID },
    getChainId: () => Promise.resolve(CHAIN_ID),
    sendTransaction: rejectingStub("walletClient.sendTransaction"),
    signTypedData: rejectingStub("walletClient.signTypedData"),
    signMessage: rejectingStub("walletClient.signMessage"),
    request: rejectingStub("walletClient.request"),
  } as unknown as WalletClient;
  const publicClient = {
    chain: { id: CHAIN_ID },
    getChainId: () => Promise.resolve(CHAIN_ID),
    readContract: rejectingStub("publicClient.readContract"),
    call: rejectingStub("publicClient.call"),
    waitForTransactionReceipt: rejectingStub("publicClient.waitForTransactionReceipt"),
    estimateGas: rejectingStub("publicClient.estimateGas"),
    request: rejectingStub("publicClient.request"),
  } as unknown as PublicClient;
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
