// `fallback.onchainHints` stamper — pure mapping from action ids to
// their owning facet, paired with the meta-tx entry-point constants.
//
// Source of truth for the action → facet table is `ACTION_FACETS` in
// `@bosonprotocol/x402-core/state-machine`. This module is the
// consumer-facing helper that bundles those constants with the
// per-`tokenAuthStrategy` meta-tx entry-point names so the server SDK
// never has to hand-author a `fallback.onchainHints` block.

import type { OnchainHints, TokenAuthStrategy } from "@bosonprotocol/x402-core/schemes/escrow";
import { ACTION_FACETS, type ActionId } from "@bosonprotocol/x402-core/state-machine";

export { ACTION_FACETS } from "@bosonprotocol/x402-core/state-machine";

/**
 * Boson Diamond facet that hosts the BPIP-9 / BPIP-12 meta-transaction
 * entry-points used by the `facilitator` and `onchain` channels.
 * Constant — every meta-tx we forward goes through this facet.
 *
 * Intentionally not pinned to a specific contract version: this is the
 * facet *name*, which is stable across protocol upgrades; the exact
 * deployed-contract address is resolved separately via the seller's
 * escrow address and the Diamond's facet registry.
 */
export const META_TX_FACET = "MetaTransactionsHandlerFacet" as const;

/**
 * Per-`tokenAuthStrategy` meta-tx entry points on `META_TX_FACET`.
 *
 * - `none` — legacy BPIP-9 entry point (`executeMetaTransaction`).
 *   Used when the buyer has pre-approved the Diamond, and for any
 *   post-commit action that doesn't move tokens
 *   (`redeem` / `complete` / dispute transitions).
 * - `erc3009` / `permit` / `permit2` — BPIP-12 entry point
 *   (`executeMetaTransactionWithTokenTransferAuthorization`), which
 *   carries the buyer's signed `MetaTransaction` *and* a queue of
 *   token-transfer authorizations.
 *
 * Constant — these are protocol-level invariants; the seller does not
 * configure them.
 */
export const META_TX_ENTRYPOINTS: Readonly<Record<TokenAuthStrategy, string>> = {
  none: "executeMetaTransaction",
  erc3009: "executeMetaTransactionWithTokenTransferAuthorization",
  permit: "executeMetaTransactionWithTokenTransferAuthorization",
  permit2: "executeMetaTransactionWithTokenTransferAuthorization",
} as const;

/**
 * Build the subset of `ACTION_FACETS` for a given list of action ids.
 * Used by `deriveNextActions` to populate
 * `fallback.onchainHints.actionFacets` only for the actions the
 * envelope actually advertises, keeping the wire format compact.
 */
export function actionFacetsFor(actionIds: readonly ActionId[]): Record<ActionId, string> {
  const out = {} as Record<ActionId, string>;
  for (const id of actionIds) {
    out[id] = ACTION_FACETS[id];
  }
  return out;
}

/**
 * Build the full `fallback.onchainHints` block for an envelope.
 *
 * Consumers pass the seller's escrow (Boson Diamond) address and the
 * action ids that the envelope is going to advertise; the helper
 * returns a fully-populated `OnchainHints` ready to drop into
 * `nextActions.fallback.onchainHints`.
 */
export function buildOnchainHints(escrow: string, actionIds: readonly ActionId[]): OnchainHints {
  return {
    escrow,
    metaTxFacet: META_TX_FACET,
    metaTxEntrypoints: { ...META_TX_ENTRYPOINTS },
    actionFacets: actionFacetsFor(actionIds),
  };
}
