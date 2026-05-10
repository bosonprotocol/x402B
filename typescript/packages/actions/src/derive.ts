// `deriveNextActions` — pure envelope builder.
//
// Reads the legal client-invokable transitions from
// `@bosonprotocol/x402-core/state-machine`'s transition tables and
// stamps them with the seller's configured channels, endpoints, and
// deadlines. No I/O, no protocol calls — input is the client's
// `(exchangeState, disputeState?)` tuple plus a `ChannelRegistry`.
//
// Source of truth: docs/boson-impl-04-state-machine-and-next-actions.md
// §"Server-side derivation".

import type {
  ActionsEnvelope,
  EscrowNextActions,
  NextAction,
} from "@bosonprotocol/x402-core/schemes/escrow";
import {
  clientLegalActions,
  ExchangeState,
  PRE_COMMIT,
  type ActionId,
  type ClientState,
  type DisputeState,
} from "@bosonprotocol/x402-core/state-machine";

import type { ChannelRegistry } from "./registry/index.js";

/**
 * Per-action input the caller may attach to override or augment what the
 * envelope builder produces. Keys are stable action ids.
 *
 * - `deadlines` — ISO 8601 absolute timestamps. Useful when the caller
 *   has the on-chain dispute / redemption-window timestamps from the
 *   subgraph and wants the deadline math handled upstream rather than
 *   re-derived inside the builder. Future revisions of this function
 *   may compute deadlines from a richer `Exchange` argument directly,
 *   at which point this field becomes redundant.
 */
export interface DeriveDecorations {
  deadlines?: Partial<Record<ActionId, string>>;
}

/**
 * The current client-state input to `deriveNextActions`. Mirrors the
 * three top-level fields of `EscrowNextActions` (the post-commit
 * envelope) so callers can pass an exchange snapshot directly. The
 * field is named `exchangeState` (not `state`) for symmetry with
 * `disputeState` and to remove ambiguity with the `state` field the
 * subgraph entity itself carries.
 */
export type DeriveNextActionsInput = {
  exchangeId: string;
} & (
  | {
      exchangeState: Exclude<ExchangeState, typeof ExchangeState.DISPUTED>;
      disputeState?: never;
    }
  | { exchangeState: typeof ExchangeState.DISPUTED; disputeState: DisputeState }
);

/**
 * Build the inner `ActionsEnvelope` (the `next[]` + `fallback` block)
 * shared by both pre-commit and post-commit envelopes.
 */
function buildEnvelope(
  actionIds: readonly ActionId[],
  registry: ChannelRegistry,
  decorations?: DeriveDecorations,
): ActionsEnvelope {
  const next: NextAction[] = actionIds.map((id) => {
    const entry: NextAction = {
      id,
      channels: [...registry.channels],
    };
    const serverEndpoint = registry.endpoints?.[id];
    if (serverEndpoint !== undefined) {
      entry.endpoints = { server: serverEndpoint };
    }
    const deadline = decorations?.deadlines?.[id];
    if (deadline !== undefined) {
      entry.deadline = deadline;
    }
    return entry;
  });

  const envelope: ActionsEnvelope = { next };
  // Re-emit the fallback block only when at least one sub-field is set so
  // an empty `{}` doesn't leak onto the wire.
  if (
    registry.fallback.xmtp !== undefined ||
    registry.fallback.mcp !== undefined ||
    registry.fallback.onchainHints !== undefined
  ) {
    envelope.fallback = registry.fallback;
  }
  return envelope;
}

function toClientState(input: DeriveNextActionsInput): ClientState {
  if (input.exchangeState === ExchangeState.DISPUTED) {
    return { exchange: ExchangeState.DISPUTED, dispute: input.disputeState };
  }
  return { exchange: input.exchangeState };
}

/**
 * Build the initial 402 envelope — the `actions` block embedded in
 * `accepts[i]`. The legal transitions out of `PRE_COMMIT` are the two
 * commit-time actions (`boson-createOfferAndCommit`,
 * `boson-createOfferCommitAndRedeem`); both are populated here.
 *
 * Returns the bare `ActionsEnvelope` (no `exchangeId` / `exchangeState`)
 * since no exchange exists yet.
 */
export function deriveInitialNextActions(
  registry: ChannelRegistry,
  decorations?: DeriveDecorations,
): ActionsEnvelope {
  const actions = clientLegalActions(PRE_COMMIT);
  return buildEnvelope(actions, registry, decorations);
}

/**
 * Build the post-commit `nextActions` envelope for a given client state.
 * The returned shape carries `exchangeId`, `exchangeState`, and (iff
 * `exchangeState === DISPUTED`) `disputeState` so the buyer-side SDK
 * can reason about legal transitions without re-fetching the subgraph.
 */
export function deriveNextActions(
  input: DeriveNextActionsInput,
  registry: ChannelRegistry,
  decorations?: DeriveDecorations,
): EscrowNextActions {
  const actions = clientLegalActions(toClientState(input));
  const inner = buildEnvelope(actions, registry, decorations);

  if (input.exchangeState === ExchangeState.DISPUTED) {
    return {
      exchangeId: input.exchangeId,
      exchangeState: input.exchangeState,
      disputeState: input.disputeState,
      next: inner.next,
      ...(inner.fallback !== undefined ? { fallback: inner.fallback } : {}),
    };
  }
  return {
    exchangeId: input.exchangeId,
    exchangeState: input.exchangeState,
    next: inner.next,
    ...(inner.fallback !== undefined ? { fallback: inner.fallback } : {}),
  };
}
