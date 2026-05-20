// Tests for the `paywall` integration in `expressMiddleware` and
// `mountX402b`. Focus is the content-negotiation contract — the same
// 402 challenge surface that already serves JSON now serves HTML when
// the request prefers `text/html` and the caller has supplied a
// `PaywallProvider`. JSON behaviour must be unchanged for every other
// case (no paywall, JSON Accept header, missing Accept, unsupported
// scheme).
//
// We drive the middleware with a stubbed `X402bServer` — the real
// commit handler isn't exercised here, just the challenge path that
// fires when `X-PAYMENT` is missing.

import type { X402bServer } from "@bosonprotocol/x402-server";
import express from "express";
import supertest from "supertest";
import { describe, expect, it, vi, type Mock } from "vitest";

import { expressMiddleware, mountX402b } from "../src/index.js";
import type { PaywallProviderLike } from "../src/internal/x402-challenge.js";

const REQUIREMENTS = {
  scheme: "escrow" as const,
  network: "eip155:8453",
  asset: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
  amount: "1000000",
  escrowAddress: "0xdddddddddddddddddddddddddddddddddddddddd",
  recipientId: "did:boson:seller:1",
  maxTimeoutSeconds: 300,
  offer: {
    fullOffer: {},
    sellerSig: "0xdead",
    creator: "0x1111111111111111111111111111111111111111",
  },
  tokenAuthStrategies: ["erc3009" as const],
  actions: { next: [{ id: "boson-createOfferAndCommit", channels: ["server" as const] }] },
};

function makePaywall(opts?: { supports?: boolean; html?: string }): PaywallProviderLike & {
  supports: Mock;
  generateHtml: Mock;
} {
  return {
    supports: vi.fn().mockReturnValue(opts?.supports ?? true),
    generateHtml: vi
      .fn()
      .mockReturnValue(opts?.html ?? "<!DOCTYPE html><html><body>paywall</body></html>"),
  };
}

// Empty handlers — we only exercise the challenge path (missing X-PAYMENT),
// which short-circuits before any handler runs.
const emptyServer = { handlers: {} } as unknown as X402bServer;

describe("expressMiddleware — paywall content negotiation", () => {
  it("serves HTML when Accept prefers text/html and paywall.supports() is true", async () => {
    const paywall = makePaywall({ html: "<!DOCTYPE html><html><body>hi</body></html>" });

    const app = express();
    app.get(
      "/datafeed",
      expressMiddleware(emptyServer, {
        resolveRequirements: () => REQUIREMENTS,
        paywall,
        paywallConfig: { appName: "Test" },
      }),
      (_req, res) => res.json({ kpi: 42 }),
    );

    const res = await supertest(app).get("/datafeed").set("Accept", "text/html");

    expect(res.status).toBe(402);
    expect(res.headers["content-type"]).toMatch(/text\/html/);
    expect(res.text).toContain("<!DOCTYPE html>");
    expect(paywall.generateHtml).toHaveBeenCalledTimes(1);
    expect(paywall.generateHtml).toHaveBeenCalledWith(
      expect.objectContaining({
        requirements: REQUIREMENTS,
        currentUrl: expect.stringContaining("/datafeed"),
      }),
      { appName: "Test" },
    );
  });

  it("serves JSON when Accept prefers application/json (browser API client)", async () => {
    const paywall = makePaywall();

    const app = express();
    app.get(
      "/datafeed",
      expressMiddleware(emptyServer, {
        resolveRequirements: () => REQUIREMENTS,
        paywall,
      }),
      (_req, res) => res.json({ kpi: 42 }),
    );

    const res = await supertest(app).get("/datafeed").set("Accept", "application/json");

    expect(res.status).toBe(402);
    expect(res.headers["content-type"]).toMatch(/application\/json/);
    expect(res.body.x402Version).toBe(2);
    expect(res.body.accepts[0].scheme).toBe("escrow");
    expect(paywall.generateHtml).not.toHaveBeenCalled();
  });

  it("serves JSON when no Accept header is sent (e.g. a default fetch() with no headers)", async () => {
    const paywall = makePaywall();

    const app = express();
    app.get(
      "/datafeed",
      expressMiddleware(emptyServer, {
        resolveRequirements: () => REQUIREMENTS,
        paywall,
      }),
      (_req, res) => res.json({ kpi: 42 }),
    );

    // supertest forces an Accept header by default; explicitly clear it.
    const res = await supertest(app).get("/datafeed").set("Accept", "");

    expect(res.status).toBe(402);
    expect(res.headers["content-type"]).toMatch(/application\/json/);
    expect(paywall.generateHtml).not.toHaveBeenCalled();
  });

  it("serves JSON when paywall.supports() returns false (scheme not supported)", async () => {
    const paywall = makePaywall({ supports: false });

    const app = express();
    app.get(
      "/datafeed",
      expressMiddleware(emptyServer, {
        resolveRequirements: () => REQUIREMENTS,
        paywall,
      }),
      (_req, res) => res.json({ kpi: 42 }),
    );

    const res = await supertest(app).get("/datafeed").set("Accept", "text/html");

    expect(res.status).toBe(402);
    expect(res.headers["content-type"]).toMatch(/application\/json/);
    expect(paywall.supports).toHaveBeenCalledWith(REQUIREMENTS);
    expect(paywall.generateHtml).not.toHaveBeenCalled();
  });

  it("serves JSON when no paywall is configured (no regression to existing behaviour)", async () => {
    const app = express();
    app.get(
      "/datafeed",
      expressMiddleware(emptyServer, { resolveRequirements: () => REQUIREMENTS }),
      (_req, res) => res.json({ kpi: 42 }),
    );

    const res = await supertest(app).get("/datafeed").set("Accept", "text/html");

    expect(res.status).toBe(402);
    expect(res.headers["content-type"]).toMatch(/application\/json/);
    expect(res.body.x402Version).toBe(2);
  });

  it("forwards a checkout-style currentUrl built from req.protocol + host + originalUrl", async () => {
    const paywall = makePaywall();

    const app = express();
    app.get(
      "/checkout/abc123",
      expressMiddleware(emptyServer, {
        resolveRequirements: () => REQUIREMENTS,
        paywall,
      }),
      (_req, res) => res.json({ ok: true }),
    );

    await supertest(app).get("/checkout/abc123?coupon=10").set("Accept", "text/html");

    const callArg = paywall.generateHtml.mock.calls[0]?.[0] as {
      currentUrl?: string;
    };
    expect(callArg.currentUrl).toContain("/checkout/abc123?coupon=10");
    // Includes scheme + host so the React app can fetch against an absolute URL.
    expect(callArg.currentUrl).toMatch(/^https?:\/\/[^/]+\//);
  });

  it("does not invoke the paywall on a successful settle path (X-PAYMENT present)", async () => {
    // When X-PAYMENT is supplied the middleware goes through the
    // handler — even if that handler errors out, the paywall must not
    // see the request. (The handler stub here lets us verify exactly
    // that without wiring a full commit flow.)
    const paywall = makePaywall();
    const stubServer = {
      handlers: {
        commit: vi.fn(async () => ({
          ok: false as const,
          status: 400 as const,
          body: { code: "STUBBED", reason: "intentional" },
        })),
      },
    } as unknown as X402bServer;

    const app = express();
    app.get(
      "/datafeed",
      expressMiddleware(stubServer, {
        resolveRequirements: () => REQUIREMENTS,
        paywall,
      }),
      (_req, res) => res.json({ kpi: 42 }),
    );

    const res = await supertest(app)
      .get("/datafeed")
      .set("Accept", "text/html")
      .set("X-PAYMENT", "anything-goes-base64");

    expect(res.status).toBe(400);
    expect(paywall.generateHtml).not.toHaveBeenCalled();
  });
});

describe("mountX402b — paywall content negotiation on commit routes", () => {
  it("POST /x402B/commit without X-PAYMENT serves HTML when Accept prefers text/html", async () => {
    const paywall = makePaywall({
      html: '<!DOCTYPE html><html><body data-test="commit-route">x</body></html>',
    });

    const app = express();
    app.use(express.json());
    app.use(
      mountX402b(emptyServer, {
        resolveRequirements: () => REQUIREMENTS,
        paywall,
      }),
    );

    const res = await supertest(app).post("/x402B/commit").set("Accept", "text/html").send();

    expect(res.status).toBe(402);
    expect(res.headers["content-type"]).toMatch(/text\/html/);
    expect(res.text).toContain('data-test="commit-route"');
  });

  it("POST /x402B/commit without X-PAYMENT still defaults to JSON when no paywall is configured", async () => {
    const app = express();
    app.use(express.json());
    app.use(mountX402b(emptyServer, { resolveRequirements: () => REQUIREMENTS }));

    const res = await supertest(app).post("/x402B/commit").set("Accept", "text/html").send();

    expect(res.status).toBe(402);
    expect(res.headers["content-type"]).toMatch(/application\/json/);
    expect(res.body.accepts[0].scheme).toBe("escrow");
  });
});

describe("integration: real evmEscrowPaywall from @bosonprotocol/x402-paywall", () => {
  // Smoke-test against the actual workspace paywall so a structural
  // drift between this adapter's `PaywallProviderLike` and the
  // upstream `PaywallProvider` is caught at CI time. Imports are deferred
  // to inside the test so this file still type-checks if the paywall
  // hasn't been built yet (workspace ordering safety net).
  it(
    "expressMiddleware accepts evmEscrowPaywall and produces a full HTML 402 body",
    // The dynamic import resolves a ~4.7 MB CJS bundle (the inlined
    // React app template). Default 5 s vitest timeout is tight when
    // turbo runs multiple test workers in parallel; bump generously.
    { timeout: 30_000 },
    async () => {
      const { evmEscrowPaywall } = await import("@bosonprotocol/x402-paywall");

      const app = express();
      app.get(
        "/datafeed",
        expressMiddleware(emptyServer, {
          resolveRequirements: () => REQUIREMENTS,
          paywall: evmEscrowPaywall,
          paywallConfig: { appName: "Integration Demo" },
        }),
        (_req, res) => res.json({ kpi: 42 }),
      );

      const res = await supertest(app).get("/datafeed").set("Accept", "text/html");

      expect(res.status).toBe(402);
      expect(res.headers["content-type"]).toMatch(/text\/html/);
      expect(res.text).toContain("<!DOCTYPE html>");
      expect(res.text).toContain("window.x402b");
      // The PaywallConfig field should round-trip into the injected state.
      expect(res.text).toContain("Integration Demo");
    },
  );
});
