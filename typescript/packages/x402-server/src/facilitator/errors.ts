// Typed error class for HTTP-level facilitator failures. Distinct from
// the `{ ok: false, code }` shape the facilitator itself returns —
// those are domain errors and surface in the typed result. This class
// is thrown only when the HTTP transport fails (network error,
// non-2xx response with an unparseable body, etc.).

import type { FacilitatorErrorCode } from "@bosonprotocol/x402-facilitator";

/**
 * Stable, x402-server-side codes for HTTP-transport failures.
 * Distinct from the facilitator-side `FacilitatorErrorCode` enum so
 * callers can branch on "the facilitator answered with X" vs "we
 * never reached the facilitator".
 */
export type FacilitatorHttpErrorCode =
  | "NETWORK_ERROR"
  | "BAD_HTTP_STATUS"
  | "BAD_RESPONSE_BODY"
  | "TIMEOUT";

/** Network- or transport-layer failure when calling the facilitator. */
export class FacilitatorHttpError extends Error {
  readonly code: FacilitatorHttpErrorCode;
  readonly status?: number;
  /** Original facilitator-side error code, if the body parsed cleanly. */
  readonly facilitatorCode?: FacilitatorErrorCode;

  constructor(
    message: string,
    init: {
      code: FacilitatorHttpErrorCode;
      status?: number;
      facilitatorCode?: FacilitatorErrorCode;
      cause?: unknown;
    },
  ) {
    super(message, init.cause !== undefined ? { cause: init.cause } : undefined);
    this.name = "FacilitatorHttpError";
    this.code = init.code;
    if (init.status !== undefined) this.status = init.status;
    if (init.facilitatorCode !== undefined) this.facilitatorCode = init.facilitatorCode;
  }
}
