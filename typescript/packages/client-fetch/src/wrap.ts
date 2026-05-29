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
//
// ### Commit fallback (opt-in)
//
// When `commitFallback: "auto"` is set, a resource-server 5xx / network
// error / timeout on step 5 no longer fails the call. Instead, the
// wrapper recovers the structured `EscrowPaymentPayload` from the
// X-PAYMENT base64, looks up `requirements.actions.next[*]
// .endpoints.facilitator` for the chosen commit action, and POSTs
// `{ scheme, network, payload, requirements }` directly to the
// facilitator's `/settle` route. On success the commit lands on-chain
// via the facilitator and the wrapper returns a **synthesized 200**
// with:
//
//   - `X-PAYMENT-RESPONSE: <base64-of-the-success-body>` so
//     `client.parsePaymentResponse(...)` continues to work,
//   - `X-X402-Boson-Commit-Channel: facilitator` so the caller can
//     detect that fallback was used,
//   - `X-X402-Boson-Server-Error: <status-or-message>` for diagnostics,
//   - an empty body — the resource itself comes from the resource
//     server, which by definition is unreachable; callers that need
//     the resource must come back later (re-GET when the server is up,
//     or rely on the seller's asynchronous fulfillment channel).
//
// Default is `commitFallback: "off"` — the behaviour above is opt-in so
// that existing callers don't get a different response shape from a
// brief upstream blip.

import { SESSION_ID_HEADER } from "@bosonprotocol/x402-core";
import {
  findEscrowAccept,
  parseEscrowPaymentPayload,
  type EscrowPaymentPayload,
  type NextAction,
} from "@bosonprotocol/x402-core/schemes/escrow";
import { ACTION_POST_STATE } from "@bosonprotocol/x402-core/state-machine";
import type { X402bClient } from "@bosonprotocol/x402-client";

type CommitActionId = "boson-createOfferAndCommit" | "boson-createOfferCommitAndRedeem";

// Re-exported below so existing `@bosonprotocol/x402-client-fetch`
// importers keep working without having to add a direct dep on
// `@bosonprotocol/x402-core`.
export { SESSION_ID_HEADER };

const X_PAYMENT_HEADER = "X-PAYMENT";
const X_PAYMENT_RESPONSE_HEADER = "X-PAYMENT-RESPONSE";
const COMMIT_CHANNEL_HEADER = "X-X402-Boson-Commit-Channel";
const SERVER_ERROR_HEADER = "X-X402-Boson-Server-Error";

/** Per-wrapper configuration knobs. */
export interface WrapFetchOptions {
  /**
   * When `"auto"`, retry-with-X-PAYMENT failures (5xx / network error /
   * timeout against the resource server) are recovered by POSTing the
   * payload directly to the facilitator's `/settle` endpoint advertised
   * in the prior 402's `actions.next[*].endpoints.facilitator`. The
   * wrapper synthesizes a 200 response carrying the
   * `X-PAYMENT-RESPONSE` header and a `X-X402-Boson-Commit-Channel:
   * facilitator` marker so callers can detect the fallback path.
   *
   * Default `"off"` — callers must opt in to the synthesized-response
   * shape.
   */
  commitFallback?: "off" | "auto";
  /** Per-attempt timeout in milliseconds, applied to the facilitator fallback POST. Default 10000. */
  facilitatorTimeoutMs?: number;
}

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
  options: WrapFetchOptions = {},
): typeof fetch {
  const commitFallback = options.commitFallback ?? "off";
  const facilitatorTimeoutMs = options.facilitatorTimeoutMs ?? 10_000;

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

    let retryResponse: Response;
    let networkErrorMessage: string | undefined;
    try {
      retryResponse = await originalFetch(retryRequest);
    } catch (e) {
      if (commitFallback !== "auto") {
        throw e;
      }
      networkErrorMessage = e instanceof Error ? e.message : String(e);
      // Synthesize a 599 sentinel so the network-error path joins the
      // 5xx branch below (`status < 500` skips the fallback). 599 is
      // never returned to the caller — on a successful fallback we
      // emit a synthesized 200; on a failed fallback we surface this
      // placeholder as the original error, which is acceptable
      // because the real error message is preserved on the
      // `X-X402-Boson-Server-Error` header (`network:<message>`).
      retryResponse = new Response(null, { status: 599 });
    }

    if (commitFallback !== "auto" || retryResponse.status < 500) {
      return retryResponse;
    }

    // Resource server failed (5xx / network). Try the facilitator-direct
    // path. On *any* recoverable hand-off failure (no facilitator
    // endpoint advertised, facilitator also failing, …) we surface the
    // original 5xx — the buyer-facing contract is "fallback is
    // best-effort; on failure the upstream error wins".
    const fallback = await tryFacilitatorFallback({
      escrowEntry,
      headerValue,
      facilitatorTimeoutMs,
      originalFetch,
    });
    if (fallback === undefined) {
      // Couldn't fall back. Surface the original retry response —
      // either the resource server's 5xx body, or, when the call
      // failed at the network level, the synthesized 599 placeholder.
      return retryResponse;
    }
    return synthesizeCommitFallbackResponse({
      body: fallback,
      actionId: fallback.actionId,
      serverErrorMarker:
        networkErrorMessage !== undefined
          ? `network:${networkErrorMessage}`
          : String(retryResponse.status),
    });
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

/**
 * Try to land the commit via the facilitator's `/settle` route. Returns
 * the parsed success body on a 2xx, or `undefined` on any failure
 * (caller surfaces the original 5xx).
 */
async function tryFacilitatorFallback(input: {
  escrowEntry: unknown;
  headerValue: string;
  facilitatorTimeoutMs: number;
  originalFetch: typeof fetch;
}): Promise<
  { ok: true; actionId: CommitActionId; exchangeId: string; txHash: string } | undefined
> {
  const requirements = input.escrowEntry as {
    scheme?: unknown;
    network?: unknown;
    actions?: { next?: unknown };
  };
  if (
    requirements.scheme !== "escrow" ||
    typeof requirements.network !== "string" ||
    !Array.isArray(requirements.actions?.next)
  ) {
    return undefined;
  }

  const commitEntry = (requirements.actions.next as NextAction[]).find(
    (e): e is NextAction & { id: CommitActionId } =>
      (e.id === "boson-createOfferAndCommit" || e.id === "boson-createOfferCommitAndRedeem") &&
      e.channels.includes("facilitator") &&
      typeof e.endpoints?.facilitator === "string",
  );
  if (commitEntry === undefined) {
    return undefined;
  }

  let payload: EscrowPaymentPayload;
  try {
    payload = parseEscrowPaymentPayload(JSON.parse(decodeBase64(input.headerValue)));
  } catch {
    return undefined;
  }

  const settleUrl = commitEntry.endpoints!.facilitator!;
  const body = JSON.stringify({
    scheme: "escrow",
    network: requirements.network,
    payload,
    requirements,
  });

  let res: Response;
  try {
    res = await fetchWithTimeout(input.originalFetch, settleUrl, body, input.facilitatorTimeoutMs);
  } catch {
    return undefined;
  }

  if (!res.ok) return undefined;

  const parsed = (await res.json().catch(() => null)) as unknown;
  if (parsed === null || typeof parsed !== "object" || (parsed as { ok?: unknown }).ok !== true) {
    return undefined;
  }
  const ok = parsed as { ok: true; exchangeId?: unknown; txHash?: unknown };
  if (typeof ok.exchangeId !== "string" || typeof ok.txHash !== "string") {
    return undefined;
  }
  return {
    ok: true,
    actionId: commitEntry.id,
    exchangeId: ok.exchangeId,
    txHash: ok.txHash,
  };
}

/**
 * Build the synthesized fallback `Response` returned to the caller when
 * the facilitator settled the commit successfully. Status 200 keeps
 * existing `response.ok` checks happy; the channel header lets callers
 * detect that the resource body wasn't delivered.
 */
function synthesizeCommitFallbackResponse(input: {
  body: { ok: true; exchangeId: string; txHash: string };
  actionId: CommitActionId;
  serverErrorMarker: string;
}): Response {
  const xPaymentResponseBody = {
    exchangeId: input.body.exchangeId,
    txHash: input.body.txHash,
    nextActions: { exchangeState: ACTION_POST_STATE[input.actionId].exchange },
  };
  const headers = new Headers();
  headers.set(X_PAYMENT_RESPONSE_HEADER, encodeBase64(JSON.stringify(xPaymentResponseBody)));
  headers.set(COMMIT_CHANNEL_HEADER, "facilitator");
  headers.set(SERVER_ERROR_HEADER, input.serverErrorMarker);
  return new Response(null, { status: 200, headers });
}

async function fetchWithTimeout(
  fetcher: typeof fetch,
  url: string,
  body: string,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetcher(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
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

function encodeBase64(value: string): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(value, "utf8").toString("base64");
  }
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  return btoa(binary);
}
