// Legal transitions per (exchange, dispute) state, split by invoker.
//
// Source of truth: docs/boson-impl-04-state-machine-and-next-actions.md.
// Two separate tables, each listing the actions that the named party can
// directly invoke:
//
//   - CLIENT — actions the buyer (the x402 client) can invoke. Drives
//     the `nextActions` envelope on every server response to the buyer.
//   - SERVER — actions the seller (the x402 resource server) can invoke.
//     Used by the seller-side SDK to know which seller-invokable actions
//     are legally available at the current state.
//
// `resolveDispute` is mutual — both parties' signatures are required — and
// appears in BOTH tables: either side can initiate it once they hold the
// counterparty's signature. `revokeVoucher` is seller-only and appears
// only in SERVER. The other 8 exchange-keyed actions are buyer-only and
// appear only in CLIENT.
//
// One entity-keyed action — `boson-withdrawFunds` — is carved into the
// `(DISPUTED, RESOLVED)` row on both sides. A successful `resolveDispute`
// releases the buyer's and seller's escrowed funds to their respective
// available balances; surfacing withdraw on the very next `nextActions`
// envelope lets either party drain those funds in one click without
// needing to know about the standalone endpoint up-front. Other
// fund-releasing transitions (`completeExchange`, `cancelVoucher`,
// `revokeVoucher`, `retractDispute`, `decideDispute`, `refuseDispute`)
// could receive the same treatment in follow-up work.
//
// Higher-level concerns (deadline math, channel selection, channel
// fallback, the `nextActions` envelope) belong in
// `@bosonprotocol/x402-actions`'s runtime, not here.

import { type ActionId } from "./action-ids.js";
import { DisputeState, ExchangeState, PRE_COMMIT, type ClientState } from "./states.js";

/** Side of the protocol that's invoking the action. */
export type Side = "client" | "server";

type ExchangeTransitions = Record<ExchangeState | typeof PRE_COMMIT, readonly ActionId[]>;
type DisputeTransitions = Record<DisputeState, readonly ActionId[]>;

const CLIENT_BY_EXCHANGE: ExchangeTransitions = {
  [PRE_COMMIT]: ["boson-createOfferAndCommit", "boson-createOfferCommitAndRedeem"],
  [ExchangeState.COMMITTED]: ["boson-redeem", "boson-cancelVoucher"],
  [ExchangeState.REDEEMED]: ["boson-completeExchange", "boson-raiseDispute"],
  [ExchangeState.DISPUTED]: [], // branches on dispute sub-state.
  [ExchangeState.CANCELLED]: [],
  [ExchangeState.COMPLETED]: [],
  [ExchangeState.REVOKED]: [],
};

const CLIENT_BY_DISPUTE: DisputeTransitions = {
  [DisputeState.RESOLVING]: [
    "boson-resolveDispute",
    "boson-escalateDispute",
    "boson-retractDispute",
  ],
  [DisputeState.ESCALATED]: [], // resolver decides; buyer waits.
  [DisputeState.RESOLVED]: ["boson-withdrawFunds"],
  [DisputeState.RETRACTED]: [],
  [DisputeState.DECIDED]: [],
  [DisputeState.REFUSED]: [],
};

const SERVER_BY_EXCHANGE: ExchangeTransitions = {
  [PRE_COMMIT]: [],
  [ExchangeState.COMMITTED]: ["boson-revokeVoucher"],
  [ExchangeState.REDEEMED]: [],
  [ExchangeState.DISPUTED]: [],
  [ExchangeState.CANCELLED]: [],
  [ExchangeState.COMPLETED]: [],
  [ExchangeState.REVOKED]: [],
};

const SERVER_BY_DISPUTE: DisputeTransitions = {
  [DisputeState.RESOLVING]: ["boson-resolveDispute"], // mutual; seller-initiable.
  [DisputeState.ESCALATED]: [],
  [DisputeState.RESOLVED]: ["boson-withdrawFunds"],
  [DisputeState.RETRACTED]: [],
  [DisputeState.DECIDED]: [],
  [DisputeState.REFUSED]: [],
};

function lookup(
  state: ClientState,
  byExchange: ExchangeTransitions,
  byDispute: DisputeTransitions,
): readonly ActionId[] {
  if (state === PRE_COMMIT) return byExchange[PRE_COMMIT];
  if (state.exchange === ExchangeState.DISPUTED) return byDispute[state.dispute];
  return byExchange[state.exchange];
}

/**
 * Actions the client (buyer) can legally invoke from `state`.
 * Empty array means "buyer must wait / exchange is over for the buyer".
 */
export function clientLegalActions(state: ClientState): readonly ActionId[] {
  return lookup(state, CLIENT_BY_EXCHANGE, CLIENT_BY_DISPUTE);
}

/**
 * Actions the server (seller) can legally invoke from `state`.
 * Empty array means "no counterparty action is available at this state".
 */
export function serverLegalActions(state: ClientState): readonly ActionId[] {
  return lookup(state, SERVER_BY_EXCHANGE, SERVER_BY_DISPUTE);
}

/** Convenience: side-parametrized lookup. */
export function legalActions(state: ClientState, side: Side): readonly ActionId[] {
  return side === "client" ? clientLegalActions(state) : serverLegalActions(state);
}

/** True iff `actionId` is a legal transition for `side` out of `state`. */
export function isLegalTransition(state: ClientState, actionId: ActionId, side: Side): boolean {
  return legalActions(state, side).includes(actionId);
}
