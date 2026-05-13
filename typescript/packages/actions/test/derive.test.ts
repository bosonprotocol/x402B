// Table-driven tests for `deriveNextActions` / `deriveInitialNextActions`.
//
// Coverage matrix follows docs/boson-impl-04-state-machine-and-next-actions.md
// — every (ExchangeState, DisputeState?) tuple the spec lists, plus the
// synthetic PRE_COMMIT.

import { DisputeState, ExchangeState } from "@bosonprotocol/x402-core/state-machine";
import { describe, expect, it } from "vitest";

import { deriveInitialNextActions, deriveNextActions } from "../src/index.js";
import { REGISTRY } from "./fixtures/registry.js";

describe("deriveInitialNextActions (PRE_COMMIT)", () => {
  it("emits the two commit-time actions in spec order", () => {
    const envelope = deriveInitialNextActions(REGISTRY);
    expect(envelope.next.map((entry) => entry.id)).toEqual([
      "boson-createOfferAndCommit",
      "boson-createOfferCommitAndRedeem",
    ]);
  });

  it("each entry keeps only usable channels in registry order", () => {
    const envelope = deriveInitialNextActions(REGISTRY);
    for (const entry of envelope.next) {
      expect(entry.channels).toEqual(["facilitator", "onchain", "mcp", "xmtp"]);
    }
  });

  it("does not stamp endpoints when the registry has none for the action", () => {
    const envelope = deriveInitialNextActions(REGISTRY);
    for (const entry of envelope.next) {
      expect(entry.endpoints).toBeUndefined();
      expect(entry.channels).not.toContain("server");
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

  it("always emits the on-chain fallback block", () => {
    const envelope = deriveInitialNextActions(REGISTRY);
    expect(envelope.fallback?.onchainHints).toEqual(REGISTRY.fallback.onchainHints);
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
    expect(redeem?.channels).toEqual(["server", "facilitator", "onchain", "mcp", "xmtp"]);
  });

  it("omits channels whose required hints are absent", () => {
    const envelope = deriveNextActions(
      { exchangeId: "12345", exchangeState: ExchangeState.REDEEMED },
      {
        channels: ["server", "facilitator", "onchain", "mcp", "xmtp"],
        fallback: {
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
              "boson-createOfferAndCommit": "ExchangeCommitFacet",
              "boson-createOfferCommitAndRedeem": "OrchestrationHandlerFacet2",
              "boson-redeem": "ExchangeHandlerFacet",
              "boson-cancelVoucher": "ExchangeHandlerFacet",
              "boson-revokeVoucher": "ExchangeHandlerFacet",
              "boson-completeExchange": "ExchangeHandlerFacet",
              "boson-raiseDispute": "DisputeHandlerFacet",
              "boson-resolveDispute": "DisputeHandlerFacet",
              "boson-escalateDispute": "DisputeHandlerFacet",
              "boson-retractDispute": "DisputeHandlerFacet",
            },
          },
        },
      },
    );

    expect(envelope.next).toEqual([
      {
        id: "boson-completeExchange",
        channels: ["facilitator", "onchain"],
      },
      {
        id: "boson-raiseDispute",
        channels: ["facilitator", "onchain"],
      },
    ]);
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

describe("deriveNextActions — unusable actions", () => {
  it("throws when no configured channel can be used for a legal action", () => {
    expect(() =>
      deriveNextActions(
        { exchangeId: "12345", exchangeState: ExchangeState.REDEEMED },
        {
          channels: ["server", "mcp", "xmtp"],
          fallback: {
            onchainHints: REGISTRY.fallback.onchainHints,
          },
        },
      ),
    ).toThrow("No usable channel configured for action boson-completeExchange");
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
