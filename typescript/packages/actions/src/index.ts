// Public API for @bosonprotocol/x402-actions.
//
// The root entry exposes the framework-level types, the channel
// registry constants, and the pure `deriveNextActions` /
// `deriveInitialNextActions` envelope builders. The thin
// `ChannelAdapter` contract is reached via `./channels`; the
// per-seller `ChannelRegistry` config type via `./registry`.

export type {
  ActionChannel,
  ActionEntry,
  ActionsEnvelope,
  ActionsFallback,
  EscrowNextActions,
  NextAction,
  NextActionsEnvelope,
  OnchainHints,
} from "./types.js";
export { DisputeState, ExchangeState } from "./types.js";

export type { Channel, ChannelAdapter } from "./channels/index.js";
export { CHANNEL_IDS } from "./channels/index.js";

export type { ChannelRegistry } from "./registry/index.js";

export type { DeriveDecorations, DeriveNextActionsInput } from "./derive.js";
export { deriveInitialNextActions, deriveNextActions } from "./derive.js";
