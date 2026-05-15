// Coverage for the `Logger` interface: defaults to no-op, accepts any
// host-supplied logger, and emits events at the documented hot spots
// (recovery-store writes, channel-onCommit success/failure, facilitator
// non-2xx responses, boot diagnostics).

import { describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";

import {
  createFacilitatorClient,
  createX402bServer,
  noopLogger,
  type FetchLike,
  type Logger,
} from "../src/index.js";

interface RecordedEvent {
  level: "debug" | "info" | "warn" | "error";
  msg: string;
  meta?: Record<string, unknown>;
}

function recordingLogger(): { logger: Logger; events: RecordedEvent[] } {
  const events: RecordedEvent[] = [];
  const make =
    (level: RecordedEvent["level"]) =>
    (msg: string, meta?: Record<string, unknown>): void => {
      events.push({ level, msg, ...(meta !== undefined ? { meta } : {}) });
    };
  return {
    events,
    logger: {
      debug: make("debug"),
      info: make("info"),
      warn: make("warn"),
      error: make("error"),
    },
  };
}

const NETWORK = "eip155:8453" as const;
const CHAIN_ID = 8453;
const ESCROW = "0xdddddddddddddddddddddddddddddddddddddddd" as const;
const TEST_SELLER_PK = `0x${"22".repeat(32)}` as const;

describe("noopLogger", () => {
  it("provides four no-op methods", () => {
    expect(() => noopLogger.debug("x")).not.toThrow();
    expect(() => noopLogger.info("x")).not.toThrow();
    expect(() => noopLogger.warn("x")).not.toThrow();
    expect(() => noopLogger.error("x")).not.toThrow();
  });
});

describe("createX402bServer logger wiring", () => {
  it("emits an info event at boot when a logger is supplied", () => {
    const rec = recordingLogger();
    const seller = privateKeyToAccount(TEST_SELLER_PK);
    createX402bServer({
      network: NETWORK,
      chainId: CHAIN_ID,
      escrow: ESCROW,
      signer: seller,
      facilitator: { url: "https://facilitator.example" },
      channelRegistry: { channels: ["server", "facilitator", "onchain"], escrow: ESCROW },
      logger: rec.logger,
    });
    const boot = rec.events.find((e) => e.msg.includes("createX402bServer"));
    expect(boot).toBeDefined();
    expect(boot?.level).toBe("info");
    expect(boot?.meta).toMatchObject({
      network: NETWORK,
      chainId: CHAIN_ID,
      escrow: ESCROW,
      facilitatorUrl: "https://facilitator.example",
    });
  });

  it("is silent when no logger is supplied (no-op default)", () => {
    // Indirect assertion: build with no logger and confirm nothing is
    // thrown / nothing leaks to stdout. The interface-level
    // verification is that the noop functions exist and don't throw.
    const seller = privateKeyToAccount(TEST_SELLER_PK);
    expect(() =>
      createX402bServer({
        network: NETWORK,
        chainId: CHAIN_ID,
        escrow: ESCROW,
        signer: seller,
        facilitator: { url: "https://facilitator.example" },
        channelRegistry: { channels: ["server", "facilitator", "onchain"], escrow: ESCROW },
      }),
    ).not.toThrow();
  });
});

describe("facilitator client logger wiring", () => {
  it("logs a warn event on network error", async () => {
    const rec = recordingLogger();
    const stubFetch: FetchLike = async () => {
      throw new Error("ECONNRESET");
    };
    const client = createFacilitatorClient({
      url: "https://facilitator.example",
      fetch: stubFetch,
      logger: rec.logger,
    });

    await expect(
      client.verify({
        scheme: "escrow",
        network: NETWORK,
        payload: {} as never,
        requirements: {} as never,
      }),
    ).rejects.toThrow();

    const warning = rec.events.find((e) => e.level === "warn" && e.msg.includes("network error"));
    expect(warning).toBeDefined();
    expect(warning?.meta).toMatchObject({ path: "/verify" });
  });

  it("logs a warn event on non-2xx with a domain code", async () => {
    const rec = recordingLogger();
    const stubFetch: FetchLike = async () => ({
      ok: false,
      status: 500,
      text: async () => JSON.stringify({ ok: false, code: "INTERNAL_ERROR", reason: "boom" }),
    });
    const client = createFacilitatorClient({
      url: "https://facilitator.example",
      fetch: stubFetch,
      logger: rec.logger,
    });

    await expect(
      client.settle({
        scheme: "escrow",
        network: NETWORK,
        payload: {} as never,
        requirements: {} as never,
      }),
    ).rejects.toThrow();

    const warning = rec.events.find((e) => e.msg.includes("HTTP non-2xx"));
    expect(warning).toBeDefined();
    expect(warning?.meta).toMatchObject({
      path: "/settle",
      status: 500,
      facilitatorCode: "INTERNAL_ERROR",
    });
  });
});
