// Public root surface for `@bosonprotocol/x402-facilitator`.
//
// Three async library functions mirror the three HTTP endpoints from
// docs/boson-impl-07-facilitator.md (`verify`, `settle`, `performAction`),
// plus a `ChannelAdapter` implementation for the `"facilitator"` channel.
//
// Prefer the subpath exports (`./verify`, `./settle`, `./perform-action`,
// `./channels/facilitator`) when tree-shaking matters — this barrel is a
// convenience superset.

export * from "./types.js";
export * from "./errors.js";

export { verify } from "./verify/index.js";
export { settle } from "./settle/index.js";
export { performAction } from "./perform-action/index.js";
// Codec lives in `@bosonprotocol/x402-evm/codec` so client and facilitator
// share one implementation. Re-exported here for backward compatibility
// with existing facilitator consumers that import it from the barrel.
export { decodeSignedPayload, encodeSignedPayload } from "@bosonprotocol/x402-evm/codec";

export {
  FacilitatorChannelAdapter,
  type FacilitatorChannelConfig,
} from "./channels/facilitator/index.js";
