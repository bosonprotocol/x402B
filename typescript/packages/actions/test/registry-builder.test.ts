import { describe, expect, it } from "vitest";

import { buildChannelRegistry, channelRegistryZodSchema } from "../src/index.js";

describe("buildChannelRegistry — happy path", () => {
  it("accepts the canonical full config", () => {
    const registry = buildChannelRegistry({
      channels: ["server", "facilitator", "onchain", "mcp"],
      endpoints: {
        "boson-redeem": "https://seller.example/x402B/redeem",
        "boson-completeExchange": "https://seller.example/x402B/complete",
      },
      xmtp: "0xdddddddddddddddddddddddddddddddddddddddd",
      mcp: "boson://seller/12345",
      escrow: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
    });
    expect(registry.channels).toEqual(["server", "facilitator", "onchain", "mcp"]);
    expect(registry.escrow).toBe("0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee");
  });

  it("accepts a minimal config", () => {
    const registry = buildChannelRegistry({
      channels: ["onchain"],
      escrow: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
    });
    expect(registry.channels).toEqual(["onchain"]);
    expect(registry.escrow).toBe("0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee");
  });
});

describe("buildChannelRegistry — rejection cases", () => {
  it("rejects an empty channels array", () => {
    expect(() =>
      buildChannelRegistry({
        channels: [],
        escrow: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      }),
    ).toThrow();
  });

  it("rejects a missing escrow address", () => {
    expect(() =>
      buildChannelRegistry({
        channels: ["onchain"],
      } as never),
    ).toThrow();
  });

  it("rejects duplicate channel ids", () => {
    expect(() =>
      buildChannelRegistry({
        channels: ["server", "server"],
        escrow: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      } as never),
    ).toThrow();
  });

  it("rejects an unknown channel id", () => {
    expect(() =>
      buildChannelRegistry({
        channels: ["server", "telegram"],
        escrow: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      } as never),
    ).toThrow();
  });

  it("rejects a non-https endpoint", () => {
    expect(() =>
      buildChannelRegistry({
        channels: ["server"],
        endpoints: { "boson-redeem": "ftp://seller.example/redeem" } as never,
        escrow: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      }),
    ).toThrow();
  });

  it("rejects an unknown action id key in endpoints", () => {
    expect(() =>
      buildChannelRegistry({
        channels: ["server"],
        endpoints: { "boson-doesnt-exist": "https://seller.example/x" } as never,
        escrow: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      }),
    ).toThrow();
  });

  it("rejects a malformed escrow address", () => {
    expect(() =>
      buildChannelRegistry({
        channels: ["onchain"],
        escrow: "not-an-address",
      }),
    ).toThrow();
  });

  it("rejects an unknown top-level field", () => {
    const result = channelRegistryZodSchema.safeParse({
      channels: ["onchain"],
      escrow: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      surprise: "extra",
    });
    expect(result.success).toBe(false);
  });

  it("safeParse returns a structured ZodError", () => {
    const result = channelRegistryZodSchema.safeParse({
      channels: [],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.length).toBeGreaterThan(0);
    }
  });
});
