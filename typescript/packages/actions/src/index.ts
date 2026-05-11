// Public API for @bosonprotocol/x402-actions.
//
// The root entry exposes the framework-level types and the channel
// registry constants. The thin `ChannelAdapter` contract is reached via
// `./channels`; the per-seller `ChannelRegistry` config type via
// `./registry`. The `deriveNextActions` envelope builder lands in a
// follow-up PR.

export type {
  ActionChannel,
  ActionEntry,
  ActionsEnvelope,
  ActionsFallback,
  NextAction,
  NextActionsEnvelope,
  OnchainHints,
} from "./types.js";
export { DisputeState, ExchangeState } from "./types.js";

export type { Channel, ChannelAdapter } from "./channels/index.js";
export { CHANNEL_IDS } from "./channels/index.js";

export type { ChannelRegistry } from "./registry/index.js";
