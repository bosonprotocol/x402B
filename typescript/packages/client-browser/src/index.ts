// Public surface for `@bosonprotocol/x402-client-browser`.
//
// Re-exports the entire `@bosonprotocol/x402-client` API so a consumer
// installing just this package gets `createX402bClient`, error classes,
// types, and the two browser-oriented signer adapters in one import path.

export {
  signerFromWalletClient,
  type SignerFromWalletClientOptions,
  type WalletClientLike,
} from "./signer-from-wallet-client.js";
export {
  signerFromEip1193,
  type SignerFromEip1193Options,
  type Eip1193Provider,
} from "./signer-from-eip1193.js";
export * from "@bosonprotocol/x402-client";
