// Pick the on-chain Boson action to invoke from a parsed PaymentRequirements.
//
// MVP supports only `boson-createOfferAndCommit` (deferred-redeem path).
// `boson-createOfferCommitAndRedeem` is not yet exposed by
// `@bosonprotocol/core-sdk` and is rejected with `NotImplementedError` here
// so callers learn early, rather than mid-signing.

import type {
  BosonCommitActionId,
  EscrowPaymentRequirements,
} from "@bosonprotocol/x402-core/schemes/escrow";

import { NoCompatibleActionError, NotImplementedError } from "./errors.js";
import type { Policy } from "./types.js";

const SUPPORTED_ACTION: BosonCommitActionId = "boson-createOfferAndCommit";
const UNSUPPORTED_ACTION: BosonCommitActionId = "boson-createOfferCommitAndRedeem";

/**
 * Resolve the Boson commit-time action the client will sign. Throws if the
 * requested redeem mode is not yet implemented, or if the server hasn't
 * advertised a supported action over the server channel.
 */
export function pickAction(
  requirements: EscrowPaymentRequirements,
  policy?: Policy,
): BosonCommitActionId {
  const redeemMode = policy?.redeemMode ?? "auto";

  if (redeemMode === "commit-and-redeem") {
    throw new NotImplementedError(
      `redeemMode='commit-and-redeem' requires core-sdk support for ${UNSUPPORTED_ACTION}, which is not yet wired`,
    );
  }

  const supported = requirements.actions.next.find(
    (a) => a.id === SUPPORTED_ACTION && a.channels.includes("server"),
  );
  if (supported) {
    return SUPPORTED_ACTION;
  }

  const onlyUnsupported = requirements.actions.next.some((a) => a.id === UNSUPPORTED_ACTION);
  if (onlyUnsupported) {
    throw new NotImplementedError(
      `server advertises only ${UNSUPPORTED_ACTION}; client does not yet implement that action`,
    );
  }

  throw new NoCompatibleActionError(
    `no '${SUPPORTED_ACTION}' action with 'server' channel found in requirements.actions.next`,
  );
}
