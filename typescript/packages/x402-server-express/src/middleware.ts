// `expressMiddleware` — gate an Express route with a 402 challenge.
// If the request carries a valid `X-PAYMENT`, the middleware runs
// the commit-and-redeem handler and attaches the result to
// `res.locals.x402b` so the downstream route handler can read the
// `exchangeId` / `txHash` / `nextActions`. If the header is missing,
// the middleware responds with 402 + a fresh `PaymentRequirements`
// body. On any other failure it responds with the structured error
// body from the handler.

import type { EscrowPaymentRequirements } from "@bosonprotocol/x402-core/schemes/escrow";
import type { CommitOk, HandlerResult, X402bServer } from "@bosonprotocol/x402-server";
import type { NextFunction, Request, RequestHandler, Response } from "express";

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
  /** Optional flow selector — defaults to `commit-and-redeem` (Flow B). */
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
  const flow = opts.flow ?? "commit-and-redeem";
  return async (req: Request, res: Response, next: NextFunction) => {
    const header = req.header("x-payment");
    if (header === undefined || header.length === 0) {
      try {
        const requirements = await opts.resolveRequirements(req, "challenge");
        res.status(402).json({ x402Version: 2, accepts: [requirements] });
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
      res.locals.x402b = result.body;
      next();
    } catch (e) {
      next(e);
    }
  };
}
