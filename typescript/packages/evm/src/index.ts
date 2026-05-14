// Public root surface for `@bosonprotocol/x402-evm`.
//
// EVM-side calldata builders specific to the x402B `escrow` scheme.
// Prefer the subpath exports (`./actions`, `./envelope`) when consuming
// — this barrel is a convenience superset.
//
// Anything *not* exposed here (meta-tx signing of post-commit actions,
// direct on-chain calldata for `redeemVoucher` / `completeExchange` /
// dispute handlers, etc.) is already covered by
// `@bosonprotocol/core-sdk` — see this package's README for the
// recommended call patterns.

export * from "./errors.js";
export type { InnerActionCalldata, TxRequest } from "./types.js";

export * from "./actions/index.js";
export * from "./codec/index.js";
export * from "./envelope/index.js";
