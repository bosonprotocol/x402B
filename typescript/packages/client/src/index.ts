// Public surface for `@bosonprotocol/x402-client`.
//
// MVP: ERC-3009 token-auth and server-channel submission only. The
// commit-time `boson-createOfferAndCommit` action is signed via
// `CoreSDK.signMetaTxCreateOfferAndCommit` inside `handle402`; buyer-side
// post-commit transitions (`boson-redeem`, `boson-cancelVoucher`,
// `boson-completeExchange`, and the dispute family — `raiseDispute`,
// `retractDispute`, `escalateDispute`, `resolveDispute`) are signed via
// the matching `CoreSDK.signMetaTx*` mixin behind `client.signAction`.

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
  MaxAmountExceededError,
  NoCompatibleActionError,
  UnsupportedSchemeError,
  UnsupportedTokenAuthError,
} from "./errors.js";

export { pickAction } from "./action.js";
export { resolveFulfillment, type ResolvedFulfillment } from "./fulfillment.js";
export { parseChainId } from "./core-sdk-factory.js";
export { parsePaymentResponse } from "./response.js";
export { createX402bClient, type X402bClient } from "./client.js";
export type {
  ResolveDisputeArgs,
  SignActionArgs,
  SignedPostCommitAction,
  SimplePostCommitArgs,
} from "./post-commit.js";
export { signerFromEthersAdapter, type Web3LibAdapterLike } from "./signer-from-adapter.js";
