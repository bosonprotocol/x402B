// `nextActions` envelope types for the actions package.
//
// Source of truth: docs/boson-impl-04-state-machine-and-next-actions.md
// §"`nextActions` envelope".
//
// All wire-format types live in `@bosonprotocol/x402-core/schemes/escrow`
// next to the JSON Schema and zod validators that ship with them. This
// module is a thin alias layer: `ActionEntry` is `NextAction` (the
// id+channels+endpoints+deadline tuple) renamed for ergonomic short
// usage, and `NextActionsEnvelope` is the union of the pre-commit
// (initial 402) and post-commit (`EscrowNextActions`) shapes — useful
// when a function may return either, e.g. a server-SDK helper that
// dispatches the same builder for the 402 and post-redeem responses.

import type {
  ActionsEnvelope,
  EscrowNextActions,
  NextAction,
} from "@bosonprotocol/x402-core/schemes/escrow";

export type {
  ActionChannel,
  ActionsEnvelope,
  ActionsFallback,
  EscrowNextActions,
  NextAction,
  OnchainHints,
} from "@bosonprotocol/x402-core/schemes/escrow";
export type { DisputeState, ExchangeState } from "@bosonprotocol/x402-core/state-machine";

/**
 * Single entry in the `next[]` array of a `nextActions` envelope. Alias
 * of `NextAction` from `@bosonprotocol/x402-core/schemes/escrow` —
 * carries `id`, `channels`, optional `endpoints`, and optional ISO 8601
 * `deadline`.
 */
export type ActionEntry = NextAction;

/**
 * Top-level `nextActions` envelope returned in every server response.
 *
 * - **Pre-commit** (initial 402): the base `ActionsEnvelope` (no
 *   `exchangeId` / `state` / `disputeState`). Nested inside
 *   `accepts[i].actions` on the 402 response.
 * - **Post-commit**: the richer `EscrowNextActions` (with
 *   `exchangeId`, `state`, and — when `state === DISPUTED` —
 *   `disputeState`). Returned at the top level of every subsequent
 *   response.
 */
export type NextActionsEnvelope = ActionsEnvelope | EscrowNextActions;
