// `mountX402b` — Express router exposing the eight convenience
// handlers as `POST /x402b/*` routes. The router is mountable at any
// path (default `/x402b`); the trailing path segments are fixed by
// the spec.

import type { EscrowPaymentRequirements } from "@bosonprotocol/x402-core/schemes/escrow";
import {
  encodeXPaymentResponse,
  X_PAYMENT_RESPONSE_HEADER,
  type CommitHandlerInput,
  type PerformActionInput,
  type RedeemHandlerInput,
  type X402bServer,
} from "@bosonprotocol/x402-server";
import { Router, type Request, type RequestHandler, type Response } from "express";

import { respondWithChallenge } from "./internal/x402-challenge.js";

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
      const header = req.header("x-payment");
      const requirements = await opts.resolveRequirements(req);

      // Missing `X-PAYMENT` is the canonical x402 challenge case — emit
      // the same `{ x402Version, accepts: [requirements] }` body
      // `expressMiddleware` does. Without this short-circuit the
      // request would fall through to the handler, which returns its
      // structured-error 402 body ({ code: "MISSING_HEADER", … }) —
      // useful for non-Express integrators, but not the x402 wire
      // contract clients branch on.
      if (header === undefined || header.length === 0) {
        respondWithChallenge(res, requirements);
        return;
      }

      const input: CommitHandlerInput = { paymentHeader: header, requirements };
      const handler = kind === "commit" ? server.handlers.commit : server.handlers.commitAndRedeem;
      const result = await handler(input);
      stampXPaymentResponseIfOk(res, result);
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
      const body = req.body as Partial<RedeemHandlerInput> | null | undefined;
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
      const baseInput: PerformActionInput = {
        exchangeId: body.exchangeId,
        signedPayload: body.signedPayload as `0x${string}`,
      };
      const result =
        action === "redeem"
          ? await handleRedeemRoute(server, baseInput, body, res)
          : await server.handlers[action](baseInput);
      if (result === undefined) return;
      // No `X-PAYMENT-RESPONSE` here — post-commit actions (redeem,
      // complete, dispute raise/resolve/retract/escalate) don't carry
      // a payment. The header is reserved for commit-time settlements;
      // a future deposit-paying `escalateDispute` flow will re-add it
      // on that specific path.
      res.status(result.status).json(result.body);
    } catch (e) {
      next(e);
    }
  };
}

async function handleRedeemRoute(
  server: X402bServer,
  baseInput: PerformActionInput,
  body: Partial<RedeemHandlerInput>,
  res: Response,
) {
  const input = buildRedeemInput(baseInput, body, res);
  if (input === undefined) return undefined;
  return await server.handlers.redeem(input);
}

function buildRedeemInput(
  baseInput: PerformActionInput,
  body: Partial<RedeemHandlerInput>,
  res: Response,
): RedeemHandlerInput | undefined {
  if (body.fulfillment === undefined) {
    return baseInput;
  }
  if (!isRedeemFulfillment(body.fulfillment)) {
    res.status(400).json({
      code: "INVALID_REQUEST_BODY",
      reason: "expected fulfillment to be { option: string, data: object | null } when present",
    });
    return undefined;
  }
  return { ...baseInput, fulfillment: body.fulfillment };
}

function isRedeemFulfillment(value: unknown): value is RedeemHandlerInput["fulfillment"] {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as { option?: unknown; data?: unknown };
  if (typeof candidate.option !== "string") return false;
  return (
    candidate.data === null ||
    (typeof candidate.data === "object" &&
      candidate.data !== null &&
      !Array.isArray(candidate.data))
  );
}

// Stamp base64(JSON.stringify(body)) onto the `X-PAYMENT-RESPONSE` header.
// Only used on commit-time routes — see `performActionRoute` for the
// rationale on why post-commit actions don't get this header.
function stampXPaymentResponseIfOk(
  res: Response,
  result: { ok: true; body: unknown } | { ok: false },
): void {
  if (result.ok) {
    res.setHeader(X_PAYMENT_RESPONSE_HEADER, encodeXPaymentResponse(result.body));
  }
}
