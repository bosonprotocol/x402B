// `mountX402b` — Express router exposing the eight convenience
// handlers as `POST /x402b/*` routes. The router is mountable at any
// path (default `/x402b`); the trailing path segments are fixed by
// the spec.

import type { EscrowPaymentRequirements } from "@bosonprotocol/x402-core/schemes/escrow";
import type {
  CommitHandlerInput,
  PerformActionInput,
  X402bServer,
} from "@bosonprotocol/x402-server";
import { Router, type Request, type RequestHandler } from "express";

export interface MountX402bOptions {
  /**
   * Resolver invoked for the commit-time routes (`/commit`,
   * `/commit-and-redeem`). Receives the Express request so the host
   * can look up the right `PaymentRequirements` from its own cache.
   */
  resolveRequirements: (
    req: Request,
  ) => Promise<EscrowPaymentRequirements> | EscrowPaymentRequirements;
  /** Optional mount path. Defaults to `/x402b`. */
  basePath?: string;
}

/**
 * Build the Express router. Apply with `app.use(mountX402b(server, opts))`.
 */
export function mountX402b(server: X402bServer, opts: MountX402bOptions): Router {
  const router = Router();
  const basePath = opts.basePath ?? "/x402b";

  router.post(`${basePath}/commit`, commitRoute(server, opts, "commit"));
  router.post(`${basePath}/commit-and-redeem`, commitRoute(server, opts, "commit-and-redeem"));
  router.post(`${basePath}/redeem`, performActionRoute(server, "redeem"));
  router.post(`${basePath}/complete`, performActionRoute(server, "complete"));
  router.post(`${basePath}/dispute/raise`, performActionRoute(server, "disputeRaise"));
  router.post(`${basePath}/dispute/resolve`, performActionRoute(server, "disputeResolve"));
  router.post(`${basePath}/dispute/retract`, performActionRoute(server, "disputeRetract"));
  router.post(`${basePath}/dispute/escalate`, performActionRoute(server, "disputeEscalate"));

  return router;
}

function commitRoute(
  server: X402bServer,
  opts: MountX402bOptions,
  kind: "commit" | "commit-and-redeem",
): RequestHandler {
  return async (req, res, next) => {
    try {
      const requirements = await opts.resolveRequirements(req);
      const input: CommitHandlerInput = {
        paymentHeader: req.header("x-payment"),
        requirements,
      };
      const handler = kind === "commit" ? server.handlers.commit : server.handlers.commitAndRedeem;
      const result = await handler(input);
      res.status(result.status).json(result.body);
    } catch (e) {
      next(e);
    }
  };
}

function performActionRoute(
  server: X402bServer,
  action: keyof Pick<
    X402bServer["handlers"],
    "redeem" | "complete" | "disputeRaise" | "disputeResolve" | "disputeRetract" | "disputeEscalate"
  >,
): RequestHandler {
  return async (req, res, next) => {
    try {
      const body = req.body as Partial<PerformActionInput> | null | undefined;
      if (
        body == null ||
        typeof body.exchangeId !== "string" ||
        typeof body.signedPayload !== "string"
      ) {
        res.status(400).json({
          code: "INVALID_REQUEST_BODY",
          reason: "expected JSON body with { exchangeId, signedPayload }",
        });
        return;
      }
      const input: PerformActionInput = {
        exchangeId: body.exchangeId,
        signedPayload: body.signedPayload as `0x${string}`,
      };
      const result = await server.handlers[action](input);
      res.status(result.status).json(result.body);
    } catch (e) {
      next(e);
    }
  };
}
