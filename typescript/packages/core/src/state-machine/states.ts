// Boson exchange + dispute states.
//
// The protocol uses two separate state machines: every exchange has an
// `ExchangeState` (CANCELLED / COMMITTED / COMPLETED / DISPUTED / REDEEMED
// / REVOKED), and a Dispute (created when the buyer calls `raiseDispute`)
// has its own `DisputeState` (RESOLVING / RESOLVED / ESCALATED / RETRACTED
// / DECIDED / REFUSED). Both enums are sourced verbatim from
// `@bosonprotocol/core-sdk`'s subgraph schema so this package stays in
// lock-step with the deployed protocol.
//
// Source of truth: docs/boson-impl-04-state-machine-and-next-actions.md.
// The diagram in that doc conflates the two for buyer-UX simplicity; here
// we keep them split to match the protocol.

import { subgraph } from "@bosonprotocol/core-sdk";

/** Exchange-level state. Re-exported from `@bosonprotocol/core-sdk`. */
export const ExchangeState = subgraph.ExchangeState;
export type ExchangeState = subgraph.ExchangeState;

/** Dispute-level state. Re-exported from `@bosonprotocol/core-sdk`. */
export const DisputeState = subgraph.DisputeState;
export type DisputeState = subgraph.DisputeState;

/**
 * Synthetic state for the implicit pre-exchange phase — the initial 402
 * response, before any exchange has been committed. Not part of the
 * on-chain enum; just lets the transition table treat the 402 uniformly
 * with post-commit responses when deriving `nextActions`.
 */
export const PRE_COMMIT = "PRE_COMMIT" as const;
export type PreCommit = typeof PRE_COMMIT;

/**
 * Composite state used to look up buyer-invokable actions.
 *
 *   - `PRE_COMMIT` — no exchange yet (the initial 402).
 *   - `{ exchange }` — exchange exists, no active dispute. Used for
 *     COMMITTED / REDEEMED / COMPLETED / CANCELLED / REVOKED.
 *   - `{ exchange: "DISPUTED", dispute }` — dispute is active; the
 *     `dispute` sub-state determines which actions are available.
 */
export type ClientState = PreCommit | { exchange: ExchangeState; dispute?: DisputeState };
