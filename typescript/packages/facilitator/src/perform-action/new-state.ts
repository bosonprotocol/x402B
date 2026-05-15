// Derive the predicted post-tx exchange + dispute state from an action id.
//
// Pure data lookup against `ACTION_POST_STATE` in
// `@bosonprotocol/x402-core/state-machine`. No RPC round-trip needed —
// the protocol's state-transition table is fully deterministic given the
// pre-state plus action id, and `performAction()` already knows the
// caller is invoking a transition from the exchange's current state.
//
// Entity-keyed actions (e.g. `boson-withdrawFunds`) do not transition
// the exchange state machine and are intentionally absent from
// `ACTION_POST_STATE`; this helper accepts only `ExchangeActionId`.

import {
  ACTION_POST_STATE,
  type DisputeState,
  type ExchangeActionId,
  type ExchangeState,
} from "@bosonprotocol/x402-core/state-machine";

export interface NewState {
  newExchangeState: ExchangeState;
  newDisputeState?: DisputeState;
}

export function deriveNewState(action: ExchangeActionId): NewState {
  const post = ACTION_POST_STATE[action];
  return {
    newExchangeState: post.exchange,
    newDisputeState: post.dispute,
  };
}
