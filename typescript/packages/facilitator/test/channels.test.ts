import { describe, expect, it } from "vitest";

import { FacilitatorChannelAdapter } from "../src/channels/facilitator/index.js";

const URL = "https://facilitator.example";

describe("FacilitatorChannelAdapter", () => {
  const adapter = new FacilitatorChannelAdapter();

  it("identifies itself as the facilitator channel", () => {
    expect(adapter.channel).toBe("facilitator");
  });

  it("routes commit-time actions to /settle", () => {
    expect(adapter.describe("boson-createOfferAndCommit", { url: URL })).toEqual({
      endpoint: `${URL}/settle`,
    });
    expect(adapter.describe("boson-createOfferCommitAndRedeem", { url: URL })).toEqual({
      endpoint: `${URL}/settle`,
    });
  });

  it("routes post-commit actions to /perform-action with action query param", () => {
    expect(adapter.describe("boson-redeem", { url: URL })).toEqual({
      endpoint: `${URL}/perform-action?action=boson-redeem`,
    });
    expect(adapter.describe("boson-completeExchange", { url: URL })).toEqual({
      endpoint: `${URL}/perform-action?action=boson-completeExchange`,
    });
    expect(adapter.describe("boson-cancelVoucher", { url: URL })).toEqual({
      endpoint: `${URL}/perform-action?action=boson-cancelVoucher`,
    });
    expect(adapter.describe("boson-revokeVoucher", { url: URL })).toEqual({
      endpoint: `${URL}/perform-action?action=boson-revokeVoucher`,
    });
    expect(adapter.describe("boson-raiseDispute", { url: URL })).toEqual({
      endpoint: `${URL}/perform-action?action=boson-raiseDispute`,
    });
    expect(adapter.describe("boson-retractDispute", { url: URL })).toEqual({
      endpoint: `${URL}/perform-action?action=boson-retractDispute`,
    });
    expect(adapter.describe("boson-escalateDispute", { url: URL })).toEqual({
      endpoint: `${URL}/perform-action?action=boson-escalateDispute`,
    });
    expect(adapter.describe("boson-resolveDispute", { url: URL })).toEqual({
      endpoint: `${URL}/perform-action?action=boson-resolveDispute`,
    });
  });

  it("uses the configured url verbatim — no trailing-slash normalization", () => {
    const trailing = "https://facilitator.example/";
    expect(adapter.describe("boson-redeem", { url: trailing })).toEqual({
      endpoint: `${trailing}/perform-action?action=boson-redeem`,
    });
  });
});
