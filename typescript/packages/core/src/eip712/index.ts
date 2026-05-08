// Public surface for the Boson EIP-712 typed-data builders.
//
//   - `MetaTransaction(...)` typed-data builder + hash + signer recovery.
//     Same typed-data is consumed by both the existing
//     `executeMetaTransaction` Boson entrypoint and the BPIP-12
//     `executeMetaTransactionWithTokenTransferAuthorization` entrypoint.
//   - `FullOffer` (BPIP-10) typed-data builder + hash + signer recovery.
//
// Both builders delegate the EIP-712 type definitions and the (non-standard,
// salt-based) Boson domain construction to `@bosonprotocol/core-sdk` so we
// stay in lock-step with what the deployed protocol actually verifies on-chain.

export * from "./meta-transaction.js";
export * from "./full-offer.js";
