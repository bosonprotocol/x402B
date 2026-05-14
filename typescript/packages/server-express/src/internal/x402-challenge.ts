// Shared helper for the canonical x402 challenge response (status 402,
// body `{ x402Version: 2, accepts: [requirements] }`).
//
// Both `expressMiddleware` and `mountX402b`'s commit routes need to
// emit the same shape when an incoming request is missing `X-PAYMENT`;
// keeping the format in one place means the two adapter entry points
// can't drift.

import type { EscrowPaymentRequirements } from "@bosonprotocol/x402-core/schemes/escrow";
import type { Response } from "express";

export const X402_VERSION = 2 as const;

/**
 * Write the canonical x402 challenge response to `res`. The body matches
 * what `@x402/core` clients expect: `{ x402Version, accepts: [...] }`
 * with a single entry carrying the resolved `EscrowPaymentRequirements`.
 */
export function respondWithChallenge(res: Response, requirements: EscrowPaymentRequirements): void {
  res.status(402).json({ x402Version: X402_VERSION, accepts: [requirements] });
}
