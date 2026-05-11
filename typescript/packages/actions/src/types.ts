// `nextActions` envelope types — the wire-format shape returned at the
// top level of every server response (and nested in `accepts[i].actions`
// on the initial 402 where there is no exchange yet).
//
// Source of truth: docs/boson-impl-04-state-machine-and-next-actions.md
// §"`nextActions` envelope".
//
// The base wire-format types (`NextAction`, `OnchainHints`,
// `ActionsFallback`, `ActionsEnvelope`, `ActionChannel`) live in
// `@bosonprotocol/x402-core/schemes/escrow` so the JSON-Schema validators
// in core can reference them. This package adds the **execution-layer**
// pieces those base types omit: an absolute `deadline` on each action
// entry, and the post-commit envelope variant that carries the current
// `(exchangeId, state, disputeState)` tuple.

import type { ActionsFallback, NextAction } from "@bosonprotocol/x402-core/schemes/escrow";
import {
  DisputeState,
  ExchangeState,
  type DisputeState as DisputeStateType,
  type ExchangeState as ExchangeStateType,
} from "@bosonprotocol/x402-core/state-machine";

export type {
  ActionChannel,
  ActionsEnvelope,
  ActionsFallback,
  NextAction,
  OnchainHints,
} from "@bosonprotocol/x402-core/schemes/escrow";
export { DisputeState, ExchangeState };

/**
 * Single entry in the `next[]` array of a `nextActions` envelope.
 *
 * Extends the base `NextAction` (id, channels, endpoints) with an
 * optional absolute `deadline` the buyer must act by — relevant for
 * dispute-window-bounded actions like `boson-resolveDispute`,
 * `boson-escalateDispute`, and `boson-retractDispute`.
 *
 * Note: as of v0.1 the JSON Schema in
 * `@bosonprotocol/x402-core/schemas/payment_requirements.schema.json`
 * does not yet enumerate `deadline` on `actions.next[]` items — that
 * schema only covers the initial-402 envelope, where deadlines don't
 * apply. Adding `deadline` to the schema (and a separate post-commit
 * envelope schema) is tracked for a follow-up PR alongside the
 * `deriveNextActions` implementation.
 */
export interface ActionEntry extends NextAction {
  /** ISO 8601 absolute timestamp by which the action must be invoked. */
  deadline?: string;
}

/**
 * Discriminator for the post-commit shape of a `NextActionsEnvelope`.
 * Encodes the spec invariant that `state === "DISPUTED"` ↔
 * `disputeState` is present, without any runtime check.
 */
type ExchangeStatePair =
  | { state: Exclude<ExchangeStateType, typeof ExchangeState.DISPUTED>; disputeState?: never }
  | { state: typeof ExchangeState.DISPUTED; disputeState: DisputeStateType };

/**
 * Top-level `nextActions` envelope returned in every server response.
 *
 * Two shapes:
 *
 * - **Pre-commit** (initial 402): no `exchangeId` / `state` /
 *   `disputeState` — the exchange doesn't exist yet. This is the shape
 *   nested inside `accepts[i].actions` on the 402 response.
 * - **Post-commit** (every subsequent response): carries the current
 *   `(exchangeId, state[, disputeState])` so clients can reason about
 *   the legal transitions without re-fetching the subgraph.
 */
export type NextActionsEnvelope = {
  next: ActionEntry[];
  fallback?: ActionsFallback;
} & (
  | { exchangeId?: never; state?: never; disputeState?: never }
  | ({ exchangeId: string } & ExchangeStatePair)
);
