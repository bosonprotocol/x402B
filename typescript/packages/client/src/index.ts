// Public surface for `@bosonprotocol/x402-client`.
//
// MVP scaffold: configuration types, typed errors, signer interface, and
// the pure-function utilities the in-progress `handle402` entrypoint will
// compose (action picker, fulfillment resolver). Signing, the `CoreSDK`
// bridge, and the `handle402` entrypoint land in the next iteration.

export type {
  ExchangeSummary,
  FulfillmentConfig,
  Policy,
  RedeemMode,
  Signer,
  TokenDomainResolver,
  X402bClientConfig,
} from "./types.js";

export {
  FulfillmentValidationError,
  NoCompatibleActionError,
  NotImplementedError,
  UnsupportedSchemeError,
  UnsupportedTokenAuthError,
} from "./errors.js";

export { pickAction } from "./action.js";
export { resolveFulfillment, type ResolvedFulfillment } from "./fulfillment.js";
