// Channel registry — the per-seller configuration consumed by
// `deriveNextActions` to stamp each `ActionEntry` with the right
// channels, endpoints, and envelope-level fallback hints.
//
// Source of truth: docs/boson-impl-04-state-machine-and-next-actions.md
// §"Server-side derivation".

import type { ActionId } from "@bosonprotocol/x402-core/state-machine";

import type { Channel } from "../channels/index.js";

export {
  BUYER_ONCHAIN_FALLBACK,
  hasBuyerOnchainFallback,
  isBuyerOnchainResilient,
} from "./buyer-fallback.js";
export { buildChannelRegistry, channelRegistryZodSchema } from "./builder.js";

/**
 * Per-seller channel configuration.
 *
 * The fallback block on the wire is composed of three independent
 * sub-fields (`xmtp`, `mcp`, `onchainHints`). Each one is gated on a
 * separate piece of seller config; lifting them to the registry
 * top-level is more ergonomic than nesting a partial `ActionsFallback`
 * here, and lets `deriveNextActions` populate
 * `fallback.onchainHints.actionFacets` automatically from the action
 * ids it ends up emitting (so the seller doesn't have to maintain that
 * mapping by hand).
 *
 * - `channels` — the seller's preferred channel order. Clients are free
 *   to override based on their own policy (e.g. agentic clients may
 *   always prefer `onchain` or `mcp`); ordering on the wire is a hint,
 *   not a constraint.
 * - `endpoints` — per-action HTTP endpoint overrides for the `server`
 *   channel. Actions absent from this map have no `server` endpoint.
 * - `xmtp` — seller's XMTP address. Stamped into `fallback.xmtp`.
 * - `mcp` — identifier within the **escrow's** Boson MCP server
 *   (one shared `bosonprotocol/agentic-commerce` server across every
 *   Boson seller, not a per-seller MCP). Stamped into `fallback.mcp`;
 *   the BosonMCP routes the identifier to the right exchange.
 * - `escrow` — required Boson Diamond address.
 *   `deriveNextActions` populates the full `fallback.onchainHints`
 *   block (the meta-tx facet/entry-point constants plus the
 *   per-emitted-action facets) automatically.
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

  /** Seller's XMTP address. Stamped into `fallback.xmtp`. */
  xmtp?: string;

  /**
   * Identifier within the escrow's Boson MCP server (the
   * `bosonprotocol/agentic-commerce` MCP). Stamped into
   * `fallback.mcp`. The MCP server itself is escrow-level and shared
   * across every Boson seller; this value is the per-exchange routing
   * URI the BosonMCP resolves.
   */
  mcp?: string;

  /**
   * Boson Diamond address. The envelope's
   * `fallback.onchainHints` block is populated automatically from this
   * address plus the action ids the envelope advertises.
   */
  escrow: string;
}
