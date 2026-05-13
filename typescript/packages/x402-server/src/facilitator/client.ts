// HTTP client for the Boson facilitator service. The facilitator runs
// as a remote process implementing the three endpoints in
// docs/boson-impl-07-facilitator.md (`/verify`, `/settle`,
// `/perform-action`); this module wraps `fetch` with the typed
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

  const post = async <Req, Res>(path: string, body: Req): Promise<Res> => {
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

    return parsed as Res;
  };

  return {
    verify: (input) => post<FacilitatorVerifyInput, FacilitatorVerifyResult>("/verify", input),
    settle: (input) => post<FacilitatorSettleInput, FacilitatorSettleResult>("/settle", input),
    performAction: (input) =>
      post<FacilitatorPerformActionInput, FacilitatorPerformActionResult>("/perform-action", input),
  };
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
