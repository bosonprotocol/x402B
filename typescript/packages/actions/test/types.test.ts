import { describe, expect, expectTypeOf, it } from "vitest";

import {
  CHANNEL_IDS,
  DisputeState,
  ExchangeState,
  type ActionEntry,
  type Channel,
  type ChannelAdapter,
  type ChannelRegistry,
  type NextActionsEnvelope,
} from "../src/index.js";
import { REGISTRY } from "./fixtures/registry.js";

describe("@bosonprotocol/x402-actions public types", () => {
  it("CHANNEL_IDS includes the five standard channels in stable order", () => {
    expectTypeOf(CHANNEL_IDS).toMatchTypeOf<readonly Channel[]>();
    // Spec order — see docs/boson-impl-04 §"Channels".
    expectTypeOf<(typeof CHANNEL_IDS)[number]>().toEqualTypeOf<
      "server" | "facilitator" | "onchain" | "mcp" | "xmtp"
    >();
  });

  it("ActionEntry extends NextAction with an optional ISO `deadline`", () => {
    const entry: ActionEntry = {
      id: "boson-resolveDispute",
      channels: ["server", "facilitator", "onchain", "mcp"],
      endpoints: { server: "https://seller.example/x402B/dispute/resolve" },
      deadline: "2026-05-15T00:00:00Z",
    };
    expectTypeOf(entry.deadline).toEqualTypeOf<string | undefined>();
  });

  it("NextActionsEnvelope has a pre-commit shape (no exchangeId/state)", () => {
    const preCommit: NextActionsEnvelope = {
      next: [
        {
          id: "boson-createOfferAndCommit",
          channels: ["server", "facilitator", "onchain", "mcp"],
          endpoints: { server: "https://seller.example/x402B/commit" },
        },
      ],
    };
    expectTypeOf(preCommit).toMatchTypeOf<NextActionsEnvelope>();
  });

  it("re-exports state enums as runtime values", () => {
    expect(ExchangeState.DISPUTED).toBe("DISPUTED");
    expect(DisputeState.RESOLVING).toBe("RESOLVING");
  });

  it("NextActionsEnvelope has a post-commit shape with exchangeId+exchangeState", () => {
    const postCommit: NextActionsEnvelope = {
      exchangeId: "12345",
      exchangeState: ExchangeState.REDEEMED,
      next: [
        {
          id: "boson-completeExchange",
          channels: ["server", "facilitator", "onchain"],
        },
      ],
    };
    expectTypeOf(postCommit).toMatchTypeOf<NextActionsEnvelope>();
  });

  it("NextActionsEnvelope's DISPUTED variant requires disputeState", () => {
    const disputed: NextActionsEnvelope = {
      exchangeId: "12345",
      exchangeState: ExchangeState.DISPUTED,
      disputeState: DisputeState.RESOLVING,
      next: [
        {
          id: "boson-resolveDispute",
          channels: ["server", "onchain"],
        },
      ],
    };
    expectTypeOf(disputed).toMatchTypeOf<NextActionsEnvelope>();
  });

  it("ChannelAdapter is generic over its config type", () => {
    type ServerCfg = { baseUrl: string };
    type Adapter = ChannelAdapter<ServerCfg>;
    expectTypeOf<Adapter["channel"]>().toEqualTypeOf<Channel>();
    expectTypeOf<Parameters<Adapter["describe"]>[1]>().toEqualTypeOf<ServerCfg>();
  });

  it("ChannelRegistry types channel order, endpoints, and discrete fallback fields", () => {
    expectTypeOf(REGISTRY).toMatchTypeOf<ChannelRegistry>();
    expectTypeOf(REGISTRY.channels).toMatchTypeOf<readonly Channel[]>();
  });
});
