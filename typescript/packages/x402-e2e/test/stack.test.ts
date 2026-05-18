// Stack-boot smoke test. Gated behind `E2E_DOCKER=1` so the default
// `pnpm test` (which Turbo runs across the whole repo) doesn't spin up
// containers — keeps repo-wide CI fast. Run locally with:
//
//   E2E_DOCKER=1 pnpm --filter @bosonprotocol/x402-e2e test
//
// The test boots the full canonical Boson stack + the three x402B
// services, waits for the deploy.done markers
// (`boson-protocol-node:/app/deploy.done`,
//  `boson-subgraph:/home/deploy.done`), hits every service's
// HTTP-level health probe, then tears the stack down.

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { LOCAL_31337_0 } from "../src/config/local-31337-0.js";
import { startStack, stopStack } from "../src/stack/index.js";

const ENABLED = process.env.E2E_DOCKER === "1";

const HEALTH_TARGETS: readonly { name: string; url: string }[] = [
  { name: "boson-protocol-node", url: `${LOCAL_31337_0.urls.jsonRpc}` },
  { name: "boson-subgraph", url: "http://localhost:8030" },
  { name: "boson-mcp-server", url: LOCAL_31337_0.urls.bosonMcp },
  { name: "meta-tx-gateway", url: LOCAL_31337_0.urls.metaTxGateway },
  { name: "x402b-facilitator-http", url: "http://localhost:8889/health" },
  { name: "x402b-resource-server", url: "http://localhost:4001/health" },
  { name: "x402b-webhook-sink", url: "http://localhost:4002/health" },
];

async function ping(url: string): Promise<{ ok: boolean; status: number }> {
  // POST-only services (the RPC node + the gateway) answer GET with a
  // 4xx — that's good enough for "the container is up and listening".
  // Anything other than ECONNREFUSED counts as healthy.
  try {
    const res = await fetch(url, { method: "GET" });
    return { ok: true, status: res.status };
  } catch {
    return { ok: false, status: 0 };
  }
}

describe.skipIf(!ENABLED)("x402-e2e stack smoke", () => {
  beforeAll(async () => {
    await startStack({ waitForReady: true });
  });

  afterAll(async () => {
    await stopStack();
  });

  for (const target of HEALTH_TARGETS) {
    it(`${target.name} is reachable`, async () => {
      const result = await ping(target.url);
      expect(result.ok, `expected ${target.url} to be reachable; got ECONNREFUSED`).toBe(true);
    });
  }
});

describe.skipIf(ENABLED)("x402-e2e stack smoke (skipped — set E2E_DOCKER=1 to run)", () => {
  it("placeholder", () => {
    expect(true).toBe(true);
  });
});
