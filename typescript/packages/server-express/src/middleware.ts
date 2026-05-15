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
   * Optional flow selector — defaults to `commit` (Flow A, deferred
   * redeem). Flow B (`commit-and-redeem`) is opt-in and routes the
   * commit through the atomic `createOfferCommitAndRedeem` entry
   * point so the buyer redeems in the same transaction.
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
  const flow = opts.flow ?? "commit";
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
