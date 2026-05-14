// Encoder for the `X-PAYMENT-RESPONSE` header. The base x402 spec uses
// base64-of-JSON for `X-PAYMENT-RESPONSE`, and the buyer SDK's
// `parsePaymentResponse` ([client/src/response.ts]) decodes it the
// same way. This helper is the inverse — give it the success body and
// it produces the header value.
//
// The header is best-effort metadata that lets the client read
// `exchangeId` (and any future scheme-specific fields) without parsing
// the full JSON body. We pass the body through verbatim so the wire
// shape is identical to the response body; consumers stay free to
// branch on either.

/**
 * Base64-encode the success-response body for the `X-PAYMENT-RESPONSE`
 * header. The companion decoder lives in
 * `@bosonprotocol/x402-client`'s `parsePaymentResponse`.
 */
export function encodeXPaymentResponse(body: unknown): string {
  const json = JSON.stringify(body);
  if (typeof Buffer !== "undefined") {
    return Buffer.from(json, "utf8").toString("base64");
  }
  // Node ships `Buffer`; the browser fallback exists for completeness so
  // a non-Node integrator (Workers, Deno) can reuse this helper.
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/** Canonical header name — exported so adapters share one spelling. */
export const X_PAYMENT_RESPONSE_HEADER = "X-PAYMENT-RESPONSE" as const;
