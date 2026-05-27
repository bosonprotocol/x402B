// `expressMiddleware` — gate an Express route with a 402 challenge.
// If the request carries a valid `X-PAYMENT`, the middleware runs
// the selected handler (defaults to the commit handler / Flow A)
// and attaches the result to `res.locals.x402b` so the downstream
// route handler can read the `exchangeId` / `txHash` /
// `nextActions`. If the header is missing, the middleware responds
// with 402 + a fresh `PaymentRequirements` body. On any other
// failure it responds with the structured error body from the
// handler.

import type { EscrowPaymentRequirements } from "@bosonprotocol/x402-core/schemes/escrow";
import {
  decodeXPaymentHeader,
  encodeXPaymentResponse,
  X_PAYMENT_RESPONSE_HEADER,
  type CommitOk,
  type HandlerResult,
  type X402bServer,
} from "@bosonprotocol/x402-server";
import type { NextFunction, Request, RequestHandler, Response } from "express";

import { respondWithChallenge } from "./internal/x402-challenge.js";

export interface ExpressMiddlewareOptions {
  /**
   * Resolve the `EscrowPaymentRequirements` for this request — typically
   * either looked up from a per-buyer cache keyed by an offer hash, or
   * built on-demand via `server.buildPaymentRequirements(...)`. The
   * second argument signals whether the buyer is yet to send a header
   * (so the middleware needs requirements for the 402 response) or has
   * sent one (the middleware needs the requirements the buyer signed
   * against).
   */
  resolveRequirements: (
    req: Request,
    mode: "challenge" | "settle",
  ) => Promise<EscrowPaymentRequirements> | EscrowPaymentRequirements;
  /**
   * Optional flow restriction. When omitted the middleware peeks at
   * the buyer's `X-PAYMENT` action and dispatches to the matching
   * handler — Flow A (`boson-createOfferAndCommit` → `commit`) or
   * Flow B (`boson-createOfferCommitAndRedeem` → `commitAndRedeem`).
   * That mirrors the 402 contract, which advertises BOTH commit-time
   * actions; the buyer picks one based on policy. Set this option
   * only when the resource server wants to enforce a single flow —
   * payloads carrying the other action then fail at the handler with
   * `ACTION_ROUTE_MISMATCH`.
   */
  flow?: "commit" | "commit-and-redeem";
}

export interface X402bResLocals {
  x402b: HandlerResult<CommitOk>["body"];
}

// Express's `Response.Locals` lives in the global `Express` namespace
// (it ships from `@types/express-serve-static-core`), not on the
// `"express"` module's exports — so we have to merge via
// `declare global { namespace Express { ... } }` for `res.locals.x402b`
// to actually be typed at the consumer.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface Locals extends X402bResLocals {}
  }
}

/**
 * Build an Express middleware that gates a route on a successful
 * commit-time settle. When the buyer hasn't supplied an `X-PAYMENT`
 * header yet, the middleware responds with 402 + the resolved
 * `EscrowPaymentRequirements` directly (no call into the handler).
 */
export function expressMiddleware(
  server: X402bServer,
  opts: ExpressMiddlewareOptions,
): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    const header = req.header("x-payment");
    if (header === undefined || header.length === 0) {
      try {
        const requirements = await opts.resolveRequirements(req, "challenge");
        respondWithChallenge(res, requirements);
      } catch (e) {
        next(e);
      }
      return;
    }

    try {
      const requirements = await opts.resolveRequirements(req, "settle");
      // When `opts.flow` is set, honour it strictly — payloads
      // carrying the other action will surface `ACTION_ROUTE_MISMATCH`
      // at the handler. When it's omitted, peek at the buyer's chosen
      // action and dispatch accordingly; a malformed header falls
      // through to the commit handler so the buyer sees a structured
      // decode error rather than a silent flow swap.
      const flow = opts.flow ?? detectFlowFromHeader(header);
      const handler = flow === "commit" ? server.handlers.commit : server.handlers.commitAndRedeem;
      const result = await handler({ paymentHeader: header, requirements });
      if (!result.ok) {
        res.status(result.status).json(result.body);
        return;
      }
      // The buyer's client reads `X-PAYMENT-RESPONSE` to pick up the
      // exchange metadata without parsing the resource body. Mirror
      // base x402's base64-of-JSON convention.
      res.setHeader(X_PAYMENT_RESPONSE_HEADER, encodeXPaymentResponse(result.body));
      res.locals.x402b = result.body;
      next();
    } catch (e) {
      next(e);
    }
  };
}

/**
 * Peek at the action in an `X-PAYMENT` header to decide which commit
 * handler to dispatch to. A malformed header (bad base64, bad JSON,
 * schema violation) returns `"commit"` so the commit handler's own
 * structured error surfaces to the buyer instead of a silent swap.
 */
function detectFlowFromHeader(header: string): "commit" | "commit-and-redeem" {
  const decoded = decodeXPaymentHeader(header);
  if (!decoded.ok) return "commit";
  return decoded.payload.payload.action === "boson-createOfferCommitAndRedeem"
    ? "commit-and-redeem"
    : "commit";
}
