// Shared result + error shapes for every convenience handler.
//
// Each handler returns a `HandlerResult<TBody>` whose `ok: true`
// variant carries an HTTP-200 body augmented with the `nextActions`
// envelope, and whose `ok: false` variant carries the suggested HTTP
// status + a structured error body the framework adapter (PR 5) can
// serialise into the response.

import type { EscrowNextActions } from "@bosonprotocol/x402-actions";

export type HandlerStatus = 200 | 400 | 402 | 500 | 502;

export type HandlerResult<TBody> =
  | { ok: true; status: 200; body: TBody & { nextActions: EscrowNextActions } }
  | { ok: false; status: Exclude<HandlerStatus, 200>; body: HandlerErrorBody };

export interface HandlerErrorBody {
  /** Stable identifier — caller branches on this rather than the human-readable `reason`. */
  code: string;
  reason: string;
  /** Optional rich detail — validator field/expected/got, facilitator code, etc. */
  details?: unknown;
}

export interface HandlerWarning {
  /** Stable identifier — caller branches on this rather than the human-readable `reason`. */
  code: string;
  reason: string;
  /** Optional rich detail — tx hash, exchange id, deferred operation, etc. */
  details?: unknown;
}

export function handlerOk<TBody>(
  body: TBody & { nextActions: EscrowNextActions },
): HandlerResult<TBody> {
  return { ok: true, status: 200, body };
}

export function handlerErr(
  status: Exclude<HandlerStatus, 200>,
  code: string,
  reason: string,
  details?: unknown,
): HandlerResult<never> {
  const body: HandlerErrorBody = { code, reason };
  if (details !== undefined) body.details = details;
  return { ok: false, status, body };
}
