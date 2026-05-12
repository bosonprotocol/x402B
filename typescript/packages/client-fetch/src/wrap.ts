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

import type { X402bClient } from "@bosonprotocol/x402-client";

const X_PAYMENT_HEADER = "X-PAYMENT";

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
    const initial = await originalFetch(input, init);
    if (initial.status !== 402) {
      return initial;
    }

    const escrowEntry = await extractEscrowEntry(initial);
    if (!escrowEntry) {
      return initial;
    }

    const headerValue = await client.handle402(escrowEntry);

    const headers = new Headers(init?.headers);
    headers.set(X_PAYMENT_HEADER, headerValue);
    const retryInit: RequestInit = { ...init, headers };

    return originalFetch(input, retryInit);
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
  if (typeof body !== "object" || body === null) {
    return undefined;
  }
  const accepts = (body as { accepts?: unknown }).accepts;
  if (!Array.isArray(accepts)) {
    return undefined;
  }
  return accepts.find(
    (entry) =>
      typeof entry === "object" &&
      entry !== null &&
      (entry as { scheme?: unknown }).scheme === "escrow",
  );
}
