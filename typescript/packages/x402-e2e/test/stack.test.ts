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

// `expect2xx: true` — true /health routes must answer 2xx.
// `expect2xx: false` — POST-only / JSON-RPC / IPFS endpoints answer GET
// with a 4xx when the container is up; non-5xx is good enough.
const HEALTH_TARGETS: readonly { name: string; url: string; expect2xx: boolean }[] = [
  { name: "boson-protocol-node", url: `${LOCAL_31337_0.urls.jsonRpc}`, expect2xx: false },
  { name: "boson-subgraph", url: "http://localhost:8030", expect2xx: false },
  { name: "boson-mcp-server", url: LOCAL_31337_0.urls.bosonMcp, expect2xx: false },
  { name: "meta-tx-gateway", url: LOCAL_31337_0.urls.metaTxGateway, expect2xx: false },
  { name: "ipfs", url: "http://localhost:5001/api/v0/version", expect2xx: false },
  { name: "x402b-facilitator-http", url: "http://localhost:8889/health", expect2xx: true },
  { name: "x402b-resource-server", url: "http://localhost:4001/health", expect2xx: true },
  { name: "x402b-webhook-sink", url: "http://localhost:4002/health", expect2xx: true },
];

interface PingResult {
  ok: boolean;
  status: number;
  error?: string;
}

async function ping(url: string, expect2xx: boolean): Promise<PingResult> {
  try {
    const res = await fetch(url, { method: "GET" });
    const ok = expect2xx ? res.status >= 200 && res.status < 300 : res.status < 500;
    return { ok, status: res.status };
  } catch (err) {
    return { ok: false, status: 0, error: err instanceof Error ? err.message : String(err) };
  }
}

function envInt(name: string, fallback: number, min: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return n < min ? min : n;
}

const PING_MAX_ATTEMPTS = envInt("E2E_PING_MAX_ATTEMPTS", 10, 1);
const PING_RETRY_DELAY_MS = envInt("E2E_PING_RETRY_DELAY_MS", 1000, 100);

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function describePing(r: PingResult): string {
  return r.error ? `error=${r.error}` : `status=${r.status}`;
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
      let last: PingResult = { ok: false, status: 0, error: "no attempt made" };
      for (let attempt = 1; attempt <= PING_MAX_ATTEMPTS; attempt++) {
        last = await ping(target.url, target.expect2xx);
        if (last.ok) break;
        if (attempt < PING_MAX_ATTEMPTS) await sleep(PING_RETRY_DELAY_MS);
      }
      expect(
        last.ok,
        `expected ${target.url} to be reachable after ${PING_MAX_ATTEMPTS} attempts; last ${describePing(last)}`,
      ).toBe(true);
    });
  }
});

describe.skipIf(ENABLED)("x402-e2e stack smoke (skipped — set E2E_DOCKER=1 to run)", () => {
  it("placeholder", () => {
    expect(true).toBe(true);
  });
});
