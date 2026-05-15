import { describe, expect, it } from "vitest";

import {
  clientLegalActions,
  DisputeState,
  EXCHANGE_ACTION_IDS,
  ExchangeState,
  isLegalTransition,
  legalActions,
  PRE_COMMIT,
  serverLegalActions,
  type ClientState,
} from "../../src/state-machine/index.js";

describe("clientLegalActions — buyer-side, spec-pinned shape", () => {
  it("PRE_COMMIT advances via createOfferAndCommit / createOfferCommitAndRedeem", () => {
    expect(clientLegalActions(PRE_COMMIT)).toEqual([
      "boson-createOfferAndCommit",
      "boson-createOfferCommitAndRedeem",
    ]);
  });

  it("COMMITTED advances via redeem / cancelVoucher (revokeVoucher is server-only)", () => {
    expect(clientLegalActions({ exchange: ExchangeState.COMMITTED })).toEqual([
      "boson-redeem",
      "boson-cancelVoucher",
    ]);
    expect(
      clientLegalActions({ exchange: ExchangeState.COMMITTED }) as readonly string[],
    ).not.toContain("boson-revokeVoucher");
  });

  it("REDEEMED advances via completeExchange / raiseDispute", () => {
    expect(clientLegalActions({ exchange: ExchangeState.REDEEMED })).toEqual([
      "boson-completeExchange",
      "boson-raiseDispute",
    ]);
  });

  it("DISPUTED + RESOLVING admits resolveDispute / escalateDispute / retractDispute", () => {
    expect(
      clientLegalActions({
        exchange: ExchangeState.DISPUTED,
        dispute: DisputeState.RESOLVING,
      }),
    ).toEqual(["boson-resolveDispute", "boson-escalateDispute", "boson-retractDispute"]);
  });

  it("DISPUTED + ESCALATED has no buyer actions (resolver decides)", () => {
    expect(
      clientLegalActions({
        exchange: ExchangeState.DISPUTED,
        dispute: DisputeState.ESCALATED,
      }),
    ).toEqual([]);
  });

  it("DISPUTED + post-settlement dispute states have no further buyer actions", () => {
    for (const dispute of [
      DisputeState.RESOLVED,
      DisputeState.RETRACTED,
      DisputeState.DECIDED,
      DisputeState.REFUSED,
    ]) {
      expect(clientLegalActions({ exchange: ExchangeState.DISPUTED, dispute })).toEqual([]);
    }
  });

  it("terminal exchange states (CANCELLED / COMPLETED / REVOKED) admit no buyer actions", () => {
    for (const exchange of [
      ExchangeState.CANCELLED,
      ExchangeState.COMPLETED,
      ExchangeState.REVOKED,
    ]) {
      expect(clientLegalActions({ exchange })).toEqual([]);
    }
  });
});

describe("serverLegalActions — seller-side", () => {
  it("COMMITTED admits revokeVoucher", () => {
    expect(serverLegalActions({ exchange: ExchangeState.COMMITTED })).toEqual([
      "boson-revokeVoucher",
    ]);
  });

  it("DISPUTED + RESOLVING admits resolveDispute (mutual; seller-initiable)", () => {
    expect(
      serverLegalActions({
        exchange: ExchangeState.DISPUTED,
        dispute: DisputeState.RESOLVING,
      }),
    ).toEqual(["boson-resolveDispute"]);
  });

  it("PRE_COMMIT, REDEEMED, and terminals admit no server actions", () => {
    expect(serverLegalActions(PRE_COMMIT)).toEqual([]);
    expect(serverLegalActions({ exchange: ExchangeState.REDEEMED })).toEqual([]);
    for (const exchange of [
      ExchangeState.CANCELLED,
      ExchangeState.COMPLETED,
      ExchangeState.REVOKED,
    ]) {
      expect(serverLegalActions({ exchange })).toEqual([]);
    }
  });

  it("dispute states beyond RESOLVING admit no server actions", () => {
    for (const dispute of [
      DisputeState.ESCALATED,
      DisputeState.RESOLVED,
      DisputeState.RETRACTED,
      DisputeState.DECIDED,
      DisputeState.REFUSED,
    ]) {
      expect(serverLegalActions({ exchange: ExchangeState.DISPUTED, dispute })).toEqual([]);
    }
  });
});

describe("client/server action sets — overlap and exclusivity", () => {
  it("revokeVoucher is server-only", () => {
    expect(serverLegalActions({ exchange: ExchangeState.COMMITTED })).toContain(
      "boson-revokeVoucher",
    );
    expect(
      clientLegalActions({ exchange: ExchangeState.COMMITTED }) as readonly string[],
    ).not.toContain("boson-revokeVoucher");
  });

  it("resolveDispute appears on both sides (mutual)", () => {
    const inDispute = {
      exchange: ExchangeState.DISPUTED,
      dispute: DisputeState.RESOLVING,
    } as const;
    expect(clientLegalActions(inDispute)).toContain("boson-resolveDispute");
    expect(serverLegalActions(inDispute)).toContain("boson-resolveDispute");
  });

  it("commit-side actions are client-only", () => {
    expect(clientLegalActions(PRE_COMMIT)).toEqual([
      "boson-createOfferAndCommit",
      "boson-createOfferCommitAndRedeem",
    ]);
    expect(serverLegalActions(PRE_COMMIT)).toEqual([]);
  });
});

describe("legalActions(side) parametrized form", () => {
  it("returns clientLegalActions when side='client'", () => {
    const state = { exchange: ExchangeState.COMMITTED } as const;
    expect(legalActions(state, "client")).toEqual(clientLegalActions(state));
  });

  it("returns serverLegalActions when side='server'", () => {
    const state = { exchange: ExchangeState.COMMITTED } as const;
    expect(legalActions(state, "server")).toEqual(serverLegalActions(state));
  });
});

describe("legalActions — coverage", () => {
  it("every exchange-keyed ActionId is reachable from at least one state on at least one side", () => {
    const reachable = new Set<string>();
    const states = [
      PRE_COMMIT,
      { exchange: ExchangeState.COMMITTED },
      { exchange: ExchangeState.REDEEMED },
      { exchange: ExchangeState.DISPUTED, dispute: DisputeState.RESOLVING },
    ] as const;
    for (const state of states) {
      for (const id of clientLegalActions(state)) reachable.add(id);
      for (const id of serverLegalActions(state)) reachable.add(id);
    }
    for (const id of EXCHANGE_ACTION_IDS) {
      expect(reachable.has(id)).toBe(true);
    }
  });

  it("entity-keyed actions are intentionally absent from clientLegalActions / serverLegalActions", () => {
    const states = [
      PRE_COMMIT,
      { exchange: ExchangeState.COMMITTED },
      { exchange: ExchangeState.REDEEMED },
      { exchange: ExchangeState.DISPUTED, dispute: DisputeState.RESOLVING },
    ] as const;
    for (const state of states) {
      expect(clientLegalActions(state)).not.toContain("boson-withdrawFunds");
      expect(serverLegalActions(state)).not.toContain("boson-withdrawFunds");
    }
  });
});

describe("ClientState — discriminated union enforcement", () => {
  // These compile-time checks pin the tightened-union shape: TypeScript
  // must reject a DISPUTED state without a `dispute`, and any non-DISPUTED
  // state with a `dispute` attached. The `@ts-expect-error` directives
  // fail the build if the type ever loosens accidentally.

  it("rejects { exchange: DISPUTED } with no dispute sub-state at type-check time", () => {
    // @ts-expect-error — DISPUTED requires a dispute sub-state.
    const bad: ClientState = { exchange: ExchangeState.DISPUTED };
    void bad;
  });

  it("rejects a dispute attached to a non-DISPUTED exchange state at type-check time", () => {
    // @ts-expect-error — only DISPUTED carries a dispute sub-state.
    const bad: ClientState = {
      exchange: ExchangeState.COMMITTED,
      dispute: DisputeState.RESOLVING,
    };
    void bad;
  });

  it("accepts every valid concrete shape", () => {
    const valid: ClientState[] = [
      PRE_COMMIT,
      { exchange: ExchangeState.COMMITTED },
      { exchange: ExchangeState.REDEEMED },
      { exchange: ExchangeState.COMPLETED },
      { exchange: ExchangeState.CANCELLED },
      { exchange: ExchangeState.REVOKED },
      { exchange: ExchangeState.DISPUTED, dispute: DisputeState.RESOLVING },
      { exchange: ExchangeState.DISPUTED, dispute: DisputeState.ESCALATED },
      { exchange: ExchangeState.DISPUTED, dispute: DisputeState.RESOLVED },
      { exchange: ExchangeState.DISPUTED, dispute: DisputeState.RETRACTED },
      { exchange: ExchangeState.DISPUTED, dispute: DisputeState.DECIDED },
      { exchange: ExchangeState.DISPUTED, dispute: DisputeState.REFUSED },
    ];
    // Every shape must be looked up without throwing.
    for (const state of valid) {
      expect(() => clientLegalActions(state)).not.toThrow();
      expect(() => serverLegalActions(state)).not.toThrow();
    }
  });
});

describe("isLegalTransition", () => {
  it("accepts known legal client transitions", () => {
    expect(
      isLegalTransition({ exchange: ExchangeState.REDEEMED }, "boson-completeExchange", "client"),
    ).toBe(true);
    expect(isLegalTransition(PRE_COMMIT, "boson-createOfferAndCommit", "client")).toBe(true);
  });

  it("accepts known legal server transitions", () => {
    expect(
      isLegalTransition({ exchange: ExchangeState.COMMITTED }, "boson-revokeVoucher", "server"),
    ).toBe(true);
  });

  it("rejects revokeVoucher on the client side", () => {
    expect(
      isLegalTransition({ exchange: ExchangeState.COMMITTED }, "boson-revokeVoucher", "client"),
    ).toBe(false);
  });

  it("rejects buyer actions on the server side", () => {
    expect(isLegalTransition(PRE_COMMIT, "boson-createOfferAndCommit", "server")).toBe(false);
    expect(
      isLegalTransition({ exchange: ExchangeState.REDEEMED }, "boson-completeExchange", "server"),
    ).toBe(false);
  });

  it("rejects every action from a terminal exchange state on either side", () => {
    for (const exchange of [
      ExchangeState.CANCELLED,
      ExchangeState.COMPLETED,
      ExchangeState.REVOKED,
    ]) {
      for (const id of EXCHANGE_ACTION_IDS) {
        expect(isLegalTransition({ exchange }, id, "client")).toBe(false);
        expect(isLegalTransition({ exchange }, id, "server")).toBe(false);
      }
    }
  });
});
