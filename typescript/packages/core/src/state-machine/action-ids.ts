// Stable action-id constants for Boson exchange + dispute + funds transitions.
//
// Source of truth: docs/boson-impl-04-state-machine-and-next-actions.md §"Action IDs".
// All Boson-specific ids carry the `boson-` prefix so the `escrow` scheme
// can later host other escrow implementations without collision; clients
// that don't recognize an action's prefix MUST skip it rather than
// dispatch.
//
// Two flavours of action id live here:
//
// 1. **Exchange-keyed actions** (`EXCHANGE_ACTION_IDS`) — the bulk of
//    the list. Each invocation operates on a single `exchangeId`, has a
//    well-defined pre/post state pair (see `ACTION_POST_STATE`), and is
//    eligible for the `nextActions.next[]` envelope built by
//    `@bosonprotocol/x402-actions`.
// 2. **Entity-keyed actions** (`ENTITY_ACTION_IDS`) — invocations that
//    target a Boson account `entityId` (buyer or seller) rather than a
//    specific exchange. They do not transition the exchange state
//    machine and are deliberately absent from `next[]`; they expose
//    their own server endpoints (e.g. `POST /x402B/withdraw-funds`).
//    See spec doc §"Entity-keyed actions".
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

/**
 * Actions tied to the exchange / dispute state machine. Each entry has a
 * deterministic `ACTION_POST_STATE` entry and is consumed by
 * `@bosonprotocol/x402-actions` when deriving `next[]`.
 */
export const EXCHANGE_ACTION_IDS = [
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

export type ExchangeActionId = (typeof EXCHANGE_ACTION_IDS)[number];

/**
 * Actions targeting a Boson account `entityId` (buyer or seller) rather
 * than a specific exchange. They live alongside the exchange-keyed set
 * for naming / prefix reasons but follow a separate dispatch path: a
 * dedicated convenience endpoint per action, no `ACTION_POST_STATE`
 * entry, and no representation in `nextActions.next[]`.
 */
export const ENTITY_ACTION_IDS = ["boson-withdrawFunds"] as const;

export type EntityActionId = (typeof ENTITY_ACTION_IDS)[number];

export const ACTION_IDS = [
  ...EXCHANGE_ACTION_IDS,
  ...ENTITY_ACTION_IDS,
] as const satisfies readonly (ExchangeActionId | EntityActionId)[];

export type ActionId = ExchangeActionId | EntityActionId;

const ENTITY_ACTION_SET = new Set<string>(ENTITY_ACTION_IDS);

/** Type guard — `true` iff `action` targets an `entityId` rather than an `exchangeId`. */
export function isEntityKeyedAction(action: string): action is EntityActionId {
  return ENTITY_ACTION_SET.has(action);
}

/**
 * The post-state of an exchange (and its dispute, if applicable) after the
 * given action is invoked successfully on the protocol. Useful for clients
 * that want to predict the next state client-side before re-fetching from
 * the subgraph.
 *
 * Some transitions terminate via dispute settlement and the exchange may
 * remain `DISPUTED` while the `Dispute` entity moves on — that's modeled
 * here by setting both `exchange` and `dispute`.
 *
 * Keyed by `ExchangeActionId`: entity-keyed actions have no exchange
 * post-state and intentionally do not appear here.
 */
export interface ActionPostState {
  exchange: ExchangeState;
  dispute?: DisputeState;
}

export const ACTION_POST_STATE: Record<ExchangeActionId, ActionPostState> = {
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

/**
 * Boson Diamond facet that exposes the on-chain primitive for each
 * `ActionId`. Used by `@bosonprotocol/x402-actions` to populate the
 * `fallback.onchainHints.actionFacets` block of a `nextActions`
 * envelope so buyers can reach the underlying contract method directly
 * via the `onchain` channel.
 *
 * Mapping rationale:
 * - `boson-createOfferAndCommit` lives on `ExchangeCommitFacet` (the
 *   deferred-redeem entry point per spec doc 04).
 * - `boson-createOfferCommitAndRedeem` lives on
 *   `OrchestrationHandlerFacet2` (the atomic-redeem entry point).
 * - `boson-redeem`, `boson-cancelVoucher`, `boson-revokeVoucher`, and
 *   `boson-completeExchange` are exchange-lifecycle methods on
 *   `ExchangeHandlerFacet`.
 * - All four dispute transitions (`raise` / `resolve` / `escalate` /
 *   `retract`) live on `DisputeHandlerFacet`.
 * - `boson-withdrawFunds` lives on `FundsHandlerFacet`.
 *
 * The keys are intentionally exhaustive over `ActionId` so adding a
 * new action id at compile time forces a paired facet entry.
 */
export const ACTION_FACETS: Record<ActionId, string> = {
  "boson-createOfferAndCommit": "ExchangeCommitFacet",
  "boson-createOfferCommitAndRedeem": "OrchestrationHandlerFacet2",
  "boson-redeem": "ExchangeHandlerFacet",
  "boson-cancelVoucher": "ExchangeHandlerFacet",
  "boson-revokeVoucher": "ExchangeHandlerFacet",
  "boson-completeExchange": "ExchangeHandlerFacet",
  "boson-raiseDispute": "DisputeHandlerFacet",
  "boson-resolveDispute": "DisputeHandlerFacet",
  "boson-escalateDispute": "DisputeHandlerFacet",
  "boson-retractDispute": "DisputeHandlerFacet",
  "boson-withdrawFunds": "FundsHandlerFacet",
};
