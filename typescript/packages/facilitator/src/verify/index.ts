// `verify` — stateless pre-flight check on an EscrowPaymentPayload +
// EscrowPaymentRequirements pair.
//
// In v0.1 (this scaffold) this is a stub that throws NotImplementedError.
//
// Future implementation MUST (per docs/boson-impl-07-facilitator.md):
//   1. Confirm `scheme === "escrow"` and the payload network matches the
//      requirements.
//   2. Validate the payload structurally via `parseEscrowPaymentPayload`.
//   3. Recover and verify the buyer's metaTx signature against the
//      Diamond's EIP-712 domain.
//   4. If `tokenAuthStrategy !== "none"`, recover and verify the
//      tokenAuth signature against the asset's EIP-712 domain
//      (ERC-3009 / EIP-2612 / Permit2).
//   5. Cross-check action ∈ `requirements.actions.next[].id` and
//      tokenAuthStrategy ∈ `requirements.tokenAuthStrategies`.
//   6. Simulate `executeMetaTransaction(...)` against the public client
//      to catch protocol-level reverts (duplicate nonce, expired auth,
//      insufficient allowance, …) before settle() spends gas.
//   7. Return `{ ok: true }` on success, or `{ ok: false, code, reason }`
//      on a known failure. Unknown failures surface as
//      `{ ok: false, code: "INTERNAL_ERROR" }`.

import { NotImplementedError } from "../errors.js";
import type {
  FacilitatorConfig,
  FacilitatorVerifyInput,
  FacilitatorVerifyResult,
} from "../types.js";

export async function verify(
  _input: FacilitatorVerifyInput,
  _config: FacilitatorConfig,
): Promise<FacilitatorVerifyResult> {
  throw new NotImplementedError("verify");
}
