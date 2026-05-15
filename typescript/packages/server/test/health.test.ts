// Coverage for `server.healthCheck()`: each combination of
// facilitator status × subgraph status yields the expected per-
// dependency health state.

import { describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";

import { createX402bServer, type CoreSdkReadAdapter, type FetchLike } from "../src/index.js";

const NETWORK = "eip155:8453" as const;
const CHAIN_ID = 8453;
const ESCROW = "0xdddddddddddddddddddddddddddddddddddddddd" as const;
const TEST_SELLER_PK = `0x${"22".repeat(32)}` as const;
const FACILITATOR_URL = "https://facilitator.example";

function healthyFacilitatorFetch(): FetchLike {
  return async (url) => {
    if (url.endsWith("/healthz")) {
      return { ok: true, status: 200, text: async () => "" };
    }
    throw new Error(`unexpected URL ${url}`);
  };
}

function downFacilitatorFetch(): FetchLike {
  return async () => {
    throw new Error("ECONNREFUSED");
  };
}

function healthySubgraph(): CoreSdkReadAdapter {
  return {
    getFunds: async () => [],
    getSellersByAddress: async () => [],
    getBuyers: async () => [],
  };
}

function downSubgraph(): CoreSdkReadAdapter {
  return {
    getFunds: async () => {
      throw new Error("subgraph 502");
    },
    getSellersByAddress: async () => {
      throw new Error("subgraph 502");
    },
    getBuyers: async () => {
      throw new Error("subgraph 502");
    },
  };
}

function buildServer(opts: { fetch: FetchLike; coreSdkRead?: CoreSdkReadAdapter }) {
  // Override the global fetch for the duration of the test so the
  // facilitator client picks up our stub at construction time.
  const originalFetch = globalThis.fetch;
  globalThis.fetch = opts.fetch as unknown as typeof globalThis.fetch;
  try {
    return createX402bServer({
      network: NETWORK,
      chainId: CHAIN_ID,
      escrow: ESCROW,
      signer: privateKeyToAccount(TEST_SELLER_PK),
      facilitator: { url: FACILITATOR_URL },
      channelRegistry: { channels: ["server", "facilitator", "onchain"], escrow: ESCROW },
      ...(opts.coreSdkRead !== undefined ? { coreSdkRead: opts.coreSdkRead } : {}),
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
}

describe("server.healthCheck()", () => {
  it("reports facilitator + subgraph ok when both probes succeed", async () => {
    const server = buildServer({
      fetch: healthyFacilitatorFetch(),
      coreSdkRead: healthySubgraph(),
    });
    expect(await server.healthCheck()).toEqual({ facilitator: "ok", subgraph: "ok" });
  });

  it("reports facilitator down when the /healthz probe throws", async () => {
    const server = buildServer({
      fetch: downFacilitatorFetch(),
      coreSdkRead: healthySubgraph(),
    });
    expect(await server.healthCheck()).toEqual({ facilitator: "down", subgraph: "ok" });
  });

  it("reports subgraph down when the read probe throws", async () => {
    const server = buildServer({
      fetch: healthyFacilitatorFetch(),
      coreSdkRead: downSubgraph(),
    });
    expect(await server.healthCheck()).toEqual({ facilitator: "ok", subgraph: "down" });
  });

  it("reports subgraph n/a when no coreSdkRead is configured", async () => {
    const server = buildServer({
      fetch: healthyFacilitatorFetch(),
    });
    expect(await server.healthCheck()).toEqual({ facilitator: "ok", subgraph: "n/a" });
  });

  it("reports both down when both probes throw", async () => {
    const server = buildServer({
      fetch: downFacilitatorFetch(),
      coreSdkRead: downSubgraph(),
    });
    expect(await server.healthCheck()).toEqual({ facilitator: "down", subgraph: "down" });
  });

  it("returns non-2xx as down on the facilitator probe", async () => {
    const fetchStub: FetchLike = async () => ({
      ok: false,
      status: 503,
      text: async () => "Service Unavailable",
    });
    const server = buildServer({
      fetch: fetchStub,
      coreSdkRead: healthySubgraph(),
    });
    expect(await server.healthCheck()).toEqual({ facilitator: "down", subgraph: "ok" });
  });
});
