// Decode the `X-PAYMENT` header — base64 → JSON → zod-parse.
//
// `parseEscrowPaymentPayload` from `@bosonprotocol/x402-core` handles
// the wire-format zod validation; this module's job is the base64 +
// JSON layer plus the obvious "not a string" / "bad base64" / "bad
// JSON" failure cases, each mapped to a structured error code so the
// caller can surface a useful 400 to the buyer.

import {
  parseEscrowPaymentPayload,
  type EscrowPaymentPayload,
} from "@bosonprotocol/x402-core/schemes/escrow";

export type DecodeXPaymentResult =
  | { ok: true; payload: EscrowPaymentPayload }
  | { ok: false; code: DecodeErrorCode; reason: string };

export type DecodeErrorCode =
  | "MISSING_HEADER"
  | "INVALID_BASE64"
  | "INVALID_JSON"
  | "INVALID_PAYLOAD";

/**
 * Decode the raw `X-PAYMENT` header value. Returns the parsed
 * `EscrowPaymentPayload` on success or a `{ ok: false }` discriminated
 * error on failure. Accepts both base64 and base64url variants (RFC
 * 4648 §5) — buyers in the wild use both.
 */
export function decodeXPaymentHeader(header: string | undefined | null): DecodeXPaymentResult {
  if (header === undefined || header === null || header.length === 0) {
    return { ok: false, code: "MISSING_HEADER", reason: "X-PAYMENT header is missing" };
  }

  // base64url → base64 (RFC 4648 §5) then decode. We prefer `atob` so
  // the validator stays edge-runtime compatible; `atob` returns a
  // Latin-1 binary string though, so we re-encode through `TextDecoder`
  // to recover the original UTF-8 (offer metadata and other inner
  // fields can carry non-ASCII bytes).
  const padded = base64UrlToBase64(header);
  let decoded: string;
  try {
    if (typeof atob === "function") {
      const binary = atob(padded);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      decoded = new TextDecoder().decode(bytes);
    } else {
      decoded = Buffer.from(padded, "base64").toString("utf8");
    }
  } catch (e) {
    return { ok: false, code: "INVALID_BASE64", reason: (e as Error).message };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(decoded);
  } catch (e) {
    return { ok: false, code: "INVALID_JSON", reason: (e as Error).message };
  }

  try {
    const payload = parseEscrowPaymentPayload(parsed);
    return { ok: true, payload };
  } catch (e) {
    return { ok: false, code: "INVALID_PAYLOAD", reason: (e as Error).message };
  }
}

function base64UrlToBase64(input: string): string {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  return normalized + padding;
}
