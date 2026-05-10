// Channel registry — the per-seller configuration consumed by
// `deriveNextActions` (PR follow-up) to stamp each `ActionEntry` with
// the right channels, endpoints, and fallback hints.
//
// Source of truth: docs/boson-impl-04-state-machine-and-next-actions.md
// §"Server-side derivation". The actual `deriveNextActions` function
// lands in a follow-up PR; this module ships only the configuration
// type so the server SDK can begin to type against it.

import type { ActionsFallback } from "@bosonprotocol/x402-core/schemes/escrow";
import type { ActionId } from "@bosonprotocol/x402-core/state-machine";

import type { Channel } from "../channels/index.js";

/**
 * Per-seller channel configuration. Passed to `deriveNextActions` (PR
 * follow-up) which uses it to stamp each `ActionEntry`:
 *
 * - `channels` — the seller's preferred channel order. Clients are
 *   free to override based on their own policy (e.g. agentic clients
 *   may always prefer `onchain` or `mcp`); ordering on the wire is a
 *   *hint*, not a constraint.
 * - `endpoints` — per-action HTTP endpoint overrides for the `server`
 *   channel. Actions absent from this map have no `server` endpoint.
 * - `fallback` — the `xmtp` / `mcp` / `onchainHints` block that ends
 *   up at `nextActions.fallback`. Always present even when only some
 *   sub-fields are populated, so clients can rely on its shape.
 */
export interface ChannelRegistry {
  /** The seller's preferred channel order. */
  channels: readonly Channel[];

  /**
   * HTTP endpoint overrides for the `server` channel, keyed by action
   * id. An action absent from this map will not advertise a `server`
   * channel even if `server` is listed in `channels`.
   */
  endpoints?: Partial<Record<ActionId, string>>;

  /** Fallback hints embedded in the envelope's `fallback` field. */
  fallback: ActionsFallback;
}
