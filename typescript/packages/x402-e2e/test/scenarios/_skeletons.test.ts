// Anchored `it.todo` declarations for scenarios that land in PR 7 /
// PR 8. The file exists so a grep for any scenario id (e.g. `B4`,
// `F1`, `D3`) lands in this repo and the future PR has a defined
// home to fill in. Each todo carries the same description text as the
// plan in `docs/`... oh wait, the plan lives in a working file
// outside the repo — describe each scenario inline below so the
// suite is self-contained.

import { describe, it } from "vitest";

import { ENABLED } from "./_flags.js";

describe.skipIf(!ENABLED)("@p0 post-commit lifecycle — PR 7", () => {
  it.todo("B1 — redeem after deferred commit → ExchangeState.REDEEMED");
  it.todo("B2 — completeExchange after redeem → ExchangeState.COMPLETED, escrow released");
  it.todo("B3 — raiseDispute after redeem → DisputeState.RESOLVING");
  it.todo("B4 — mutual resolveDispute (buyer % split, dual-sig) → DisputeState.RESOLVED");
});

describe.skipIf(!ENABLED)("@p1 post-commit lifecycle — PR 7", () => {
  it.todo("B5 — escalateDispute with deposit → DisputeState.ESCALATED");
  it.todo("B6 — retractDispute by buyer → DisputeState.RETRACTED");
  it.todo("B7 — cancelVoucher before redeem → ExchangeState.CANCELLED, escrow refunded - penalty");
});

describe.skipIf(!ENABLED)("@p2 post-commit lifecycle — PR 7", () => {
  it.todo("B8 — revokeVoucher by seller → seller-initiated cancel");
  it.todo("B9 — decideDispute by resolver → DisputeState.DECIDED, resolver-set split");
});

describe.skipIf(!ENABLED)("@p1 commit-time validations — PR 7", () => {
  it.todo("C6 — insufficient escrow balance → SIMULATION_REVERT");
  it.todo("C9 — sellerSig mismatch in FullOffer → server BAD_SELLER_SIG");
  it.todo("C10 — post-commit action on wrong state (e.g. redeem while CANCELLED) → reject");
});

describe.skipIf(!ENABLED)("@p2 commit-time validations — PR 7", () => {
  it.todo("C7 — invalid `tokenAuthStrategy` value (not in enum) → INVALID_PAYLOAD");
});

describe.skipIf(!ENABLED)("@p0/@p1 nextActions / channel routing — PR 7", () => {
  it.todo("D1 — post-commit nextActions[] matches ACTION_POST_STATE for the new state");
  it.todo("D2 — post-redeem nextActions[] shrinks to [completeExchange, raiseDispute]");
  it.todo("D3 — server/facilitator/onchain channel fallback chain (kill facilitator)");
  it.todo(
    "D4 — `mcp` channel for buyer-side action — skipped until `@bosonprotocol/x402-agent` lands",
  );
});

describe.skipIf(!ENABLED)("@p1/@p2 multi-party — PR 7", () => {
  it.todo("E1 — two concurrent buyers commit to the same offer → distinct exchangeIds");
  it.todo("E2 — buyer commits, then seller revokeVoucher → buyer refunded");
  it.todo("E3 — mutual resolveDispute requires both buyer + seller sigs (dual-sig regression)");
});

describe.skipIf(!ENABLED)("@p1/@p2 operational / failure-mode — PR 8", () => {
  it.todo("F1 — facilitator restart mid-flight → client retries idempotently");
  it.todo("F2 — subgraph indexer lag → server falls back to RPC ExchangeReader");
  it.todo("F3 — meta-tx-gateway down during createSeller seed → clear error surfaces");
  it.todo("F4 — buyer key rotation mid-flow → redeem rejected (from-address mismatch)");
});

describe.skipIf(!ENABLED)("@p1/@p2 commit-time fulfillment — PR 7", () => {
  it.todo("A6 — commit with `webhook` fulfillment → webhook-sink receives onCommit payload");
  it.todo("A7 — commit with `ipfs-pointer` fulfillment → response carries valid CID");
  it.todo("A8 — commit with `mcp` fulfillment — skipped until `@bosonprotocol/x402-agent` lands");
});
