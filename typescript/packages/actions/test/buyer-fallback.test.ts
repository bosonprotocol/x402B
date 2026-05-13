import { ACTION_IDS } from "@bosonprotocol/x402-core/state-machine";
import { describe, expect, it } from "vitest";

import {
  BUYER_ONCHAIN_FALLBACK,
  hasBuyerOnchainFallback,
  isBuyerOnchainResilient,
  type ActionEntry,
} from "../src/index.js";

describe("BUYER_ONCHAIN_FALLBACK", () => {
  it("has an entry for every action id", () => {
    for (const id of ACTION_IDS) {
      expect(BUYER_ONCHAIN_FALLBACK[id]).toBeTypeOf("boolean");
    }
  });

  it("matches the spec table — buyer-resilient actions", () => {
    // From docs/boson-impl-04-state-machine-and-next-actions.md
    // §"Censorship resistance — guarantees".
    expect(BUYER_ONCHAIN_FALLBACK["boson-redeem"]).toBe(true);
    expect(BUYER_ONCHAIN_FALLBACK["boson-completeExchange"]).toBe(true);
    expect(BUYER_ONCHAIN_FALLBACK["boson-raiseDispute"]).toBe(true);
    expect(BUYER_ONCHAIN_FALLBACK["boson-escalateDispute"]).toBe(true);
    expect(BUYER_ONCHAIN_FALLBACK["boson-retractDispute"]).toBe(true);
    expect(BUYER_ONCHAIN_FALLBACK["boson-cancelVoucher"]).toBe(true);
    expect(BUYER_ONCHAIN_FALLBACK["boson-createOfferAndCommit"]).toBe(true);
    expect(BUYER_ONCHAIN_FALLBACK["boson-createOfferCommitAndRedeem"]).toBe(true);
  });

  it("excludes mutual / seller-only actions", () => {
    expect(BUYER_ONCHAIN_FALLBACK["boson-resolveDispute"]).toBe(false);
    expect(BUYER_ONCHAIN_FALLBACK["boson-revokeVoucher"]).toBe(false);
  });
});

describe("hasBuyerOnchainFallback", () => {
  it("returns true when the action is resilient AND the envelope advertises onchain", () => {
    const entry: ActionEntry = {
      id: "boson-redeem",
      channels: ["server", "facilitator", "onchain"],
    };
    expect(hasBuyerOnchainFallback(entry)).toBe(true);
  });

  it("returns false when the envelope omits onchain", () => {
    const entry: ActionEntry = {
      id: "boson-redeem",
      channels: ["server", "facilitator"],
    };
    expect(hasBuyerOnchainFallback(entry)).toBe(false);
  });

  it("returns false when the action is not buyer-resilient", () => {
    const entry: ActionEntry = {
      id: "boson-resolveDispute",
      channels: ["server", "onchain"],
    };
    expect(hasBuyerOnchainFallback(entry)).toBe(false);
  });
});

describe("isBuyerOnchainResilient", () => {
  it("returns true for buyer-resilient action ids", () => {
    expect(isBuyerOnchainResilient("boson-redeem")).toBe(true);
  });

  it("returns false for non-resilient action ids", () => {
    expect(isBuyerOnchainResilient("boson-resolveDispute")).toBe(false);
  });

  it("returns false for unknown ids", () => {
    expect(isBuyerOnchainResilient("boson-unknown")).toBe(false);
    expect(isBuyerOnchainResilient("not-a-boson-id")).toBe(false);
  });

  it("returns false for `Object.prototype` keys (no prototype-chain leak)", () => {
    // Regression: a naive `in` check would short-circuit to truthy on
    // these (since they're inherited) and return `undefined` from the
    // lookup, which is neither `true` nor `false`.
    expect(isBuyerOnchainResilient("toString")).toBe(false);
    expect(isBuyerOnchainResilient("constructor")).toBe(false);
    expect(isBuyerOnchainResilient("hasOwnProperty")).toBe(false);
  });
});
