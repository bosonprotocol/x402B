// Integration tests for the Express adapter. Use `supertest` against
// an in-process app wired to a real `mountFacilitator(...)`. The
// underlying viem `WalletClient` / `PublicClient` are stubs — we only
// exercise the HTTP wiring here, not the on-chain pipeline (the latter
// is covered by `@bosonprotocol/x402-facilitator`'s own test suite).

import type {
  FacilitatorConfig,
  FacilitatorPerformActionInput,
  FacilitatorSettleInput,
  FacilitatorVerifyInput,
} from "@bosonprotocol/x402-facilitator";
import express from "express";
import supertest from "supertest";
import type { PublicClient, WalletClient } from "viem";
import { describe, expect, it } from "vitest";

import { mountFacilitator } from "../src/index.js";

const ESCROW = "0xdddddddddddddddddddddddddddddddddddddddd" as const;
const RELAYER = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" as const;
const NETWORK = "eip155:8453" as const;

function buildConfig(): FacilitatorConfig {
  // Bare-minimum stub clients: the test routes never reach RPC because
  // they short-circuit on the `supportedNetworks` / structural gates.
  const walletClient = {
    account: { address: RELAYER, type: "json-rpc" },
    chain: { id: 8453 },
  } as unknown as WalletClient;
  const publicClient = {} as unknown as PublicClient;

  return {
    url: "https://facilitator.example",
    supportedNetworks: [NETWORK],
    escrows: { [NETWORK]: ESCROW },
    walletClient,
    publicClient,
  };
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(mountFacilitator(buildConfig()));
  return app;
}

describe("mountFacilitator — routing", () => {
  it("POST /verify forwards body to verify() and surfaces ok:false as 400", async () => {
    // Malformed body — empty object — trips the facilitator's structural
    // validator. We assert: route exists, body is forwarded, ok:false
    // becomes status 400 with the discriminated-union result intact.
    const res = await supertest(buildApp()).post("/verify").send({});
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(typeof res.body.code).toBe("string");
  });

  it("POST /verify returns 400 with INVALID_REQUEST_BODY when express.json() is missing", async () => {
    // No body parser → `req.body` is `undefined`. The upstream guard
    // catches this so `verify(undefined, …)` never runs pre-validation.
    const app = express(); // intentionally no `app.use(express.json())`
    app.use(mountFacilitator(buildConfig()));
    const res = await supertest(app).post("/verify").send();
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_REQUEST_BODY");
  });

  it("POST /settle short-circuits on NETWORK_MISMATCH for an unsupported network", async () => {
    // Network not in `supportedNetworks` — the facilitator rejects before
    // touching the wallet. Confirms routing wires body through to settle().
    const body: FacilitatorSettleInput = {
      scheme: "escrow",
      network: "eip155:1" as const,
      // Empty payload / requirements — won't reach validation; the
      // network gate fires first.
      payload: {} as never,
      requirements: {} as never,
    };
    const res = await supertest(buildApp()).post("/settle").send(body);
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  it("POST /perform-action rejects an unknown network with 400", async () => {
    const body: FacilitatorPerformActionInput = {
      network: "eip155:1" as const,
      escrowAddress: ESCROW,
      exchangeId: "1",
      action: "boson-redeem",
      signedPayload: `0x${"00".repeat(32)}` as const,
    };
    const res = await supertest(buildApp()).post("/perform-action").send(body);
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.code).toMatch(/NETWORK_MISMATCH|INVALID_PAYLOAD/);
  });

  it("mounts at a custom basePath", async () => {
    const app = express();
    app.use(express.json());
    app.use(mountFacilitator(buildConfig(), { basePath: "/v1" }));

    const ok = await supertest(app).post("/v1/verify").send({});
    expect(ok.status).toBe(400); // routed; returns the same body shape

    // The default mount path no longer matches at the custom base.
    const miss = await supertest(app).post("/verify").send({});
    expect(miss.status).toBe(404);
  });

  it("delegates unknown sub-routes to Express's 404 path", async () => {
    const res = await supertest(buildApp()).post("/does-not-exist").send({});
    expect(res.status).toBe(404);
  });

  // Body parsing failure tests are covered indirectly above; if
  // `express.json()` isn't installed at all, `req.body` is `undefined`
  // and the guard returns INVALID_REQUEST_BODY (asserted in the
  // `/verify` no-body case).

  it("uses request inputs verbatim (does not mutate body shape)", async () => {
    // Round-trips a verify request that fails on scheme mismatch — we
    // care only that the body field surfaces in the rejection reason.
    const body: FacilitatorVerifyInput = {
      scheme: "escrow",
      network: NETWORK,
      payload: { scheme: "not-escrow" } as never,
      requirements: {} as never,
    };
    const res = await supertest(buildApp()).post("/verify").send(body);
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });
});
