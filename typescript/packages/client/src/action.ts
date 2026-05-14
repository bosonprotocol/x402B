// Pick the on-chain Boson action to invoke from a parsed PaymentRequirements.
//
// Two commit-time actions are supported:
//   - `boson-createOfferAndCommit` (Flow A, deferred redeem)
//   - `boson-createOfferCommitAndRedeem` (Flow B, atomic commit+redeem)
//
// Selection rules:
//   - `policy.redeemMode = "commit-only"` (or unset / "auto"): prefer Flow A.
//   - `policy.redeemMode = "commit-and-redeem"`: require Flow B; throw
//     `NoCompatibleActionError` if the server hasn't advertised it.
//
// In "auto" mode we keep MVP behaviour (prefer Flow A whenever advertised)
// so existing callers don't silently switch flows on the SDK upgrade. A
// future policy could promote Flow B when both are offered, but that's a
// separate change.

import type {
  BosonCommitActionId,
  EscrowPaymentRequirements,
} from "@bosonprotocol/x402-core/schemes/escrow";

import { NoCompatibleActionError } from "./errors.js";
import type { Policy } from "./types.js";

const FLOW_A: BosonCommitActionId = "boson-createOfferAndCommit";
const FLOW_B: BosonCommitActionId = "boson-createOfferCommitAndRedeem";

/**
 * Resolve the Boson commit-time action the client will sign. Throws
 * `NoCompatibleActionError` when the server hasn't advertised any action
 * compatible with the requested policy.
 */
export function pickAction(
  requirements: EscrowPaymentRequirements,
  policy?: Policy,
): BosonCommitActionId {
  const redeemMode = policy?.redeemMode ?? "auto";

  const flowAOffered = requirements.actions.next.some(
    (a) => a.id === FLOW_A && a.channels.includes("server"),
  );
  const flowBOffered = requirements.actions.next.some(
    (a) => a.id === FLOW_B && a.channels.includes("server"),
  );

  if (redeemMode === "commit-and-redeem") {
    if (flowBOffered) return FLOW_B;
    throw new NoCompatibleActionError(
      `policy.redeemMode='commit-and-redeem' requires '${FLOW_B}' on the server channel; requirements only advertise [${requirements.actions.next.map((a) => a.id).join(", ")}]`,
    );
  }

  // "auto" / "commit-only": prefer Flow A when present.
  if (flowAOffered) return FLOW_A;
  if (flowBOffered) return FLOW_B;

  throw new NoCompatibleActionError(
    `no commit-time action ('${FLOW_A}' or '${FLOW_B}') with 'server' channel found in requirements.actions.next`,
  );
}
