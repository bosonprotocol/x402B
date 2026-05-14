// `validate` subpath — pure X-PAYMENT validation. No I/O; cross-field
// rules (sig recovery, structural rules, fulfillment delegation)
// short-circuit on the first failure with a structured error code
// callers can serialise into a 400 body.

export { decodeXPaymentHeader, type DecodeErrorCode, type DecodeXPaymentResult } from "./decode.js";
export {
  validatePaymentPayload,
  type ValidatePaymentPayloadArgs,
  type ValidatePaymentPayloadResult,
  type ValidationErrorCode,
  type ValidationWarning,
} from "./payment-payload.js";
