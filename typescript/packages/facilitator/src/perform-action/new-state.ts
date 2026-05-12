// Derive the predicted post-tx exchange + dispute state from an action id.
//
// Pure data lookup against `ACTION_POST_STATE` in
// `@bosonprotocol/x402-core/state-machine`. No RPC round-trip needed —
// the protocol's state-transition table is fully deterministic given the
// pre-state plus action id, and `performAction()` already knows the
// caller is invoking a transition from the exchange's current state.

import {
  ACTION_POST_STATE,
  type ActionId,
  type DisputeState,
  type ExchangeState,
} from "@bosonprotocol/x402-core/state-machine";

export interface NewState {
  newExchangeState: ExchangeState;
  newDisputeState?: DisputeState;
}

export function deriveNewState(action: ActionId): NewState {
  const post = ACTION_POST_STATE[action];
  return {
    newExchangeState: post.exchange,
    newDisputeState: post.dispute,
  };
}
