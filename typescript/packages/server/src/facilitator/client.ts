// HTTP client for the Boson facilitator service. The facilitator runs
// as a remote process implementing the three endpoints in
// docs/boson-impl-07-facilitator.md (`/verify`, `/settle`,
// `/perform-action?action=<action>`); this module wraps `fetch` with the typed
// request/response shapes exported by `@bosonprotocol/x402-facilitator`.
//
// Domain results (`{ ok: true, ... }` or `{ ok: false, code, reason }`)
// are returned verbatim — both shapes are answers the caller branches
// on. The facilitator-express adapter emits domain failures over HTTP
// 400 (so curl users still see a 4xx), but the wire body is still a
// well-formed result; we recognise that shape on HTTP 400 responses and
// hand it back rather than throwing. HTTP-transport failures (network
// down, non-JSON body, schema-mismatched body) throw
// `FacilitatorHttpError` so the composition layer can distinguish
// "facilitator said no" from "we couldn't reach the facilitator".
//
// Transport hardening: every request enforces a per-attempt timeout via
// `AbortController` and retries `NETWORK_ERROR` / `TIMEOUT` / 5xx with
// linear backoff. `/settle` calls additionally carry a stable
// `x-x402b-idempotency-key` header so a facilitator-side dedup table
// (separate package) can recognise a retried request as the same
// underlying intent.

import type {
  FacilitatorErrorCode,
  FacilitatorPerformActionInput,
  FacilitatorPerformActionResult,
  FacilitatorSettleInput,
  FacilitatorSettleResult,
  FacilitatorVerifyInput,
  FacilitatorVerifyResult,
} from "@bosonprotocol/x402-facilitator";

import { FacilitatorHttpError } from "./errors.js";

export type FetchLike = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<{
  ok: boolean;
  status: number;
  text: () => Promise<string>;
  json?: () => Promise<unknown>;
}>;

export interface FacilitatorRetryOptions {
  /** Total attempt budget (initial try + retries). Default 3. */
  attempts: number;
  /** Linear-backoff multiplier in ms: sleep `backoffMs * attemptIndex` between attempts. Default 200. */
  backoffMs: number;
}

export interface CreateFacilitatorClientOptions {
  /** Base URL of the facilitator service (no trailing slash needed). */
  url: string;
  /** Optional `fetch` override — defaults to the global `fetch`. Useful for tests + non-`fetch` runtimes. */
  fetch?: FetchLike;
  /** Optional headers attached to every request — e.g. an `Authorization` for hosted facilitators. */
  headers?: Record<string, string>;
  /**
   * Per-attempt timeout in ms. Default 30_000. The `AbortController`
   * aborts in-flight fetches when this elapses; the error surfaces as
   * `FacilitatorHttpError` with code `TIMEOUT` and is retried under
   * the same policy as `NETWORK_ERROR`.
   */
  timeoutMs?: number;
  /**
   * Retry policy applied to `NETWORK_ERROR`, `TIMEOUT`, and HTTP 5xx
   * responses. Defaults to `{ attempts: 3, backoffMs: 200 }` — three
   * attempts total at 0/200/400 ms. Set `{ attempts: 1, backoffMs: 0 }`
   * to disable.
   */
  retry?: FacilitatorRetryOptions;
  /**
   * Factory for the `x-x402b-idempotency-key` header attached to
   * `/settle` calls. Called once per logical request — *not* once per
   * retry attempt — so the facilitator's dedup table can recognise
   * retries of the same intent. Defaults to `crypto.randomUUID`.
   */
  idempotencyKey?: () => string;
  /** Override for `setTimeout` — tests use this to skip real backoff sleeps. */
  setTimeout?: typeof setTimeout;
  /** Override for `clearTimeout` — paired with `setTimeout`. */
  clearTimeout?: typeof clearTimeout;
}

export interface FacilitatorClient {
  verify(input: FacilitatorVerifyInput): Promise<FacilitatorVerifyResult>;
  settle(input: FacilitatorSettleInput): Promise<FacilitatorSettleResult>;
  performAction(input: FacilitatorPerformActionInput): Promise<FacilitatorPerformActionResult>;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_RETRY: FacilitatorRetryOptions = { attempts: 3, backoffMs: 200 };

/** Idempotency-key header name. Stable so a facilitator-side dedup table can recognise it. */
export const IDEMPOTENCY_KEY_HEADER = "x-x402b-idempotency-key";

/**
 * Construct a typed HTTP client for the facilitator. The returned
 * methods stringify the input as JSON and POST to the matching path
 * on the configured URL. Bodies matching the well-formed result shape
 * (whether HTTP 2xx success or HTTP 400 domain rejection) are returned
 * verbatim; transport failures (network, non-JSON body,
 * schema-mismatched body) raise `FacilitatorHttpError`.
 */
export function createFacilitatorClient(opts: CreateFacilitatorClientOptions): FacilitatorClient {
  const fetchImpl = opts.fetch ?? (globalThis.fetch as FetchLike | undefined);
  if (fetchImpl === undefined) {
    throw new Error(
      "createFacilitatorClient: no `fetch` implementation available. Pass `opts.fetch` explicitly.",
    );
  }
  const baseUrl = opts.url.replace(/\/+$/, "");
  const baseHeaders = { "content-type": "application/json", ...(opts.headers ?? {}) };
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retry = opts.retry ?? DEFAULT_RETRY;
  const newIdempotencyKey = opts.idempotencyKey ?? (() => globalThis.crypto.randomUUID());
  const setTimeoutImpl = opts.setTimeout ?? setTimeout;
  const clearTimeoutImpl = opts.clearTimeout ?? clearTimeout;

  const postOnce = async <Req, Res>(
    path: string,
    body: Req,
    validate: (parsed: unknown) => parsed is Res,
    extraHeaders: Record<string, string>,
  ): Promise<Res> => {
    const controller = new AbortController();
    const timer = setTimeoutImpl(() => controller.abort(), timeoutMs);
    const headers = { ...baseHeaders, ...extraHeaders };

    let res: Awaited<ReturnType<FetchLike>>;
    try {
      res = await fetchImpl(`${baseUrl}${path}`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (cause) {
      const aborted = controller.signal.aborted;
      throw new FacilitatorHttpError(
        aborted
          ? `facilitator request timed out after ${timeoutMs}ms (${path})`
          : `facilitator network error (${path})`,
        {
          code: aborted ? "TIMEOUT" : "NETWORK_ERROR",
          cause,
        },
      );
    } finally {
      clearTimeoutImpl(timer);
    }

    let text: string;
    try {
      text = await res.text();
    } catch (cause) {
      throw new FacilitatorHttpError(`facilitator response body could not be read (${path})`, {
        code: "BAD_RESPONSE_BODY",
        status: res.status,
        cause,
      });
    }

    let parsed: unknown;
    try {
      parsed = text.length === 0 ? null : JSON.parse(text);
    } catch (cause) {
      throw new FacilitatorHttpError(`facilitator returned non-JSON body (${path})`, {
        code: "BAD_RESPONSE_BODY",
        status: res.status,
        cause,
      });
    }

    if (!res.ok) {
      // The facilitator-express adapter returns domain failures as
      // HTTP 400 with the `{ok:false, code, reason}` body. Detect that
      // shape and surface it as the typed result — every endpoint's
      // `Res` union includes the same `{ok:false, code, reason}`
      // variant, so the cast through `validate` (which also accepts
      // that shape) preserves type-safety. Any other non-2xx status is
      // a genuine transport failure even if its body happens to look
      // like a facilitator result.
      if (res.status === 400 && isFailureBranch(parsed) && validate(parsed)) {
        return parsed;
      }
      const facilitatorCode = extractFacilitatorCode(parsed);
      throw new FacilitatorHttpError(
        `facilitator HTTP ${res.status} (${path}): ${reasonString(parsed) ?? text}`,
        {
          code: "BAD_HTTP_STATUS",
          status: res.status,
          ...(facilitatorCode !== undefined ? { facilitatorCode } : {}),
        },
      );
    }

    if (!validate(parsed)) {
      throw new FacilitatorHttpError(`facilitator returned unexpected body shape (${path})`, {
        code: "BAD_RESPONSE_BODY",
        status: res.status,
      });
    }
    return parsed;
  };

  const post = async <Req, Res>(
    path: string,
    body: Req,
    validate: (parsed: unknown) => parsed is Res,
    extraHeaders: Record<string, string> = {},
  ): Promise<Res> => {
    let lastError: FacilitatorHttpError | undefined;
    for (let attempt = 0; attempt < retry.attempts; attempt += 1) {
      if (attempt > 0) {
        await sleep(retry.backoffMs * attempt, setTimeoutImpl);
      }
      try {
        return await postOnce(path, body, validate, extraHeaders);
      } catch (e) {
        if (e instanceof FacilitatorHttpError && isRetryable(e)) {
          lastError = e;
          continue;
        }
        throw e;
      }
    }
    // Non-null assertion: the loop above sets `lastError` on every retryable
    // failure and only falls through after the final attempt also failed.
    throw lastError as FacilitatorHttpError;
  };

  return {
    verify: (input) =>
      post<FacilitatorVerifyInput, FacilitatorVerifyResult>("/verify", input, isVerifyResult),
    settle: (input) =>
      post<FacilitatorSettleInput, FacilitatorSettleResult>("/settle", input, isSettleResult, {
        [IDEMPOTENCY_KEY_HEADER]: newIdempotencyKey(),
      }),
    performAction: (input) =>
      post<FacilitatorPerformActionInput, FacilitatorPerformActionResult>(
        `/perform-action?action=${encodeURIComponent(input.action)}`,
        input,
        isPerformActionResult,
      ),
  };
}

function isRetryable(e: FacilitatorHttpError): boolean {
  if (e.code === "NETWORK_ERROR" || e.code === "TIMEOUT") return true;
  if (e.code === "BAD_HTTP_STATUS" && e.status !== undefined && e.status >= 500) return true;
  return false;
}

function sleep(ms: number, setTimeoutImpl: typeof setTimeout): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    setTimeoutImpl(resolve, ms);
  });
}

// --- Response-shape type guards ----------------------------------------
//
// A buggy or malicious facilitator could return any 2xx JSON; without a
// runtime check, `parsed as Res` would silently slip an unexpected shape
// past the type system and the convenience handlers (PR 4) would
// dereference fields that aren't there. These guards mirror the
// discriminated unions in `@bosonprotocol/x402-facilitator`'s types and
// fail any response that doesn't fit — surfaced as
// `BAD_RESPONSE_BODY` so the caller treats it as a transport-layer
// failure rather than a domain answer.

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object";
}

/**
 * Failure branch is identical across all three endpoints. Accepts
 * `unknown` so the non-2xx path can pre-check the parsed body without
 * narrowing first.
 */
function isFailureBranch(v: unknown): v is { ok: false; code: string; reason: string } {
  return (
    isObject(v) && v.ok === false && typeof v.code === "string" && typeof v.reason === "string"
  );
}

function isVerifyResult(parsed: unknown): parsed is FacilitatorVerifyResult {
  if (!isObject(parsed)) return false;
  if (parsed.ok === true) return true; // `{ ok: true }` carries no further fields
  return isFailureBranch(parsed);
}

function isSettleResult(parsed: unknown): parsed is FacilitatorSettleResult {
  if (!isObject(parsed)) return false;
  if (parsed.ok === true) {
    return typeof parsed.exchangeId === "string" && typeof parsed.txHash === "string";
  }
  return isFailureBranch(parsed);
}

function isPerformActionResult(parsed: unknown): parsed is FacilitatorPerformActionResult {
  if (!isObject(parsed)) return false;
  if (parsed.ok === true) {
    if (typeof parsed.txHash !== "string") return false;
    // Entity-keyed actions (e.g. `boson-withdrawFunds`) return just
    // `{ ok: true, txHash }` — no exchange state transition. Accept
    // that shape; only require `newExchangeState` when present.
    if (parsed.newExchangeState !== undefined && typeof parsed.newExchangeState !== "string") {
      return false;
    }
    if (parsed.newDisputeState !== undefined && typeof parsed.newDisputeState !== "string") {
      return false;
    }
    return true;
  }
  return isFailureBranch(parsed);
}

function extractFacilitatorCode(body: unknown): FacilitatorErrorCode | undefined {
  if (body === null || typeof body !== "object") return undefined;
  const code = (body as { code?: unknown }).code;
  return typeof code === "string" ? (code as FacilitatorErrorCode) : undefined;
}

function reasonString(body: unknown): string | undefined {
  if (body === null || typeof body !== "object") return undefined;
  const reason = (body as { reason?: unknown }).reason;
  return typeof reason === "string" ? reason : undefined;
}
