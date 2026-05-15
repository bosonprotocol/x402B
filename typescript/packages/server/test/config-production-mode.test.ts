// Coverage for `mode: "production"` boot-time fail-fast. Each prod-only
// prerequisite is asserted in turn — omitting it must produce a
// synchronous `ZodError` at `createX402bServer` time, not a runtime
// throw on the first handler call.

import { describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { ZodError } from "zod";

import { createX402bServer, type ExchangeReader, type X402bServerConfig } from "../src/index.js";

const NETWORK = "eip155:8453" as const;
const CHAIN_ID = 8453;
const ESCROW = "0xdddddddddddddddddddddddddddddddddddddddd" as const;
const TEST_SELLER_PK = `0x${"22".repeat(32)}` as const;

const dummyReader: ExchangeReader = { read: async () => null };

function baseProdConfig(): X402bServerConfig {
  return {
    network: NETWORK,
    chainId: CHAIN_ID,
    escrow: ESCROW,
    signer: privateKeyToAccount(TEST_SELLER_PK),
    facilitator: { url: "https://facilitator.example" },
    channelRegistry: { channels: ["server", "facilitator", "onchain"], escrow: ESCROW },
    mode: "production",
    exchangeReader: dummyReader,
    subgraphUrl: "https://subgraph.example",
    exchangeFulfillmentOptionStore: new Map(),
    fulfillmentRecoveryStore: new Map(),
  };
}

function assertZodErrorOnPath(thrown: unknown, path: string): void {
  expect(thrown).toBeInstanceOf(ZodError);
  const issues = (thrown as ZodError).issues;
  const match = issues.find((i) => i.path.join(".") === path);
  expect(
    match,
    `expected a ZodError issue on path '${path}', got ${JSON.stringify(issues)}`,
  ).toBeDefined();
}

describe("mode: 'production' fail-fast", () => {
  it("accepts a complete production config", () => {
    expect(() => createX402bServer(baseProdConfig())).not.toThrow();
  });

  it("throws ZodError when exchangeReader is missing", () => {
    const cfg = baseProdConfig();
    delete cfg.exchangeReader;
    try {
      createX402bServer(cfg);
      expect.fail("expected createX402bServer to throw");
    } catch (e) {
      assertZodErrorOnPath(e, "exchangeReader");
    }
  });

  it("throws ZodError when neither coreSdkRead nor subgraphUrl is set", () => {
    const cfg = baseProdConfig();
    delete cfg.subgraphUrl;
    try {
      createX402bServer(cfg);
      expect.fail("expected createX402bServer to throw");
    } catch (e) {
      assertZodErrorOnPath(e, "subgraphUrl");
    }
  });

  it("accepts coreSdkRead instead of subgraphUrl", () => {
    const cfg = baseProdConfig();
    delete cfg.subgraphUrl;
    cfg.coreSdkRead = {
      getFunds: async () => [],
      getSellersByAddress: async () => [],
      getBuyers: async () => [],
    } as never;
    expect(() => createX402bServer(cfg)).not.toThrow();
  });

  it("throws ZodError when exchangeFulfillmentOptionStore is missing", () => {
    const cfg = baseProdConfig();
    delete cfg.exchangeFulfillmentOptionStore;
    try {
      createX402bServer(cfg);
      expect.fail("expected createX402bServer to throw");
    } catch (e) {
      assertZodErrorOnPath(e, "exchangeFulfillmentOptionStore");
    }
  });

  it("throws ZodError when fulfillmentRecoveryStore is missing", () => {
    const cfg = baseProdConfig();
    delete cfg.fulfillmentRecoveryStore;
    try {
      createX402bServer(cfg);
      expect.fail("expected createX402bServer to throw");
    } catch (e) {
      assertZodErrorOnPath(e, "fulfillmentRecoveryStore");
    }
  });

  it("aggregates multiple missing fields into one ZodError", () => {
    const cfg = baseProdConfig();
    delete cfg.exchangeReader;
    delete cfg.exchangeFulfillmentOptionStore;
    try {
      createX402bServer(cfg);
      expect.fail("expected createX402bServer to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(ZodError);
      const paths = (e as ZodError).issues.map((i) => i.path.join("."));
      expect(paths).toContain("exchangeReader");
      expect(paths).toContain("exchangeFulfillmentOptionStore");
    }
  });
});

describe("mode: 'development' (default)", () => {
  it("accepts a bare-minimum config (no reader / no stores / no subgraph)", () => {
    expect(() =>
      createX402bServer({
        network: NETWORK,
        chainId: CHAIN_ID,
        escrow: ESCROW,
        signer: privateKeyToAccount(TEST_SELLER_PK),
        facilitator: { url: "https://facilitator.example" },
        channelRegistry: { channels: ["server", "facilitator", "onchain"], escrow: ESCROW },
      }),
    ).not.toThrow();
  });

  it("rejects an unknown mode value", () => {
    expect(() =>
      createX402bServer({
        network: NETWORK,
        chainId: CHAIN_ID,
        escrow: ESCROW,
        signer: privateKeyToAccount(TEST_SELLER_PK),
        facilitator: { url: "https://facilitator.example" },
        channelRegistry: { channels: ["server", "facilitator", "onchain"], escrow: ESCROW },
        mode: "staging" as unknown as "development",
      }),
    ).toThrow(ZodError);
  });
});
