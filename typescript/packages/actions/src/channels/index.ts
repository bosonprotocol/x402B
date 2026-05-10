// Channel registry — the stable set of transports through which a
// buyer (or seller) can invoke a `nextAction`.
//
// Source of truth: docs/boson-impl-04-state-machine-and-next-actions.md
// §"Channels".
//
// The actual `ActionChannel` union and `ACTION_CHANNELS` tuple live in
// `@bosonprotocol/x402-core/schemes/escrow` so the JSON Schema can
// reference the same source. This module re-exports them under
// `Channel` / `CHANNEL_IDS` for ergonomic short names, and defines the
// thin `ChannelAdapter` interface that consumer packages
// (`x402-server`, `x402-client`, `x402-facilitator`, ...) implement to
// describe and dispatch a single channel.

import type { ActionChannel } from "@bosonprotocol/x402-core/schemes/escrow";
import { ACTION_CHANNELS } from "@bosonprotocol/x402-core/schemes/escrow";

import type { ActionId } from "@bosonprotocol/x402-core/state-machine";

/** A transport for invoking a `nextAction`. Re-export of `ActionChannel`. */
export type Channel = ActionChannel;

/**
 * Stable registry of channel ids in the order they are typically listed
 * in `next[i].channels[]`. Re-export of `ACTION_CHANNELS` under a
 * shorter name. Iterate this when you need to enumerate channels (e.g.
 * to validate a seller's advertised set against the registry).
 */
export const CHANNEL_IDS: readonly Channel[] = ACTION_CHANNELS;

/**
 * Pluggable channel adapter.
 *
 * One adapter per channel id; the server SDK looks adapters up by
 * `channel`, calls `describe(action, cfg)` to populate the
 * `endpoints` (and any other channel-specific metadata) for each
 * action entry the server is willing to expose, and returns
 * `undefined` for any (action, channel) pair the seller does not want
 * to advertise.
 *
 * `TConfig` is the channel-specific server configuration — e.g. a base
 * URL for the `server` channel, the facilitator URL for `facilitator`,
 * the seller's XMTP address for `xmtp`, the MCP tool identifier for
 * `mcp`. The base type is `unknown` so consumers can refine.
 */
export interface ChannelAdapter<TConfig = unknown> {
  /** Channel id this adapter handles. */
  readonly channel: Channel;

  /**
   * Build the wire-format hint for a single action under this channel.
   * Return `undefined` if the seller does not expose this action via
   * this channel.
   *
   * - `endpoint` populates `next[i].endpoints[<channel>]`.
   * - `deadline` is an ISO 8601 absolute timestamp; usually only the
   *   `onchain` channel carries one (computed from the dispute or
   *   redemption window). When multiple adapters return a `deadline`
   *   for the same action, the envelope builder takes the earliest.
   */
  describe(
    action: ActionId,
    cfg: TConfig,
  ):
    | {
        endpoint?: string;
        deadline?: string;
      }
    | undefined;
}
