// Helpers for stamping `endpoints.facilitator` on every `NextAction`
// entry that advertises the `facilitator` channel. Used both at the
// 402 challenge (pre-commit `EscrowPaymentRequirements.actions.next`)
// and on every post-commit `EscrowNextActions` envelope a handler
// returns — keeping the URL-shape logic in one place so the two
// surfaces can't drift.

import type { NextAction } from "@bosonprotocol/x402-core/schemes/escrow";

const COMMIT_ACTION_IDS = new Set([
  "boson-createOfferAndCommit",
  "boson-createOfferCommitAndRedeem",
]);

/**
 * Pick the facilitator endpoint URL for a given action id. Commit-time
 * actions route to `/settle`; every other action routes to
 * `/perform-action?action=<id>` so the facilitator can dispatch per
 * action without re-parsing the meta-tx calldata.
 */
export function facilitatorEndpointFor(actionId: string, facilitatorUrl: string): string {
  const base = facilitatorUrl.replace(/\/+$/, "");
  if (COMMIT_ACTION_IDS.has(actionId)) {
    return `${base}/settle`;
  }
  return `${base}/perform-action?action=${encodeURIComponent(actionId)}`;
}

/**
 * Return a new `NextAction[]` with `endpoints.facilitator` stamped on
 * every entry that advertises the `facilitator` channel. Entries that
 * already carry an explicit `endpoints.facilitator` are left as-is
 * (the caller wins) — same for entries whose `channels` don't include
 * `"facilitator"`.
 */
export function stampFacilitatorEndpoints(
  next: readonly NextAction[],
  facilitatorUrl: string,
): NextAction[] {
  return next.map((entry) => {
    if (!entry.channels.includes("facilitator")) {
      return entry;
    }
    if (entry.endpoints?.facilitator !== undefined) {
      return entry;
    }
    return {
      ...entry,
      endpoints: {
        ...entry.endpoints,
        facilitator: facilitatorEndpointFor(entry.id, facilitatorUrl),
      },
    };
  });
}
