// `createResourceServerApp` — assembles the example Express host.
//
// A real `ExchangeReader` is **required**: the convenience handlers in
// `@bosonprotocol/x402-server` (commit, redeem, complete, dispute/*)
// forward the buyer's signed payload to the facilitator's `/settle`
// *before* they read post-settle state through the reader. A reader
// that always returns `null` would let a valid `X-PAYMENT` settle
// on-chain and then return `STATE_VERIFY_EXCHANGE_NOT_FOUND` — the
// buyer is irreversibly charged but receives no resource. So we refuse
// to build the app without one rather than ship an "easy demo" that
// silently strands buyers' funds.
//
// Two surfaces:
//
// 1. **Programmatic** — the e2e suite imports this function directly
//    and injects a real `exchangeReader` (and any other test-time
//    overrides) via `options`.
// 2. **Binary** — `src/index.ts` reads env, constructs a reader, calls
//    this function, and listens. The binary refuses to start if no
//    reader can be built from the env (see README).

import type { EscrowPaymentRequirements } from "@bosonprotocol/x402-core/schemes/escrow";
import {
  createX402bServer,
  type ExchangeReader,
  type X402bServer,
  type X402bServerConfig,
} from "@bosonprotocol/x402-server";
import { expressMiddleware, mountX402b } from "@bosonprotocol/x402-server-express";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { privateKeyToAccount, type LocalAccount } from "viem/accounts";

import { buildExampleChannelRegistry } from "./channel-registry.js";
import type { ResourceServerEnv } from "./config.js";
import { buildUnsignedOffer } from "./offer.js";

export interface ResourceServerAppOptions {
  /**
   * Post-settle state reader. Required — without it, a valid
   * `X-PAYMENT` retry would settle on-chain before any verification
   * runs, charging the buyer with no resource delivered.
   */
  exchangeReader: ExchangeReader;
  /** Replace `Date.now()` for deterministic offer-validity windows in tests. */
  now?: () => number;
}

export interface ResourceServerAppBundle {
  app: Express;
  server: X402bServer;
  seller: LocalAccount;
}

function buildServerConfig(
  env: ResourceServerEnv,
  seller: LocalAccount,
  exchangeReader: ExchangeReader,
): X402bServerConfig {
  return {
    network: env.network,
    chainId: env.chainId,
    escrow: env.escrowAddress,
    signer: seller,
    facilitator: { url: env.facilitatorUrl },
    channelRegistry: buildExampleChannelRegistry(env),
    exchangeReader,
    ...(env.subgraphUrl !== undefined ? { subgraphUrl: env.subgraphUrl } : {}),
  };
}

export function createResourceServerApp(
  env: ResourceServerEnv,
  options: ResourceServerAppOptions,
): ResourceServerAppBundle {
  const seller = privateKeyToAccount(env.sellerPk);
  const exchangeReader = options.exchangeReader;
  const now = options.now ?? Date.now;

  const server = createX402bServer(buildServerConfig(env, seller, exchangeReader));

  // The Express adapters call `resolveRequirements` twice per buyer
  // commit flow (once for the 402 challenge, once when the buyer
  // retries with `X-PAYMENT`). The validator deep-equals
  // `payload.offerRef.fullOffer` against `requirements.offer.fullOffer`
  // and strict-equals the `sellerSig`, so the settle call must see the
  // same signed offer the challenge emitted. Cache it and refresh
  // lazily a few minutes before the offer's on-chain validity ends so
  // an in-flight buyer commit can't race the expiry boundary.
  const REFRESH_MARGIN_MS = 5 * 60 * 1000;
  let cached: { promise: Promise<EscrowPaymentRequirements>; expiresAt: number } | undefined;

  const resolveRequirements = async (_req: Request) => {
    if (cached !== undefined && now() < cached.expiresAt) return cached.promise;

    const promise = server.buildPaymentRequirements({
      offer: { unsigned: buildUnsignedOffer({ env, sellerAddress: seller.address, now: now() }) },
      asset: env.assetAddress,
      amount: env.amount,
      // Settle path is end-to-end runnable only for `none` today; the
      // other strategies are advertised so the buyer can pick one once
      // the BPIP-12 envelope ships in the facilitator.
      tokenAuthStrategies: ["none", "erc3009", "permit", "permit2"],
      recipientId: env.sellerId,
      maxTimeoutSeconds: env.maxTimeoutSeconds,
    });

    // Assign before awaiting so concurrent challenge/settle callers
    // join the same in-flight build; `expiresAt` is provisional until
    // the build resolves.
    const entry = { promise, expiresAt: Number.MAX_SAFE_INTEGER };
    cached = entry;
    try {
      const requirements = await promise;
      entry.expiresAt = Number(requirements.offer.fullOffer.validUntilDateInMS) - REFRESH_MARGIN_MS;
    } catch (e) {
      if (cached === entry) cached = undefined;
      throw e;
    }
    return promise;
  };

  const app = express();
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/config", async (_req, res, next) => {
    try {
      res.json(await resolveRequirements(_req));
    } catch (e) {
      next(e);
    }
  });

  app.get("/resource", expressMiddleware(server, { resolveRequirements }), (_req, res) => {
    res.json({
      ok: true,
      x402b: res.locals.x402b,
      resource: "example resource bytes",
    });
  });

  app.use(mountX402b(server, { resolveRequirements }));

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const status =
      typeof err === "object" && err !== null && "status" in err && typeof err.status === "number"
        ? err.status
        : 500;
    const message =
      err instanceof Error ? err.message : typeof err === "string" ? err : "Internal Server Error";
    res.status(status).json({ error: message });
  });

  return { app, server, seller };
}
