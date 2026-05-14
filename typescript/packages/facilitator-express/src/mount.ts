// `mountFacilitator` — Express router exposing the three facilitator
// endpoints from docs/boson-impl-07-facilitator.md:
//
//   POST /verify          — validate a buyer-signed escrow payment
//   POST /settle          — relay a commit-time meta-transaction
//   POST /perform-action  — relay a post-commit meta-transaction
//
// The router is mountable at any path (default `/`); the trailing path
// segments are fixed by the spec. Routing here is intentionally thin —
// `verify`, `settle`, and `performAction` from `@bosonprotocol/x402-facilitator`
// already validate the request body via Zod schemas, so each handler
// just forwards `req.body`, awaits the discriminated-union result, and
// maps `ok: true` to HTTP 200 / `ok: false` to HTTP 400. Callers MUST
// install `express.json()` upstream.

import {
  performAction,
  settle,
  verify,
  type FacilitatorConfig,
  type FacilitatorPerformActionInput,
  type FacilitatorSettleInput,
  type FacilitatorVerifyInput,
} from "@bosonprotocol/x402-facilitator";
import { Router, type RequestHandler } from "express";

export interface MountFacilitatorOptions {
  /** Optional mount path. Defaults to `/`. */
  basePath?: string;
}

/**
 * Build the Express router. Apply with
 * `app.use(mountFacilitator(config, opts))`.
 */
export function mountFacilitator(
  config: FacilitatorConfig,
  opts: MountFacilitatorOptions = {},
): Router {
  const router = Router();
  const basePath = opts.basePath ?? "";

  router.post(`${basePath}/verify`, verifyRoute(config));
  router.post(`${basePath}/settle`, settleRoute(config));
  router.post(`${basePath}/perform-action`, performActionRoute(config));

  return router;
}

function verifyRoute(config: FacilitatorConfig): RequestHandler {
  return async (req, res, next) => {
    try {
      // Body shape is validated downstream by the facilitator's Zod
      // schemas; here we only guard against the body being absent so
      // `verify(undefined, …)` doesn't blow up before structural
      // validation kicks in.
      const body = req.body as FacilitatorVerifyInput | undefined;
      if (body === undefined) {
        res.status(400).json({
          code: "INVALID_REQUEST_BODY",
          reason: "expected JSON body — did you install express.json()?",
        });
        return;
      }
      const result = await verify(body, config);
      res.status(result.ok ? 200 : 400).json(result);
    } catch (e) {
      next(e);
    }
  };
}

function settleRoute(config: FacilitatorConfig): RequestHandler {
  return async (req, res, next) => {
    try {
      const body = req.body as FacilitatorSettleInput | undefined;
      if (body === undefined) {
        res.status(400).json({
          code: "INVALID_REQUEST_BODY",
          reason: "expected JSON body — did you install express.json()?",
        });
        return;
      }
      const result = await settle(body, config);
      res.status(result.ok ? 200 : 400).json(result);
    } catch (e) {
      next(e);
    }
  };
}

function performActionRoute(config: FacilitatorConfig): RequestHandler {
  return async (req, res, next) => {
    try {
      const body = req.body as FacilitatorPerformActionInput | undefined;
      if (body === undefined) {
        res.status(400).json({
          code: "INVALID_REQUEST_BODY",
          reason: "expected JSON body — did you install express.json()?",
        });
        return;
      }
      const result = await performAction(body, config);
      res.status(result.ok ? 200 : 400).json(result);
    } catch (e) {
      next(e);
    }
  };
}
