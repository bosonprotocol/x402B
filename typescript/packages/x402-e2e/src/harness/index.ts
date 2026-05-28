// Public surface of the harness. Scenario tests (PR 6) import every
// actor / asserter / seed helper from this barrel.

export { buildPublicClient, buildWalletClient, localBosonChain } from "./clients.js";
export {
  createSubgraphExchangeReader,
  withPollUntilFound,
  type SubgraphExchangeReaderArgs,
  type WithPollUntilFoundOptions,
} from "./exchange-reader.js";

export { createBuyerActor, type BuyerActor, type BuyerActorArgs } from "./buyer-actor.js";
export { createChainTokenDomainResolver } from "./token-domain.js";
export { createSellerActor, type SellerActor, type SellerActorArgs } from "./seller-actor.js";
export {
  createResolverActor,
  type ResolverActor,
  type ResolverActorArgs,
} from "./resolver-actor.js";

export {
  createOnchainAsserter,
  type OnchainAsserter,
  type ExpectStateArgs,
} from "./onchain-asserter.js";
export {
  decodeXPaymentResponse,
  readXPaymentResponse,
  X_PAYMENT_RESPONSE_HEADER,
  type DecodedXPaymentResponse,
} from "./x-payment-response-asserter.js";

export { seedSuite, type SeedArgs, type SeededSeller, type SuiteState } from "./seed.js";
export { buildCreateSellerCallback, type BuildCreateSellerCallbackArgs } from "./create-seller.js";

export {
  performBuyerPostCommitAction,
  PostCommitActionError,
  type BuyerPostCommitActionId,
  type PerformBuyerPostCommitActionArgs,
  type PostCommitActionResult,
} from "./post-commit-http.js";

export {
  performCancelVoucher,
  FacilitatorPerformError,
  type CancelVoucherArgs,
  type FacilitatorOnlyActionId,
  type FacilitatorPerformResult,
} from "./facilitator-perform-action.js";

export {
  buildValidCommitHeader,
  decodePaymentHeader,
  encodePaymentHeader,
  fetchEscrowChallenge,
  submitMutatedCommit,
  submitPaymentHeader,
  verifyViaFacilitator,
  type CraftedSubmission,
  type SubmissionBody,
  type SubmitMutatedCommitArgs,
  type VerifyViaFacilitatorArgs,
} from "./craft-payment.js";
