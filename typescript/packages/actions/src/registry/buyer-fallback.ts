// Buyer-only on-chain fallback table — codifies the censorship
// resistance guarantees from
// docs/boson-impl-04-state-machine-and-next-actions.md §"Censorship
// resistance — guarantees".
//
// For each buyer-invokable action, the table records whether the buyer
// can advance the exchange via the `onchain` channel without any
// seller cooperation. Clients use this to short-circuit channel
// fallback: if a server's preferred channels are all unreachable but
// `BUYER_ONCHAIN_FALLBACK[action]` is `true`, the SDK signs and
// submits the transaction directly.

import type { ActionId } from "@bosonprotocol/x402-core/state-machine";

import type { ActionEntry } from "../types.js";

/**
 * For each `ActionId`, whether the buyer has a guaranteed
 * censorship-resistant on-chain path. Values come from the table at
 * docs/boson-impl-04-state-machine-and-next-actions.md
 * §"Censorship resistance — guarantees".
 *
 * Note: `boson-resolveDispute` requires a counterparty signature
 * (it's the mutual settlement step), so the buyer cannot
 * unilaterally complete it on-chain — `false`. `boson-revokeVoucher`
 * is seller-only and not a buyer action; it's listed as `false` for
 * type completeness but will never appear on a buyer-side envelope.
 */
export const BUYER_ONCHAIN_FALLBACK: Record<ActionId, boolean> = {
  "boson-createOfferAndCommit": true,
  "boson-createOfferCommitAndRedeem": true,
  "boson-redeem": true,
  "boson-cancelVoucher": true,
  "boson-completeExchange": true,
  "boson-raiseDispute": true,
  "boson-escalateDispute": true,
  "boson-retractDispute": true,
  "boson-resolveDispute": false,
  "boson-revokeVoucher": false,
};

/**
 * Whether the buyer can complete this action on-chain without any
 * seller cooperation.
 *
 * Two checks combined: the spec-level guarantee (action is one of the
 * buyer-onchain-resilient ids) AND the envelope advertises `onchain`
 * as one of its channels. A seller that advertises an action but
 * omits `onchain` from `channels` has not made the censorship-resistant
 * fallback available — the buyer must reach for the protocol facets
 * directly via `fallback.onchainHints`.
 */
export function hasBuyerOnchainFallback(entry: ActionEntry): boolean {
  if (!isBuyerOnchainResilient(entry.id)) return false;
  return entry.channels.includes("onchain");
}

/**
 * Whether the action id, in principle, supports a buyer-only on-chain
 * path. Useful when validating registry config (e.g. warning the seller
 * that their channel order doesn't expose onchain for an action that
 * could otherwise have been censorship-resistant).
 */
export function isBuyerOnchainResilient(id: string): boolean {
  return id in BUYER_ONCHAIN_FALLBACK ? BUYER_ONCHAIN_FALLBACK[id as ActionId] : false;
}
