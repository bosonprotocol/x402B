// Public root surface for `@bosonprotocol/x402-evm`.
//
// EVM-side calldata builders + viem ↔ Web3LibAdapter bridges specific to
// the x402B `escrow` scheme. Prefer the subpath exports
// (`./actions`, `./codec`, `./adapters`) when consuming — this barrel is
// a convenience superset.
//
// The outer meta-tx envelope (`executeMetaTransaction` /
// `executeMetaTransactionWithTokenTransferAuthorization`) is no longer
// hand-rolled here: facilitator-style flows submit through
// `@bosonprotocol/core-sdk`'s `coreSdk.executeMetaTransaction(...)` via
// the relayer adapter exposed under `./adapters`.
//
// Anything *not* exposed here (meta-tx signing of post-commit actions,
// direct on-chain calldata for `redeemVoucher` / `completeExchange` /
// dispute handlers, etc.) is already covered by
// `@bosonprotocol/core-sdk` — see this package's README for the
// recommended call patterns.

export type { InnerActionCalldata, TxRequest } from "./types.js";

export * from "./actions/index.js";
export * from "./codec/index.js";
export * from "./adapters/index.js";
