// `XPaymentResponseAsserter` — decodes the `X-PAYMENT-RESPONSE` header
// the resource server stamps on successful commit responses and
// surfaces its payload to scenario assertions.
//
// Wire format: base64-encoded JSON of the commit handler's `body`
// (typically `{ exchangeId, txHash, nextActions }`). Decoder is the
// inverse of `encodeXPaymentResponse` from
// `@bosonprotocol/x402-server/src/internal/x-payment-response.ts`.

import type { DisputeState, ExchangeState } from "@bosonprotocol/x402-actions";
import { X_PAYMENT_RESPONSE_HEADER } from "@bosonprotocol/x402-server";

export { X_PAYMENT_RESPONSE_HEADER };

/**
 * Decode the `X-PAYMENT-RESPONSE` header value into the original JSON
 * payload. Returns `null` when the header is absent or malformed, so
 * callers can assert successful decoding with
 * `expect(decode(...)).not.toBeNull()`.
 */
export function decodeXPaymentResponse(headerValue: string | null | undefined): unknown {
  if (headerValue === null || headerValue === undefined || headerValue.length === 0) {
    return null;
  }
  let json: string;
  try {
    if (typeof Buffer !== "undefined") {
      json = Buffer.from(headerValue, "base64").toString("utf8");
    } else {
      const binary = atob(headerValue);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      json = new TextDecoder().decode(bytes);
    }
  } catch {
    return null;
  }
  try {
    return JSON.parse(json) as unknown;
  } catch {
    return null;
  }
}

/** Narrowed view of the decoded payload — only the fields scenario tests pin against. */
export interface DecodedXPaymentResponse {
  exchangeId?: string;
  txHash?: `0x${string}`;
  nextActions?: {
    next?: readonly {
      id: string;
      channels: readonly string[];
      endpoints?: Record<string, string>;
    }[];
    exchangeId?: string;
    // `ExchangeState` / `DisputeState` are string enums in core-sdk's
    // subgraph schema (`COMMITTED = "COMMITTED"`, …), so the wire values
    // are strings — compare against `ExchangeState.*` / `DisputeState.*`
    // directly.
    exchangeState?: ExchangeState;
    disputeState?: DisputeState;
  };
}

/**
 * Read + decode the `X-PAYMENT-RESPONSE` header from a `Response` /
 * supertest `Test` shape. Returns the typed payload so scenario tests
 * can `expect(decoded.nextActions?.next?.[0].id).toBe(...)` directly.
 */
export function readXPaymentResponse(
  headers:
    | { get?: (name: string) => string | null }
    | Record<string, string | string[] | undefined>,
): DecodedXPaymentResponse | null {
  const headerValue =
    typeof (headers as { get?: unknown }).get === "function"
      ? (headers as { get: (name: string) => string | null }).get(X_PAYMENT_RESPONSE_HEADER)
      : (() => {
          const lower = X_PAYMENT_RESPONSE_HEADER.toLowerCase();
          const map = headers as Record<string, string | string[] | undefined>;
          const lowered: Record<string, string | string[] | undefined> = {};
          for (const key of Object.keys(map)) lowered[key.toLowerCase()] = map[key];
          const v = lowered[lower];
          return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
        })();

  const decoded = decodeXPaymentResponse(headerValue);
  if (decoded === null || typeof decoded !== "object") return null;
  return decoded as DecodedXPaymentResponse;
}
