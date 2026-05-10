// Table-driven tests for `deriveNextActions` / `deriveInitialNextActions`.
//
// Coverage matrix follows docs/boson-impl-04-state-machine-and-next-actions.md
// — every (ExchangeState, DisputeState?) tuple the spec lists, plus the
// synthetic PRE_COMMIT.

import { DisputeState, ExchangeState } from "@bosonprotocol/x402-core/state-machine";
import { describe, expect, it } from "vitest";

import { deriveInitialNextActions, deriveNextActions, type ChannelRegistry } from "../src/index.js";

const REGISTRY: ChannelRegistry = {
  channels: ["server", "facilitator", "onchain", "mcp", "xmtp"],
  endpoints: {
    "boson-redeem": "https://seller.example/x402B/redeem",
    "boson-cancelVoucher": "https://seller.example/x402B/cancel",
  },
  fallback: {
    xmtp: "0xSellerXMTP",
    mcp: "boson://seller/12345",
    onchainHints: {
      escrow: "0x0000000000000000000000000000000000000001",
      metaTxFacet: "MetaTransactionsHandlerFacet",
      metaTxEntrypoints: {
        none: "executeMetaTransaction",
        erc3009: "executeMetaTransactionWithTokenTransferAuthorization",
        permit: "executeMetaTransactionWithTokenTransferAuthorization",
        permit2: "executeMetaTransactionWithTokenTransferAuthorization",
      },
      actionFacets: {
        "boson-redeem": "ExchangeHandlerFacet",
      },
    },
  },
};

describe("deriveInitialNextActions (PRE_COMMIT)", () => {
  it("emits the two commit-time actions in spec order", () => {
    const envelope = deriveInitialNextActions(REGISTRY);
    expect(envelope.next.map((entry) => entry.id)).toEqual([
      "boson-createOfferAndCommit",
      "boson-createOfferCommitAndRedeem",
    ]);
  });

  it("each entry inherits the registry's channel order verbatim", () => {
    const envelope = deriveInitialNextActions(REGISTRY);
    for (const entry of envelope.next) {
      expect(entry.channels).toEqual(REGISTRY.channels);
    }
  });

  it("does not stamp endpoints when the registry has none for the action", () => {
    const envelope = deriveInitialNextActions(REGISTRY);
    for (const entry of envelope.next) {
      expect(entry.endpoints).toBeUndefined();
    }
  });

  it("plumbs through optional deadlines", () => {
    const envelope = deriveInitialNextActions(REGISTRY, {
      deadlines: { "boson-createOfferAndCommit": "2026-05-15T00:00:00Z" },
    });
    expect(envelope.next.find((e) => e.id === "boson-createOfferAndCommit")?.deadline).toBe(
      "2026-05-15T00:00:00Z",
    );
    expect(
      envelope.next.find((e) => e.id === "boson-createOfferCommitAndRedeem")?.deadline,
    ).toBeUndefined();
  });

  it("emits the fallback block when populated", () => {
    const envelope = deriveInitialNextActions(REGISTRY);
    expect(envelope.fallback).toEqual(REGISTRY.fallback);
  });

  it("omits an empty fallback block", () => {
    const envelope = deriveInitialNextActions({
      channels: ["onchain"],
      fallback: {},
    });
    expect(envelope.fallback).toBeUndefined();
  });
});

describe("deriveNextActions — non-DISPUTED states", () => {
  it.each([
    [ExchangeState.COMMITTED, ["boson-redeem", "boson-cancelVoucher"]],
    [ExchangeState.REDEEMED, ["boson-completeExchange", "boson-raiseDispute"]],
    [ExchangeState.COMPLETED, []],
    [ExchangeState.CANCELLED, []],
    [ExchangeState.REVOKED, []],
  ] as const)("exchangeState=%s -> %j", (exchangeState, expectedIds) => {
    const envelope = deriveNextActions({ exchangeId: "12345", exchangeState }, REGISTRY);
    expect(envelope.exchangeId).toBe("12345");
    expect(envelope.exchangeState).toBe(exchangeState);
    expect("disputeState" in envelope ? envelope.disputeState : undefined).toBeUndefined();
    expect(envelope.next.map((entry) => entry.id)).toEqual(expectedIds);
  });

  it("stamps the per-action server endpoint when registry has one", () => {
    const envelope = deriveNextActions(
      { exchangeId: "12345", exchangeState: ExchangeState.COMMITTED },
      REGISTRY,
    );
    const redeem = envelope.next.find((e) => e.id === "boson-redeem");
    expect(redeem?.endpoints).toEqual({
      server: "https://seller.example/x402B/redeem",
    });
  });

  it("returns next: [] for terminal exchange states", () => {
    for (const exchangeState of [
      ExchangeState.COMPLETED,
      ExchangeState.CANCELLED,
      ExchangeState.REVOKED,
    ] as const) {
      const envelope = deriveNextActions({ exchangeId: "x", exchangeState }, REGISTRY);
      expect(envelope.next).toEqual([]);
    }
  });
});

describe("deriveNextActions — DISPUTED state by dispute sub-state", () => {
  it.each([
    [
      DisputeState.RESOLVING,
      ["boson-resolveDispute", "boson-escalateDispute", "boson-retractDispute"],
    ],
    [DisputeState.ESCALATED, []],
    [DisputeState.RESOLVED, []],
    [DisputeState.RETRACTED, []],
    [DisputeState.DECIDED, []],
    [DisputeState.REFUSED, []],
  ] as const)("dispute=%s -> %j", (disputeState, expectedIds) => {
    const envelope = deriveNextActions(
      {
        exchangeId: "42",
        exchangeState: ExchangeState.DISPUTED,
        disputeState,
      },
      REGISTRY,
    );
    expect(envelope.exchangeId).toBe("42");
    expect(envelope.exchangeState).toBe(ExchangeState.DISPUTED);
    if (envelope.exchangeState === ExchangeState.DISPUTED) {
      expect(envelope.disputeState).toBe(disputeState);
    }
    expect(envelope.next.map((entry) => entry.id)).toEqual(expectedIds);
  });
});

describe("deriveNextActions — output validates against the post-commit JSON Schema (zod)", () => {
  it("non-DISPUTED envelope round-trips through the parser", async () => {
    const { parseEscrowNextActions } = await import("@bosonprotocol/x402-core/schemes/escrow");
    const envelope = deriveNextActions(
      { exchangeId: "12345", exchangeState: ExchangeState.REDEEMED },
      REGISTRY,
      { deadlines: { "boson-completeExchange": "2026-05-20T12:00:00Z" } },
    );
    expect(() => parseEscrowNextActions(envelope)).not.toThrow();
  });

  it("DISPUTED envelope with disputeState round-trips", async () => {
    const { parseEscrowNextActions } = await import("@bosonprotocol/x402-core/schemes/escrow");
    const envelope = deriveNextActions(
      {
        exchangeId: "12345",
        exchangeState: ExchangeState.DISPUTED,
        disputeState: DisputeState.RESOLVING,
      },
      REGISTRY,
    );
    expect(() => parseEscrowNextActions(envelope)).not.toThrow();
  });
});
