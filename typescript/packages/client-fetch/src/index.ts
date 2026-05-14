// Public surface for `@bosonprotocol/x402-client-fetch`.
//
// Re-exports the entire `@bosonprotocol/x402-client` API so a consumer
// installing just this package gets `createX402bClient`, error classes,
// types, and the fetch wrapper in one import path.

export { wrapFetchWithPayment } from "./wrap.js";
export * from "@bosonprotocol/x402-client";
