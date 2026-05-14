// `emitNextActions` — thin wrapper over `deriveNextActions` from
// `@bosonprotocol/x402-actions`. Stamps the seller's per-action
// `endpoints` / `channels` from the configured `ChannelRegistry`,
// returns the discriminated `EscrowNextActions` shape (post-commit)
// every convenience handler attaches to its response body.

import {
  deriveNextActions,
  DisputeState,
  ExchangeState,
  type ChannelRegistry,
  type EscrowNextActions,
} from "@bosonprotocol/x402-actions";

export type EmitNextActionsInput = {
  exchangeId: string;
} & (
  | { exchangeState: Exclude<ExchangeState, typeof ExchangeState.DISPUTED>; disputeState?: never }
  | { exchangeState: typeof ExchangeState.DISPUTED; disputeState: DisputeState }
);

/**
 * Build the `nextActions` envelope a handler attaches to its 200 body.
 * Pure wrapper; the only logic here beyond `deriveNextActions` is the
 * `DISPUTED → disputeState required` narrowing.
 */
export function emitNextActions(
  input: EmitNextActionsInput,
  registry: ChannelRegistry,
): EscrowNextActions {
  if (input.exchangeState === ExchangeState.DISPUTED) {
    return deriveNextActions(
      {
        exchangeId: input.exchangeId,
        exchangeState: ExchangeState.DISPUTED,
        disputeState: input.disputeState,
      },
      registry,
    );
  }
  return deriveNextActions(
    { exchangeId: input.exchangeId, exchangeState: input.exchangeState },
    registry,
  );
}
