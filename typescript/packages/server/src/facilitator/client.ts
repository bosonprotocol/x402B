// HTTP client for the Boson facilitator service. The facilitator runs
// as a remote process implementing the three endpoints in
// docs/boson-impl-07-facilitator.md (`/verify`, `/settle`,
// `/perform-action?action=<action>`); this module wraps `fetch` with the typed
// request/response shapes exported by `@bosonprotocol/x402-facilitator`.
//
// Successful responses (`{ ok: true, ... }` or `{ ok: false, code, reason }`)
// are returned verbatim — both shapes are domain results the caller
// branches on. HTTP-transport failures (network down, 5xx with an
// unparseable body, non-JSON 200, etc.) throw `FacilitatorHttpError`
// so the composition layer can distinguish "facilitator said no" from
// "we couldn't reach the facilitator".

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
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{
  ok: boolean;
  status: number;
  text: () => Promise<string>;
  json?: () => Promise<unknown>;
}>;

export interface CreateFacilitatorClientOptions {
  /** Base URL of the facilitator service (no trailing slash needed). */
  url: string;
  /** Optional `fetch` override — defaults to the global `fetch`. Useful for tests + non-`fetch` runtimes. */
  fetch?: FetchLike;
  /** Optional headers attached to every request — e.g. an `Authorization` for hosted facilitators. */
  headers?: Record<string, string>;
}

export interface FacilitatorClient {
  verify(input: FacilitatorVerifyInput): Promise<FacilitatorVerifyResult>;
  settle(input: FacilitatorSettleInput): Promise<FacilitatorSettleResult>;
  performAction(input: FacilitatorPerformActionInput): Promise<FacilitatorPerformActionResult>;
}

/**
 * Construct a typed HTTP client for the facilitator. The returned
 * methods stringify the input as JSON and POST to the matching path
 * on the configured URL. Non-2xx responses raise `FacilitatorHttpError`;
 * 2xx responses are JSON-parsed and returned verbatim.
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

  const post = async <Req, Res>(
    path: string,
    body: Req,
    validate: (parsed: unknown) => parsed is Res,
  ): Promise<Res> => {
    let res: Awaited<ReturnType<FetchLike>>;
    try {
      res = await fetchImpl(`${baseUrl}${path}`, {
        method: "POST",
        headers: baseHeaders,
        body: JSON.stringify(body),
      });
    } catch (cause) {
      throw new FacilitatorHttpError(`facilitator network error (${path})`, {
        code: "NETWORK_ERROR",
        cause,
      });
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

  return {
    verify: (input) =>
      post<FacilitatorVerifyInput, FacilitatorVerifyResult>("/verify", input, isVerifyResult),
    settle: (input) =>
      post<FacilitatorSettleInput, FacilitatorSettleResult>("/settle", input, isSettleResult),
    performAction: (input) =>
      post<FacilitatorPerformActionInput, FacilitatorPerformActionResult>(
        `/perform-action?action=${encodeURIComponent(input.action)}`,
        input,
        isPerformActionResult,
      ),
  };
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

/** Failure branch is identical across all three endpoints. */
function isFailureBranch(v: Record<string, unknown>): boolean {
  return v.ok === false && typeof v.code === "string" && typeof v.reason === "string";
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
