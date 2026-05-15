// Operator-API coverage: `server.recovery.list()` enumerates pending
// deferred-fulfillment entries, and `server.recovery.replay(exchangeId)`
// re-runs the channel's `onCommit(...)` (deleting on success, retaining
// with an updated `error` on failure).

import { describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";

import {
  createX402bServer,
  mapAsStore,
  type FulfillmentRecoveryEntry,
  type RedeemFulfillmentChannel,
  type X402bServer,
} from "../src/index.js";

const NETWORK = "eip155:8453" as const;
const CHAIN_ID = 8453;
const ESCROW = "0xdddddddddddddddddddddddddddddddddddddddd" as const;
const TEST_SELLER_PK = `0x${"22".repeat(32)}` as const;
const BUYER = "0x2222222222222222222222222222222222222222" as const;

function seedEntry(option: string, exchangeId: string): FulfillmentRecoveryEntry {
  return {
    exchangeId,
    option,
    data: { addr: `target-${exchangeId}` },
    redeemer: BUYER,
    recordedAt: Date.now(),
    error: "(stale) channel.onCommit failed",
  };
}

interface SpyChannel extends RedeemFulfillmentChannel {
  calls: Array<{ exchangeId: string; data: Record<string, unknown> | null }>;
  failNextOnCommit: boolean;
}

function spyChannel(id: string): SpyChannel {
  const calls: SpyChannel["calls"] = [];
  return {
    id,
    calls,
    failNextOnCommit: false,
    validate: () => ({ ok: true }),
    async onCommit(exchangeId, data) {
      calls.push({ exchangeId, data });
      if (this.failNextOnCommit) {
        this.failNextOnCommit = false;
        throw new Error("channel write timed out");
      }
    },
  };
}

function buildServerWithStore(opts: { channels?: readonly RedeemFulfillmentChannel[] }): {
  server: X402bServer;
  store: Map<string, FulfillmentRecoveryEntry>;
} {
  // `store` is the underlying Map the test reads/writes against
  // directly for assertions; the server sees its async `Store<V>`
  // adapter so handlers can `await` on the per-exchange writes.
  const store = new Map<string, FulfillmentRecoveryEntry>();
  const server = createX402bServer({
    network: NETWORK,
    chainId: CHAIN_ID,
    escrow: ESCROW,
    signer: privateKeyToAccount(TEST_SELLER_PK),
    facilitator: { url: "https://facilitator.example" },
    channelRegistry: { channels: ["server", "facilitator", "onchain"], escrow: ESCROW },
    fulfillmentRecoveryStore: mapAsStore(store),
    ...(opts.channels !== undefined ? { fulfillmentChannels: opts.channels } : {}),
  });
  return { server, store };
}

describe("server.recovery.list()", () => {
  it("returns all entries in the store", async () => {
    const { server, store } = buildServerWithStore({});
    store.set("1", seedEntry("email", "1"));
    store.set("2", seedEntry("xmtp", "2"));
    store.set("3", seedEntry("email", "3"));

    const list = await server.recovery.list();
    expect(list).toHaveLength(3);
    expect(list.map((e) => e.exchangeId).sort()).toEqual(["1", "2", "3"]);
  });

  it("returns an empty list when the store is empty", async () => {
    const { server } = buildServerWithStore({});
    expect(await server.recovery.list()).toEqual([]);
  });
});

describe("server.recovery.replay()", () => {
  it("clears the entry on successful channel onCommit", async () => {
    const channel = spyChannel("email");
    const { server, store } = buildServerWithStore({ channels: [channel] });
    store.set("1", seedEntry("email", "1"));

    const result = await server.recovery.replay("1");
    expect(result).toEqual({ ok: true });
    expect(store.has("1")).toBe(false);
    expect(channel.calls).toEqual([{ exchangeId: "1", data: { addr: "target-1" } }]);
  });

  it("returns ok:false when the entry is missing", async () => {
    const { server } = buildServerWithStore({ channels: [spyChannel("email")] });
    const result = await server.recovery.replay("missing");
    expect(result).toEqual({
      ok: false,
      reason: "no pending recovery entry for exchangeId 'missing'",
    });
  });

  it("returns ok:false when no channel is registered for the entry's option", async () => {
    const { server, store } = buildServerWithStore({ channels: [spyChannel("email")] });
    store.set("1", seedEntry("xmtp", "1"));

    const result = await server.recovery.replay("1");
    expect(result).toEqual({
      ok: false,
      reason: "no channel adapter is registered for option 'xmtp'",
    });
    // Entry retained with the updated error.
    expect(store.get("1")?.error).toBe("no channel adapter is registered for option 'xmtp'");
  });

  it("leaves the entry in place with an updated error when the channel throws", async () => {
    const channel = spyChannel("email");
    channel.failNextOnCommit = true;
    const { server, store } = buildServerWithStore({ channels: [channel] });
    store.set("1", seedEntry("email", "1"));

    const result = await server.recovery.replay("1");
    expect(result).toEqual({ ok: false, reason: "channel write timed out" });
    expect(store.has("1")).toBe(true);
    expect(store.get("1")?.error).toBe("channel write timed out");
    // The successful path on a second invocation clears the entry.
    const result2 = await server.recovery.replay("1");
    expect(result2).toEqual({ ok: true });
    expect(store.has("1")).toBe(false);
  });

  it("replaying one exchange leaves the others untouched", async () => {
    const channel = spyChannel("email");
    const { server, store } = buildServerWithStore({ channels: [channel] });
    store.set("1", seedEntry("email", "1"));
    store.set("2", seedEntry("email", "2"));
    store.set("3", seedEntry("email", "3"));

    const result = await server.recovery.replay("2");
    expect(result).toEqual({ ok: true });
    expect([...store.keys()].sort()).toEqual(["1", "3"]);
  });
});
