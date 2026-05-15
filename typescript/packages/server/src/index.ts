// Public API for `@bosonprotocol/x402-server`.
//
// v0.1 — request-side primitives only: 402 challenge builder, seller
// FullOffer signer, and a `createX402bServer` factory that binds them
// to a shared `X402bServerConfig`. The `X-PAYMENT` validator,
// facilitator HTTP client, and convenience-endpoint handlers land in
// follow-up PRs and slot onto the same factory output.

export { createX402bServer, type BuildRequirementsInput, type X402bServer } from "./server.js";
export {
  assertChannelRegistryEscrowMatch,
  x402bServerConfigSchema,
  type RedeemFulfillmentChannel,
  type SellerSigner,
  type X402bServerConfig,
} from "./config.js";
export {
  buildPaymentRequirements,
  signFullOffer,
  type BuildPaymentRequirementsArgs,
  type SignFullOfferArgs,
} from "./challenge/index.js";
export {
  decodeXPaymentHeader,
  validatePaymentPayload,
  type DecodeErrorCode,
  type DecodeXPaymentResult,
  type ValidatePaymentPayloadArgs,
  type ValidatePaymentPayloadResult,
  type ValidationErrorCode,
  type ValidationWarning,
} from "./validate/index.js";
export {
  createFacilitatorClient,
  FacilitatorHttpError,
  type CreateFacilitatorClientOptions,
  type FacilitatorClient,
  type FacilitatorErrorCode,
  type FacilitatorHttpErrorCode,
  type FacilitatorPerformActionInput,
  type FacilitatorPerformActionResult,
  type FacilitatorSettleInput,
  type FacilitatorSettleResult,
  type FacilitatorVerifyInput,
  type FacilitatorVerifyResult,
  type FetchLike,
} from "./facilitator/index.js";
export {
  emitNextActions,
  handleCommit,
  handleCommitAndRedeem,
  handleComplete,
  handleDisputeEscalate,
  handleDisputeRaise,
  handleDisputeResolve,
  handleDisputeRetract,
  handlePerformAction,
  handleRedeem,
  handlerErr,
  handlerOk,
  type CommitHandlerContext,
  type CommitHandlerInput,
  type CommitOk,
  type EmitNextActionsInput,
  type HandlerErrorBody,
  type HandlerResult,
  type HandlerStatus,
  type PerformActionContext,
  type PerformActionInput,
  type PerformActionOk,
  type RedeemHandlerContext,
  type RedeemHandlerInput,
} from "./handlers/index.js";
export {
  verifyExchange,
  verifyExchangeSnapshot,
  type ExchangeReader,
  type ExchangeSnapshot,
  type VerifyExchangeErrorCode,
  type VerifyExchangeExpected,
  type VerifyExchangeOptions,
  type VerifyExchangeResult,
} from "./onchain/index.js";
export {
  encodeXPaymentResponse,
  X_PAYMENT_RESPONSE_HEADER,
} from "./internal/x-payment-response.js";
