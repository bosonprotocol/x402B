import { describe, expect, it } from "vitest";

import {
  ACTION_FACETS,
  ACTION_ID_PREFIX,
  ACTION_IDS,
  ACTION_POST_STATE,
  DisputeState,
  ENTITY_ACTION_IDS,
  EXCHANGE_ACTION_IDS,
  ExchangeState,
  isEntityKeyedAction,
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

  it("includes withdrawFunds (entity-keyed action)", () => {
    expect(ACTION_IDS).toContain("boson-withdrawFunds");
    expect(ENTITY_ACTION_IDS).toContain("boson-withdrawFunds");
    expect(EXCHANGE_ACTION_IDS).not.toContain("boson-withdrawFunds" as never);
  });

  it("excludes resolver-only actions (decideDispute, refuseEscalatedDispute)", () => {
    expect(ACTION_IDS).not.toContain("boson-decideDispute");
    expect(ACTION_IDS).not.toContain("boson-refuseEscalatedDispute");
  });

  it("ACTION_POST_STATE covers every exchange-keyed action with a known ExchangeState", () => {
    const exchangeValues = new Set<string>(Object.values(ExchangeState));
    for (const id of EXCHANGE_ACTION_IDS) {
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

  it("ACTION_FACETS covers every action (including entity-keyed)", () => {
    for (const id of ACTION_IDS) {
      expect(ACTION_FACETS[id]).toBeDefined();
      expect(typeof ACTION_FACETS[id]).toBe("string");
    }
  });

  it("withdrawFunds maps to FundsHandlerFacet", () => {
    expect(ACTION_FACETS["boson-withdrawFunds"]).toBe("FundsHandlerFacet");
  });

  it("isEntityKeyedAction discriminates entity vs exchange actions", () => {
    expect(isEntityKeyedAction("boson-withdrawFunds")).toBe(true);
    expect(isEntityKeyedAction("boson-redeem")).toBe(false);
    expect(isEntityKeyedAction("boson-raiseDispute")).toBe(false);
    expect(isEntityKeyedAction("not-a-boson-action")).toBe(false);
  });
});
