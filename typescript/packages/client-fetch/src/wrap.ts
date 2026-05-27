// `wrapFetchWithPayment` — turns a `fetch` implementation into one that
// transparently settles `402 Payment Required` responses carrying
// `scheme: "escrow"`.
//
// Behaviour mirrors upstream `x402-fetch`:
//
//  1. Run the original request.
//  2. If the response is not `402` → return as-is.
//  3. Try to parse the body as JSON and look for an `accepts[]` entry with
//     `scheme === "escrow"`. If none is present — e.g. the server only
//     advertises other x402 schemes — the original 402 is returned
//     unchanged so a non-Boson client further up the stack can still try
//     them (or surface the structured error).
//  4. Delegate the matched escrow PaymentRequirements to
//     `client.handle402(...)` which produces the base64 `X-PAYMENT`
//     header value.
//  5. Re-issue the original URL with the new header set; pass through
//     method, body, and every other init field.
//  6. Return the retry response. A second `402` is NOT re-retried — the
//     server has spoken twice, surface the error.
//
// Each wrapper invocation is tagged with a fresh
// `X-X402-Boson-Session-Id` header on BOTH the initial request and the
// retry. The example resource server uses this id to scope its
// `FullOffer` cache: the 402 challenge and the X-PAYMENT retry share
// one offer (the validator deep-equals `payload.offerRef.fullOffer`
// against `requirements.offer.fullOffer`), while distinct buyer flows
// see distinct offers so a single-quantity offer isn't served to two
// commits in a row.

import { SESSION_ID_HEADER } from "@bosonprotocol/x402-core";
import { findEscrowAccept } from "@bosonprotocol/x402-core/schemes/escrow";
import type { X402bClient } from "@bosonprotocol/x402-client";

// Re-exported below so existing `@bosonprotocol/x402-client-fetch`
// importers keep working without having to add a direct dep on
// `@bosonprotocol/x402-core`.
export { SESSION_ID_HEADER };

const X_PAYMENT_HEADER = "X-PAYMENT";

function newSessionId(): string {
  // `globalThis.crypto.randomUUID()` works in modern browsers and Node 19+
  // (the engines this repo targets). No `node:crypto` import keeps the
  // module isomorphic — browser bundlers don't need a node polyfill.
  return globalThis.crypto.randomUUID();
}

/**
 * Wrap a `fetch` implementation so 402 responses carrying the Boson
 * `escrow` scheme get signed and retried automatically. Non-402 responses
 * and 402s without an `escrow` accept entry are passed through unchanged.
 */
export function wrapFetchWithPayment(
  originalFetch: typeof fetch,
  client: X402bClient,
): typeof fetch {
  return async function fetchWithPayment(input, init) {
    const initialRequest = new Request(input, init);
    // Stamp a fresh session id on this buyer flow's headers so the
    // resource server's offer cache scopes the 402 challenge and the
    // X-PAYMENT retry to the same offer. `Headers.set` mutates the
    // Request's headers in place; the `clone()` below carries the id
    // onto `retryBase`.
    initialRequest.headers.set(SESSION_ID_HEADER, newSessionId());
    const retryBase = initialRequest.clone();

    const initial = await originalFetch(initialRequest);
    if (initial.status !== 402) {
      return initial;
    }

    const escrowEntry = await extractEscrowEntry(initial);
    if (!escrowEntry) {
      return initial;
    }

    const headerValue = await client.handle402(escrowEntry);

    const headers = new Headers(retryBase.headers);
    headers.set(X_PAYMENT_HEADER, headerValue);
    const retryRequest = new Request(retryBase, { headers });

    return originalFetch(retryRequest);
  };
}

/**
 * Best-effort decode of the 402 body. Returns the first `accepts[]` entry
 * with `scheme === "escrow"`, or `undefined` when the body isn't JSON, has
 * no `accepts[]`, or carries only other schemes. Reads from a clone so the
 * caller can still consume the original response if we hand it back.
 */
async function extractEscrowEntry(response: Response): Promise<unknown | undefined> {
  let body: unknown;
  try {
    body = await response.clone().json();
  } catch {
    return undefined;
  }
  return findEscrowAccept(body);
}
