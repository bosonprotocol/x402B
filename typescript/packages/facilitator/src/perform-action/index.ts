// `performAction` — relay a post-commit transition (redeem / complete /
// cancel / revoke / raise / retract / escalate / resolve dispute) on
// behalf of the signer.
//
// In v0.1 (this scaffold) this is a stub that throws NotImplementedError.
//
// Future implementation wraps the buyer-or-seller's pre-signed meta-tx
// envelope (`input.signedPayload`) the same way `settle()` does — same
// `buildExecuteMetaTransactionTx` call, same submit-and-wait flow. The
// facilitator is signer-agnostic: it recovers the signer to confirm the
// signature is well-formed but doesn't care about role (buyer vs seller).
//
// The signed `functionName` inside the envelope selects which protocol
// facet runs; `performAction` only needs `input.action` to derive the
// post-state for the response (see `ACTION_POST_STATE` in
// `@bosonprotocol/x402-core/state-machine`).
//
// This is the back-end behind the `"facilitator"` channel emitted by
// `FacilitatorChannelAdapter.describe(action, cfg)` for every post-commit
// action.

import { NotImplementedError } from "../errors.js";
import type {
  FacilitatorConfig,
  FacilitatorPerformActionInput,
  FacilitatorPerformActionResult,
} from "../types.js";

export async function performAction(
  _input: FacilitatorPerformActionInput,
  _config: FacilitatorConfig,
): Promise<FacilitatorPerformActionResult> {
  throw new NotImplementedError("performAction");
}
