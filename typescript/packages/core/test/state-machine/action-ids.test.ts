import { describe, expect, it } from "vitest";

import {
  ACTION_ID_PREFIX,
  ACTION_IDS,
  ACTION_POST_STATE,
  DisputeState,
  ExchangeState,
} from "../../src/state-machine/index.js";

describe("ActionId set", () => {
  it("every id carries the boson- prefix", () => {
    for (const id of ACTION_IDS) {
      expect(id.startsWith(ACTION_ID_PREFIX)).toBe(true);
    }
  });

  it("ids are unique", () => {
    expect(new Set(ACTION_IDS).size).toBe(ACTION_IDS.length);
  });

  it("includes revokeVoucher (server-side action)", () => {
    expect(ACTION_IDS).toContain("boson-revokeVoucher");
  });

  it("excludes resolver-only actions (decideDispute, refuseEscalatedDispute)", () => {
    expect(ACTION_IDS).not.toContain("boson-decideDispute");
    expect(ACTION_IDS).not.toContain("boson-refuseEscalatedDispute");
  });

  it("ACTION_POST_STATE covers every action with a known ExchangeState", () => {
    const exchangeValues = new Set<string>(Object.values(ExchangeState));
    for (const id of ACTION_IDS) {
      const post = ACTION_POST_STATE[id];
      expect(post).toBeDefined();
      expect(exchangeValues.has(post.exchange)).toBe(true);
    }
  });

  it("revokeVoucher's post-state is REVOKED on the exchange", () => {
    expect(ACTION_POST_STATE["boson-revokeVoucher"]).toEqual({
      exchange: ExchangeState.REVOKED,
    });
  });

  it("dispute-related actions also pin a DisputeState post-value", () => {
    const disputeValues = new Set<string>(Object.values(DisputeState));
    expect(ACTION_POST_STATE["boson-raiseDispute"].dispute).toBe(DisputeState.RESOLVING);
    expect(ACTION_POST_STATE["boson-resolveDispute"].dispute).toBe(DisputeState.RESOLVED);
    expect(ACTION_POST_STATE["boson-escalateDispute"].dispute).toBe(DisputeState.ESCALATED);
    expect(ACTION_POST_STATE["boson-retractDispute"].dispute).toBe(DisputeState.RETRACTED);
    for (const id of [
      "boson-raiseDispute",
      "boson-resolveDispute",
      "boson-escalateDispute",
      "boson-retractDispute",
    ] as const) {
      const d = ACTION_POST_STATE[id].dispute;
      expect(d).toBeDefined();
      expect(disputeValues.has(d!)).toBe(true);
    }
  });
});
