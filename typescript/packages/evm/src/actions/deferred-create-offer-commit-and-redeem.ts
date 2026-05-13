// Placeholder for `OrchestrationHandlerFacet2.createOfferCommitAndRedeem` —
// the atomic commit-and-redeem Boson action (Flow B in
// docs/boson-impl-02-flows.md, gated on contracts PR #1105).
//
// `@bosonprotocol/core-sdk` does not yet ship a
// `signMetaTxCreateOfferCommitAndRedeem` helper nor an
// `exchanges.iface.encodeCreateOfferCommitAndRedeem`. Until that lands,
// this builder throws loudly so callers can't accidentally invoke an
// unfinished path. Once core-sdk exposes the inner ABI encoder, swap the
// body to mirror `create-offer-and-commit.ts`.

import { NotYetSupportedError } from "../errors.js";
import type { InnerActionCalldata } from "../types.js";
import type { BuildCreateOfferAndCommitCalldataArgs } from "./create-offer-and-commit.js";

/**
 * @throws NotYetSupportedError — atomic commit-and-redeem is blocked on
 * `@bosonprotocol/core-sdk` shipping the inner-ABI encoder for
 * `OrchestrationHandlerFacet2.createOfferCommitAndRedeem`. Tracked against
 * Boson contracts PR #1105.
 */
export function buildCreateOfferCommitAndRedeemCalldata(
  _args: BuildCreateOfferAndCommitCalldataArgs,
): InnerActionCalldata {
  throw new NotYetSupportedError(
    "buildCreateOfferCommitAndRedeemCalldata",
    "@bosonprotocol/core-sdk does not yet expose an encoder for OrchestrationHandlerFacet2.createOfferCommitAndRedeem (Boson contracts PR #1105).",
  );
}
