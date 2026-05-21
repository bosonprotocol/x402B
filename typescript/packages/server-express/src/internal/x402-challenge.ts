// Shared helper for the x402 challenge response.
//
// Two output formats, chosen by content negotiation:
//
//  - `application/json` (the default, and the only output when no
//    paywall is configured) — `{ x402Version, accepts: [requirements] }`,
//    the canonical x402 wire contract clients pattern-match on.
//  - `text/html` — a full HTML document produced by a
//    `PaywallProvider.generateHtml(...)`, served when the request's
//    `Accept` header prefers HTML *and* the caller configured a paywall.
//
// Both `expressMiddleware` and `mountX402b`'s commit routes funnel
// missing-`X-PAYMENT` requests through this helper so the negotiation
// rules can't drift between the two adapter entry points.

import type { EscrowPaymentRequirements } from "@bosonprotocol/x402-core/schemes/escrow";
import type { Request, Response } from "express";

export const X402_VERSION = 2 as const;

/**
 * Structural subset of `@bosonprotocol/x402-paywall`'s `PaywallProvider`
 * that this adapter exercises. Defined locally so this package doesn't
 * need to take `@bosonprotocol/x402-paywall` as a runtime / type dep —
 * any object satisfying this shape works.
 */
export interface PaywallProviderLike {
  supports(requirements: { scheme?: string }): boolean;
  generateHtml(
    payload: { requirements: EscrowPaymentRequirements; currentUrl?: string },
    config?: PaywallConfigLike,
  ): string;
}

/**
 * Opaque pass-through config forwarded to `PaywallProvider.generateHtml`.
 * The adapter doesn't introspect it.
 */
export type PaywallConfigLike = Record<string, unknown>;

export interface ChallengeOptions {
  paywall?: PaywallProviderLike;
  paywallConfig?: PaywallConfigLike;
}

/**
 * Write the x402 challenge response to `res`.
 *
 * If `opts.paywall` is supplied, the request's `Accept` header prefers
 * HTML, and `paywall.supports(requirements)` returns `true`, the
 * response body is the paywall's `generateHtml(...)` output (status 402,
 * `Content-Type: text/html`). Otherwise the canonical JSON body is
 * emitted.
 */
export function respondWithChallenge(
  req: Request,
  res: Response,
  requirements: EscrowPaymentRequirements,
  opts: ChallengeOptions = {},
): void {
  if (opts.paywall && wantsHtml(req) && opts.paywall.supports(requirements)) {
    const html = opts.paywall.generateHtml(
      { requirements, currentUrl: buildCurrentUrl(req) },
      opts.paywallConfig,
    );
    res.status(402).type("html").send(html);
    return;
  }
  res.status(402).json({ x402Version: X402_VERSION, accepts: [requirements] });
}

/**
 * `req.accepts(['html', 'json'])` returns whichever the client prefers
 * (per the standard `Accept` header q-value ordering). However, generic
 * headers such as `*/*` can make both HTML and JSON acceptable, and
 * Express will typically select the first listed type. To keep JSON as
 * the canonical default for non-browser clients, only treat the request
 * as HTML-capable when the raw `Accept` header explicitly includes
 * `text/html` or `application/xhtml+xml`.
 */
function wantsHtml(req: Request): boolean {
  const acceptHeader = req.headers.accept;
  if (typeof acceptHeader !== "string" || acceptHeader.length === 0) return false;

  const explicitlyAcceptsHtml = acceptHeader
    .split(",")
    .map((value) => value.split(";")[0]?.trim().toLowerCase())
    .some((value) => value === "text/html" || value === "application/xhtml+xml");

  if (!explicitlyAcceptsHtml) return false;

  return req.accepts(["html", "json"]) === "html";
}

function buildCurrentUrl(req: Request): string {
  const host = req.get("host") ?? "";
  return `${req.protocol}://${host}${req.originalUrl}`;
}
