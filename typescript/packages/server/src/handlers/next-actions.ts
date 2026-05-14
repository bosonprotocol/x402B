// `emitNextActions` — thin wrapper over `deriveNextActions` from
// `@bosonprotocol/x402-actions`. Stamps the seller's per-action
// `endpoints` / `channels` from the configured `ChannelRegistry`,
// returns the discriminated `EscrowNextActions` shape (post-commit)
// every convenience handler attaches to its response body.
//
// When the caller passes `facilitatorUrl`, the wrapper additionally
// stamps `endpoints.facilitator` on every entry whose `channels`
// include `"facilitator"` — matching the pre-commit behaviour in
// `server.buildPaymentRequirements`. Without that stamp the buyer
// sees `facilitator` advertised in `channels` but no URL to hit; the
// channel is effectively dead.

import {
  deriveNextActions,
  DisputeState,
  ExchangeState,
  type ChannelRegistry,
  type EscrowNextActions,
} from "@bosonprotocol/x402-actions";

import { stampFacilitatorEndpoints } from "../internal/facilitator-endpoints.js";

export type EmitNextActionsInput = {
  exchangeId: string;
} & (
  | { exchangeState: Exclude<ExchangeState, typeof ExchangeState.DISPUTED>; disputeState?: never }
  | { exchangeState: typeof ExchangeState.DISPUTED; disputeState: DisputeState }
);

/**
 * Build the `nextActions` envelope a handler attaches to its 200 body.
 * Pure wrapper; the logic beyond `deriveNextActions` is the
 * `DISPUTED → disputeState required` narrowing and the optional
 * facilitator-endpoint stamp.
 */
export function emitNextActions(
  input: EmitNextActionsInput,
  registry: ChannelRegistry,
  facilitatorUrl?: string,
): EscrowNextActions {
  const derived =
    input.exchangeState === ExchangeState.DISPUTED
      ? deriveNextActions(
          {
            exchangeId: input.exchangeId,
            exchangeState: ExchangeState.DISPUTED,
            disputeState: input.disputeState,
          },
          registry,
        )
      : deriveNextActions(
          { exchangeId: input.exchangeId, exchangeState: input.exchangeState },
          registry,
        );

  if (facilitatorUrl === undefined) {
    return derived;
  }

  return {
    ...derived,
    next: stampFacilitatorEndpoints(derived.next, facilitatorUrl),
  };
}
