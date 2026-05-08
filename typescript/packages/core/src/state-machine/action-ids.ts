// Stable action-id constants for Boson exchange + dispute transitions.
//
// Source of truth: docs/boson-impl-04-state-machine-and-next-actions.md §"Action IDs".
// All Boson-specific ids carry the `boson-` prefix so the `escrow` scheme
// can later host other escrow implementations without collision; clients
// that don't recognize an action's prefix MUST skip it rather than
// dispatch.
//
// Scope: actions either the client (buyer) OR the server (seller) can
// invoke. The buyer/seller split lives in `./transitions.ts` —
// `clientLegalActions` vs `serverLegalActions`. Dispute-resolver-only
// transitions (`decideDispute`, `refuseEscalatedDispute`) and pure
// time-based transitions (voucher expiry, dispute timeout, escalation
// timeout) are not exposed as actions here.
//
// Future additions tracked but not yet listed:
//   - `boson-commitToOffer` — commits to an existing offer (no fresh offer
//     creation). Adds COMMITTED as a post-state from PRE_COMMIT alongside
//     `createOfferAndCommit`.
//   - `boson-commitToConditionalOffer` — commits to an existing offer that
//     gates entry on a token-holding condition. Same post-state as
//     `commitToOffer`.
//   - `boson-commitToConditionalOfferAndRedeemVoucher` — the atomic
//     commit-and-redeem variant for conditional offers, parallel to
//     `createOfferCommitAndRedeem`.
// These will land once the corresponding Boson Diamond facets stabilize.

import { DisputeState, ExchangeState } from "./states.js";

/** Prefix used by every Boson-side action id. */
export const ACTION_ID_PREFIX = "boson-" as const;

export const ACTION_IDS = [
  "boson-createOfferAndCommit",
  "boson-createOfferCommitAndRedeem",
  "boson-redeem",
  "boson-cancelVoucher",
  "boson-revokeVoucher",
  "boson-completeExchange",
  "boson-raiseDispute",
  "boson-resolveDispute",
  "boson-escalateDispute",
  "boson-retractDispute",
] as const;

export type ActionId = (typeof ACTION_IDS)[number];

/**
 * The post-state of an exchange (and its dispute, if applicable) after the
 * given action is invoked successfully on the protocol. Useful for clients
 * that want to predict the next state client-side before re-fetching from
 * the subgraph.
 *
 * Some transitions terminate via dispute settlement and the exchange may
 * remain `DISPUTED` while the `Dispute` entity moves on — that's modeled
 * here by setting both `exchange` and `dispute`.
 */
export interface ActionPostState {
  exchange: ExchangeState;
  dispute?: DisputeState;
}

export const ACTION_POST_STATE: Record<ActionId, ActionPostState> = {
  "boson-createOfferAndCommit": { exchange: ExchangeState.COMMITTED },
  "boson-createOfferCommitAndRedeem": { exchange: ExchangeState.REDEEMED },
  "boson-redeem": { exchange: ExchangeState.REDEEMED },
  "boson-cancelVoucher": { exchange: ExchangeState.CANCELLED },
  "boson-revokeVoucher": { exchange: ExchangeState.REVOKED },
  "boson-completeExchange": { exchange: ExchangeState.COMPLETED },
  "boson-raiseDispute": {
    exchange: ExchangeState.DISPUTED,
    dispute: DisputeState.RESOLVING,
  },
  "boson-resolveDispute": {
    exchange: ExchangeState.DISPUTED,
    dispute: DisputeState.RESOLVED,
  },
  "boson-escalateDispute": {
    exchange: ExchangeState.DISPUTED,
    dispute: DisputeState.ESCALATED,
  },
  "boson-retractDispute": {
    exchange: ExchangeState.DISPUTED,
    dispute: DisputeState.RETRACTED,
  },
};
