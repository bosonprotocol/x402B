// Public surface for `@bosonprotocol/x402-client`.
//
// MVP: ERC-3009 token-auth, server-channel submission only,
// `boson-createOfferAndCommit` action only. Signing routes through
// `CoreSDK.signMetaTxCreateOfferAndCommit` directly.

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
export { parseChainId } from "./core-sdk-factory.js";
export { parsePaymentResponse } from "./response.js";
export { createX402bClient, type X402bClient } from "./client.js";
export type { ResolveDisputeArgs, SignActionArgs, SimplePostCommitArgs } from "./post-commit.js";
