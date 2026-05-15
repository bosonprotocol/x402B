// `mountX402b` — Express router exposing the eight convenience
// handlers as `POST /x402b/*` routes. The router is mountable at any
// path (default `/x402b`); the trailing path segments are fixed by
// the spec.

import type { EscrowPaymentRequirements } from "@bosonprotocol/x402-core/schemes/escrow";
import {
  encodeXPaymentResponse,
  X_PAYMENT_RESPONSE_HEADER,
  type AvailableFundsQuery,
  type CommitHandlerInput,
  type PerformActionInput,
  type RedeemHandlerInput,
  type WithdrawFundsInput,
  type X402bServer,
} from "@bosonprotocol/x402-server";
import { Router, type Request, type RequestHandler, type Response } from "express";
import type { Hex } from "viem";

import { respondWithChallenge } from "./internal/x402-challenge.js";

/** Shared error code for malformed `POST /x402b/*` bodies. */
export const INVALID_REQUEST_BODY = "INVALID_REQUEST_BODY" as const;

/** Hex-string check matching the `0x[0-9a-fA-F]*` shape `signedPayload` is typed as. */
const HEX_BYTES_RE = /^0x[0-9a-fA-F]*$/;
const DECIMAL_UINT_RE = /^\d+$/;
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

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
  router.post(`${basePath}/withdraw-funds`, withdrawFundsRoute(server));
  router.get(`${basePath}/available-funds`, availableFundsRoute(server));

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
      // The common post-commit body is just `{ exchangeId, signedPayload }`.
      // `fulfillment` is redeem-specific and is left as `unknown` here —
      // `handleRedeemRoute` narrows it via `isRedeemFulfillment` before
      // assembling the typed `RedeemHandlerInput`.
      const body = req.body as PostCommitBody | null | undefined;
      if (
        body == null ||
        typeof body.exchangeId !== "string" ||
        typeof body.signedPayload !== "string"
      ) {
        res.status(400).json({
          code: INVALID_REQUEST_BODY,
          reason: "expected JSON body with { exchangeId, signedPayload }",
        });
        return;
      }
      if (!HEX_BYTES_RE.test(body.signedPayload)) {
        res.status(400).json({
          code: INVALID_REQUEST_BODY,
          reason: "signedPayload must be a 0x-prefixed hex string",
        });
        return;
      }
      const baseInput: PerformActionInput = {
        exchangeId: body.exchangeId,
        signedPayload: body.signedPayload as `0x${string}`,
      };
      const result =
        action === "redeem"
          ? await handleRedeemRoute(server, baseInput, body.fulfillment, res)
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

function withdrawFundsRoute(server: X402bServer): RequestHandler {
  return async (req, res, next) => {
    try {
      const body = req.body as Record<string, unknown> | null | undefined;
      if (body == null || typeof body.signedPayload !== "string") {
        res.status(400).json({
          code: "INVALID_REQUEST_BODY",
          reason: "expected JSON body with { signedPayload, entityId? | (address, role?) }",
        });
        return;
      }
      if (!HEX_BYTES_RE.test(body.signedPayload)) {
        res.status(400).json({
          code: INVALID_REQUEST_BODY,
          reason: "signedPayload must be a 0x-prefixed hex string",
        });
        return;
      }
      const hasEntityId = typeof body.entityId === "string";
      const hasAddress = typeof body.address === "string";
      if (hasEntityId === hasAddress) {
        res.status(400).json({
          code: "INVALID_REQUEST_BODY",
          reason: "exactly one of `entityId` or `address` must be set",
        });
        return;
      }

      let input: WithdrawFundsInput;
      if (hasEntityId) {
        input = {
          signedPayload: body.signedPayload as Hex,
          entityId: body.entityId as string,
        };
      } else {
        const role = body.role;
        if (role !== undefined && role !== "buyer" && role !== "seller") {
          res.status(400).json({
            code: "INVALID_REQUEST_BODY",
            reason: 'role must be "buyer" or "seller" when set',
          });
          return;
        }
        input = {
          signedPayload: body.signedPayload as Hex,
          address: body.address as string,
          ...(role !== undefined ? { role: role as "buyer" | "seller" } : {}),
        };
      }

      const result = await server.handlers.withdrawFunds(input);
      res.status(result.status).json(result.body);
    } catch (e) {
      next(e);
    }
  };
}

function availableFundsRoute(server: X402bServer): RequestHandler {
  return async (req, res, next) => {
    try {
      const entityIdRaw = req.query.entityId;
      const addressRaw = req.query.address;
      const roleRaw = req.query.role;
      const hasEntityId = typeof entityIdRaw === "string";
      const hasAddress = typeof addressRaw === "string";
      if (hasEntityId === hasAddress) {
        res.status(400).json({
          code: "INVALID_REQUEST_QUERY",
          reason: "exactly one of `entityId` or `address` must be set",
        });
        return;
      }

      let query: AvailableFundsQuery;
      if (hasEntityId) {
        if (!DECIMAL_UINT_RE.test(entityIdRaw as string)) {
          res.status(400).json({
            code: "INVALID_ENTITY_ID",
            reason: "entityId must be a decimal uint256 string",
          });
          return;
        }
        query = { entityId: entityIdRaw as string };
      } else {
        if (!ADDRESS_RE.test(addressRaw as string)) {
          res.status(400).json({
            code: "INVALID_ADDRESS",
            reason: "address must be a 20-byte 0x-prefixed hex string",
          });
          return;
        }
        if (roleRaw !== undefined && roleRaw !== "buyer" && roleRaw !== "seller") {
          res.status(400).json({
            code: "INVALID_ROLE",
            reason: 'role must be "buyer" or "seller" when set',
          });
          return;
        }
        query = {
          address: addressRaw as string,
          ...(roleRaw !== undefined ? { role: roleRaw as "buyer" | "seller" } : {}),
        };
      }

      const result = await server.handlers.getAvailableFunds(query);
      res.status(result.status).json(result.body);
    } catch (e) {
      next(e);
    }
  };
}

interface PostCommitBody {
  exchangeId?: unknown;
  signedPayload?: unknown;
  /** Redeem-only; untyped here and narrowed by `isRedeemFulfillment`. */
  fulfillment?: unknown;
}

async function handleRedeemRoute(
  server: X402bServer,
  baseInput: PerformActionInput,
  fulfillment: unknown,
  res: Response,
) {
  const input = buildRedeemInput(baseInput, fulfillment, res);
  if (input === undefined) return undefined;
  return await server.handlers.redeem(input);
}

function buildRedeemInput(
  baseInput: PerformActionInput,
  fulfillment: unknown,
  res: Response,
): RedeemHandlerInput | undefined {
  if (fulfillment === undefined) {
    return baseInput;
  }
  if (!isRedeemFulfillment(fulfillment)) {
    res.status(400).json({
      code: INVALID_REQUEST_BODY,
      reason: "expected fulfillment to be { option: string, data: object | null } when present",
    });
    return undefined;
  }
  return { ...baseInput, fulfillment };
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
