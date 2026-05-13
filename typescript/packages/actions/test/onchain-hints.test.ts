import { ACTION_IDS, type ActionId } from "@bosonprotocol/x402-core/state-machine";
import { describe, expect, it } from "vitest";

import {
  ACTION_FACETS,
  META_TX_ENTRYPOINTS,
  META_TX_FACET,
  actionFacetsFor,
  buildOnchainHints,
} from "../src/index.js";

const ESCROW = "0x0000000000000000000000000000000000000042";

describe("ACTION_FACETS", () => {
  it("has an entry for every action id", () => {
    for (const id of ACTION_IDS) {
      expect(ACTION_FACETS[id]).toBeTypeOf("string");
      expect(ACTION_FACETS[id].length).toBeGreaterThan(0);
    }
  });

  it("groups exchange-lifecycle actions on ExchangeHandlerFacet", () => {
    expect(ACTION_FACETS["boson-redeem"]).toBe("ExchangeHandlerFacet");
    expect(ACTION_FACETS["boson-cancelVoucher"]).toBe("ExchangeHandlerFacet");
    expect(ACTION_FACETS["boson-revokeVoucher"]).toBe("ExchangeHandlerFacet");
    expect(ACTION_FACETS["boson-completeExchange"]).toBe("ExchangeHandlerFacet");
  });

  it("groups all four dispute transitions on DisputeHandlerFacet", () => {
    expect(ACTION_FACETS["boson-raiseDispute"]).toBe("DisputeHandlerFacet");
    expect(ACTION_FACETS["boson-resolveDispute"]).toBe("DisputeHandlerFacet");
    expect(ACTION_FACETS["boson-escalateDispute"]).toBe("DisputeHandlerFacet");
    expect(ACTION_FACETS["boson-retractDispute"]).toBe("DisputeHandlerFacet");
  });

  it("routes commit-time actions to their specific facets", () => {
    expect(ACTION_FACETS["boson-createOfferAndCommit"]).toBe("ExchangeCommitFacet");
    expect(ACTION_FACETS["boson-createOfferCommitAndRedeem"]).toBe("OrchestrationHandlerFacet2");
  });
});

describe("actionFacetsFor", () => {
  it("returns only the requested action ids", () => {
    const subset: readonly ActionId[] = ["boson-redeem", "boson-completeExchange"];
    expect(actionFacetsFor(subset)).toEqual({
      "boson-redeem": "ExchangeHandlerFacet",
      "boson-completeExchange": "ExchangeHandlerFacet",
    });
  });

  it("returns an empty object for an empty list", () => {
    expect(actionFacetsFor([])).toEqual({});
  });
});

describe("META_TX_ENTRYPOINTS", () => {
  it("maps `none` to the legacy BPIP-9 entry point", () => {
    expect(META_TX_ENTRYPOINTS.none).toBe("executeMetaTransaction");
  });

  it("maps every token-auth strategy other than `none` to the BPIP-12 entry point", () => {
    for (const strategy of ["erc3009", "permit", "permit2"] as const) {
      expect(META_TX_ENTRYPOINTS[strategy]).toBe(
        "executeMetaTransactionWithTokenTransferAuthorization",
      );
    }
  });
});

describe("buildOnchainHints", () => {
  it("stamps the meta-tx facet verbatim and includes both entry points", () => {
    const hints = buildOnchainHints(ESCROW, ACTION_IDS);
    expect(hints.metaTxFacet).toBe(META_TX_FACET);
    expect(hints.metaTxEntrypoints).toEqual({
      none: "executeMetaTransaction",
      erc3009: "executeMetaTransactionWithTokenTransferAuthorization",
      permit: "executeMetaTransactionWithTokenTransferAuthorization",
      permit2: "executeMetaTransactionWithTokenTransferAuthorization",
    });
  });

  it("populates actionFacets only for the requested action ids", () => {
    const hints = buildOnchainHints(ESCROW, ["boson-raiseDispute", "boson-redeem"]);
    expect(hints.actionFacets).toEqual({
      "boson-raiseDispute": "DisputeHandlerFacet",
      "boson-redeem": "ExchangeHandlerFacet",
    });
  });

  it("uses the supplied escrow address verbatim", () => {
    const hints = buildOnchainHints(ESCROW, []);
    expect(hints.escrow).toBe(ESCROW);
  });
});
