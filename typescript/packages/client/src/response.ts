// Parse the optional `X-PAYMENT-RESPONSE` header the server may emit after
// settling.
//
// The escrow-scheme spec doesn't pin a strict contract for this header yet,
// so the parser is permissive: base64-decode the value, JSON-parse it, and
// return `{ raw }`. Best-effort lifting picks `exchangeId` / `state` from
// the common property paths an x402B server might use. Callers who need
// stronger guarantees can read `raw` directly.

import type { ExchangeSummary } from "./types.js";

const HEADER_NAME = "X-PAYMENT-RESPONSE";

/** Read a header value from anything that exposes `.get(name)`. */
interface HeaderLike {
  get(name: string): string | null;
}

interface ResponseLike {
  headers: HeaderLike;
}

/**
 * Decode the `X-PAYMENT-RESPONSE` header on a Response-like object. Returns
 * `undefined` when the header isn't set; throws on a malformed payload.
 */
export function parsePaymentResponse(response: ResponseLike): ExchangeSummary | undefined {
  const raw = response.headers.get(HEADER_NAME);
  if (!raw) {
    return undefined;
  }

  const json = decodeBase64(raw);
  const parsed: unknown = JSON.parse(json);
  const summary: ExchangeSummary = { raw: parsed };

  // Only walk into the payload when it's actually a plain record. A valid
  // JSON value can be `null`, an array, or a primitive — touching keys on
  // those would crash, defeating the file-header permissive promise.
  if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
    const obj = parsed as Record<string, unknown>;

    const exchangeId = pickString(obj, ["exchangeId", "exchange_id"]);
    if (exchangeId !== undefined) {
      summary.exchangeId = exchangeId;
    }

    if (isClientStateShape(obj.state)) {
      summary.state = obj.state;
    }

    // Fallback for the server-emitted shape, which carries exchange state
    // under `nextActions.exchangeState` (and optionally `disputeState`)
    // rather than a top-level `state` field. The top-level lookup above
    // still wins when present, preserving forward-compat with external
    // servers that publish the flatter shape.
    if (
      summary.state === undefined &&
      typeof obj.nextActions === "object" &&
      obj.nextActions !== null &&
      !Array.isArray(obj.nextActions)
    ) {
      const na = obj.nextActions as Record<string, unknown>;
      const exchange = pickString(na, ["exchangeState"]);
      const dispute = pickString(na, ["disputeState"]);
      if (exchange !== undefined) {
        let candidate: unknown;
        if (exchange === "DISPUTED") {
          candidate = dispute !== undefined ? { exchange, dispute } : undefined;
        } else {
          candidate = { exchange };
        }
        if (isClientStateShape(candidate)) {
          summary.state = candidate;
        }
      }
    }
  }

  return summary;
}

/**
 * Shape gate for `state` arriving from the permissive server header. We
 * keep the file-header promise of permissiveness — `ClientState` is
 * `"PRE_COMMIT"` or an `{ exchange, dispute? }` record today, but the
 * wire contract isn't pinned, so any non-empty string (e.g. raw
 * `ExchangeState` value) or non-array `{ exchange }`-shaped record is
 * surfaced verbatim. Numbers, booleans, `null`, empty strings, arrays,
 * and records missing a string `exchange` field are rejected so garbage
 * payloads can't masquerade as a typed `ClientState`.
 */
function isClientStateShape(v: unknown): v is NonNullable<ExchangeSummary["state"]> {
  if (typeof v === "string") return v.length > 0;
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const rec = v as Record<string, unknown>;
  if (typeof rec.exchange !== "string" || rec.exchange.length === 0) return false;
  if ("dispute" in rec && rec.dispute !== undefined && typeof rec.dispute !== "string") {
    return false;
  }
  return true;
}

function decodeBase64(value: string): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(value, "base64").toString("utf8");
  }
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

function pickString(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const v = obj[key];
    if (typeof v === "string" && v.length > 0) {
      return v;
    }
  }
  return undefined;
}
