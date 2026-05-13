// `facilitator` subpath — HTTP client for the remote facilitator
// service. Wire types are re-exported from
// `@bosonprotocol/x402-facilitator` so client + server stay in
// lock-step without a separate type-only sub-package.

export {
  createFacilitatorClient,
  type CreateFacilitatorClientOptions,
  type FacilitatorClient,
  type FetchLike,
} from "./client.js";
export { FacilitatorHttpError, type FacilitatorHttpErrorCode } from "./errors.js";

// Re-export the wire types so consumers don't need a separate
// `@bosonprotocol/x402-facilitator` import just to type a request
// shape against the client.
export type {
  FacilitatorErrorCode,
  FacilitatorPerformActionInput,
  FacilitatorPerformActionResult,
  FacilitatorSettleInput,
  FacilitatorSettleResult,
  FacilitatorVerifyInput,
  FacilitatorVerifyResult,
} from "@bosonprotocol/x402-facilitator";
