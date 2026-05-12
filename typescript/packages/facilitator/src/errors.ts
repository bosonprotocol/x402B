// Typed errors thrown by `@bosonprotocol/x402-facilitator`.

import type { FacilitatorErrorCode } from "./types.js";

/**
 * Base class for facilitator errors. Carries a stable `code` and a
 * human-readable `reason`. Consumers should branch on `code` (or on
 * `instanceof FacilitatorError` first) rather than parsing `message`.
 */
export class FacilitatorError extends Error {
  readonly code: FacilitatorErrorCode;
  readonly reason: string;

  constructor(code: FacilitatorErrorCode, reason: string) {
    super(`${code}: ${reason}`);
    this.name = "FacilitatorError";
    this.code = code;
    this.reason = reason;
  }
}

/**
 * Thrown by every v0.1 stub function. Tests assert on this class so a
 * future swap to a real implementation is detected by failing assertions.
 */
export class NotImplementedError extends FacilitatorError {
  constructor(feature: string) {
    super("NOT_IMPLEMENTED", `${feature} is not implemented yet`);
    this.name = "NotImplementedError";
  }
}

/**
 * Normalize an unknown thrown value into the `{ ok: false, code, reason }`
 * branch of a facilitator result. Useful at HTTP handler boundaries.
 *
 * - `FacilitatorError` preserves its `code` / `reason`.
 * - Any other `Error` collapses to `INTERNAL_ERROR` with its `message`.
 * - Non-Error throws collapse to `INTERNAL_ERROR` with `String(err)`.
 */
export function toResult(err: unknown): { ok: false; code: FacilitatorErrorCode; reason: string } {
  if (err instanceof FacilitatorError) {
    return { ok: false, code: err.code, reason: err.reason };
  }
  if (err instanceof Error) {
    return { ok: false, code: "INTERNAL_ERROR", reason: err.message };
  }
  return { ok: false, code: "INTERNAL_ERROR", reason: String(err) };
}
