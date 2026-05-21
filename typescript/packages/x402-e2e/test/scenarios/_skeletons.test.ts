// Anchored `it.todo` declarations for scenarios that land in PR 7 /
// PR 8. The file exists so a grep for any scenario id (e.g. `B4`,
// `F1`, `D3`) lands in this repo and the future PR has a defined
// home to fill in. Each todo carries the same description text as the
// plan in `docs/`... oh wait, the plan lives in a working file
// outside the repo — describe each scenario inline below so the
// suite is self-contained.

import { describe, it } from "vitest";

import { ENABLED } from "./_flags.js";

// B1–B4, B6, B7 moved to `post-commit.test.ts` as runnable scenarios.
// The remaining @p1 / @p2 items stay parked here as `it.todo` until
// they're picked up — B5 needs dispute-resolver-deposit handling,
// B8 needs SellerActor meta-tx signing, and B9 needs ResolverActor
// wallet signing.

describe.skipIf(!ENABLED)("@p1 post-commit lifecycle — follow-up", () => {
  it.todo("B5 — escalateDispute with deposit → DisputeState.ESCALATED");
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
  // D3 stays a todo: the client-side channel fallback chain
  // (server → facilitator → onchain on 5xx / network error) isn't
  // implemented today in `x402-client` / `x402-client-fetch`. The
  // test will land alongside the feature work in its own PR.
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

describe.skipIf(!ENABLED)("@p1/@p2 commit-time fulfillment — PR 7", () => {
  it.todo("A6 — commit with `webhook` fulfillment → webhook-sink receives onCommit payload");
  it.todo("A7 — commit with `ipfs-pointer` fulfillment → response carries valid CID");
  it.todo("A8 — commit with `mcp` fulfillment — skipped until `@bosonprotocol/x402-agent` lands");
});
