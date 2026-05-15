// `createResourceServerApp` — assembles the example Express host.
//
// Two surfaces:
//
// 1. **Programmatic** — the e2e suite imports this function directly
//    and injects a real `exchangeReader` (and any other test-time
//    overrides) via `overrides`. The placeholder reader is bypassed.
// 2. **Binary** — `src/index.ts` reads env, calls this function with
//    no overrides, and listens. The placeholder reader makes the
//    402 challenge path work without a subgraph configured.

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
import { createPlaceholderExchangeReader } from "./exchange-reader.js";
import { buildUnsignedOffer } from "./offer.js";

export interface ResourceServerAppOptions {
  /**
   * Replace the placeholder `ExchangeReader` with a real one. Required
   * in any context that exercises the write handlers
   * (`commit` / `redeem` / `complete` / `dispute/*`).
   */
  exchangeReader?: ExchangeReader;
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
  options: ResourceServerAppOptions = {},
): ResourceServerAppBundle {
  const seller = privateKeyToAccount(env.sellerPk);
  const exchangeReader = options.exchangeReader ?? createPlaceholderExchangeReader();
  const now = options.now ?? Date.now;

  const server = createX402bServer(buildServerConfig(env, seller, exchangeReader));

  const resolveRequirements = async (_req: Request) =>
    server.buildPaymentRequirements({
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
