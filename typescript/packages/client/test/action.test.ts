import { describe, expect, it } from "vitest";

import type { EscrowPaymentRequirements } from "@bosonprotocol/x402-core/schemes/escrow";

import { pickAction } from "../src/action.js";
import { NoCompatibleActionError, NotImplementedError } from "../src/errors.js";

function baseRequirements(): EscrowPaymentRequirements {
  return {
    scheme: "escrow",
    network: "eip155:8453",
    asset: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
    amount: "1000000",
    escrowAddress: "0xdddddddddddddddddddddddddddddddddddddddd",
    recipientId: "did:boson:seller:1",
    maxTimeoutSeconds: 300,
    offer: {
      fullOffer: { id: "0" },
      sellerSig: "0xdeadbeef",
      creator: "0x1111111111111111111111111111111111111111",
    },
    tokenAuthStrategies: ["erc3009"],
    actions: { next: [] },
  };
}

describe("pickAction", () => {
  it("returns boson-createOfferAndCommit when advertised over server channel (default redeemMode='auto')", () => {
    const req = baseRequirements();
    req.actions.next = [{ id: "boson-createOfferAndCommit", channels: ["server", "facilitator"] }];
    expect(pickAction(req)).toBe("boson-createOfferAndCommit");
  });

  it("returns boson-createOfferAndCommit for redeemMode='commit-only'", () => {
    const req = baseRequirements();
    req.actions.next = [{ id: "boson-createOfferAndCommit", channels: ["server"] }];
    expect(pickAction(req, { redeemMode: "commit-only" })).toBe("boson-createOfferAndCommit");
  });

  it("throws NotImplementedError for redeemMode='commit-and-redeem'", () => {
    const req = baseRequirements();
    req.actions.next = [{ id: "boson-createOfferAndCommit", channels: ["server"] }];
    expect(() => pickAction(req, { redeemMode: "commit-and-redeem" })).toThrow(NotImplementedError);
  });

  it("throws NotImplementedError when boson-createOfferCommitAndRedeem is offered over the server channel", () => {
    const req = baseRequirements();
    req.actions.next = [{ id: "boson-createOfferCommitAndRedeem", channels: ["server"] }];
    expect(() => pickAction(req)).toThrow(NotImplementedError);
  });

  it("throws NoCompatibleActionError when boson-createOfferAndCommit is offered but only over non-server channels", () => {
    const req = baseRequirements();
    req.actions.next = [{ id: "boson-createOfferAndCommit", channels: ["facilitator", "onchain"] }];
    expect(() => pickAction(req)).toThrow(NoCompatibleActionError);
  });

  it("throws NoCompatibleActionError when boson-createOfferCommitAndRedeem is offered only on non-server channels", () => {
    // Server doesn't expose the unsupported action over `server` either, so
    // the right error is "no compatible action", not "not implemented".
    const req = baseRequirements();
    req.actions.next = [
      { id: "boson-createOfferCommitAndRedeem", channels: ["facilitator", "onchain"] },
    ];
    expect(() => pickAction(req)).toThrow(NoCompatibleActionError);
  });

  it("throws NoCompatibleActionError when no Boson action is offered at all", () => {
    const req = baseRequirements();
    req.actions.next = [{ id: "some-other-action", channels: ["server"] }];
    expect(() => pickAction(req)).toThrow(NoCompatibleActionError);
  });

  it("prefers boson-createOfferAndCommit when both actions are listed and redeemMode is 'auto'", () => {
    const req = baseRequirements();
    req.actions.next = [
      { id: "boson-createOfferCommitAndRedeem", channels: ["server"] },
      { id: "boson-createOfferAndCommit", channels: ["server"] },
    ];
    expect(pickAction(req)).toBe("boson-createOfferAndCommit");
  });
});
