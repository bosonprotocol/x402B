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

import { SESSION_ID_HEADER } from "@bosonprotocol/x402-core";
import type {
  EscrowPaymentRequirements,
  TokenAuthStrategy,
} from "@bosonprotocol/x402-core/schemes/escrow";
import { evmEscrowPaywall } from "@bosonprotocol/x402-paywall";
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
import type { ProtocolConfig } from "./protocol-config.js";

export interface ResourceServerAppOptions {
  /**
   * Post-settle state reader. Required — without it, a valid
   * `X-PAYMENT` retry would settle on-chain before any verification
   * runs, charging the buyer with no resource delivered.
   */
  exchangeReader: ExchangeReader;
  /** Replace `Date.now()` for deterministic offer-validity windows in tests. */
  now?: () => number;
  /**
   * Optional on-chain `ConfigHandlerFacet` slice for tightening
   * `feeLimit` and flooring `disputePeriodDurationInMS`. Production
   * forks should fetch this once at boot via `fetchProtocolConfig`.
   * Omitted in unit tests that don't have a live chain.
   */
  protocolConfig?: ProtocolConfig;
  /**
   * Token-auth strategies the host advertises in the 402 challenge.
   * Defaults to the full set `["none", "erc3009", "permit", "permit2"]`
   * so a forked deployment that pairs the example with a stock buyer
   * gets the canonical client-preference order. Tests that need to
   * isolate a single strategy (e.g. assert ERC-3009 is exercised
   * end-to-end against a specific token mock) pass a narrower list.
   */
  tokenAuthStrategies?: readonly TokenAuthStrategy[];
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

const DEFAULT_TOKEN_AUTH_STRATEGIES: readonly TokenAuthStrategy[] = [
  "none",
  "erc3009",
  "permit",
  "permit2",
];

export function createResourceServerApp(
  env: ResourceServerEnv,
  options: ResourceServerAppOptions,
): ResourceServerAppBundle {
  const seller = privateKeyToAccount(env.sellerPk);
  const exchangeReader = options.exchangeReader;
  const now = options.now ?? Date.now;
  const protocolConfig = options.protocolConfig;
  const tokenAuthStrategies = options.tokenAuthStrategies ?? DEFAULT_TOKEN_AUTH_STRATEGIES;

  const server = createX402bServer(buildServerConfig(env, seller, exchangeReader));

  // The Express adapters call `resolveRequirements` twice per buyer
  // commit flow (once for the 402 challenge, once when the buyer
  // retries with `X-PAYMENT`). The validator deep-equals
  // `payload.offerRef.fullOffer` against `requirements.offer.fullOffer`
  // and strict-equals the `sellerSig`, so the settle call must see the
  // same signed offer the challenge emitted.
  //
  // We scope that "same signed offer" to a single buyer flow via the
  // `SESSION_ID_HEADER` `@bosonprotocol/x402-client-fetch` stamps on
  // both requests of a 402-retry pair (Express's `req.header()` is
  // case-insensitive, so the canonical mixed-case constant works for
  // the lookup). A short per-session TTL bounds memory and lets the
  // cache invalidate naturally between unrelated commits (without it,
  // a sequential second commit hits the cached offer and reverts
  // `OfferSoldOut` on a single-quantity template). Clients that don't
  // honour the header share the `FALLBACK_KEY` slot and get the
  // previous time-based behaviour, so the change is backwards-
  // compatible for non-x402b consumers.
  const FALLBACK_KEY = "__no_session__";
  const SESSION_CACHE_TTL_BUFFER_MS = 5_000;
  const SESSION_CACHE_MIN_TTL_MS = 60_000;
  const derivedSessionCacheTtlMs = env.maxTimeoutSeconds * 1_000 + SESSION_CACHE_TTL_BUFFER_MS;
  const SESSION_CACHE_TTL_MS =
    Number.isFinite(derivedSessionCacheTtlMs) && derivedSessionCacheTtlMs > 0
      ? Math.max(SESSION_CACHE_MIN_TTL_MS, derivedSessionCacheTtlMs)
      : SESSION_CACHE_MIN_TTL_MS;
  const MAX_SESSION_ID_LENGTH = 128;
  const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
  const MAX_SESSION_CACHE_ENTRIES = 256;
  type SessionCacheEntry = {
    promise: Promise<EscrowPaymentRequirements>;
    expiresAt: number;
  };
  const sessionCache = new (class extends Map<string, SessionCacheEntry> {
    override set(key: string, value: SessionCacheEntry) {
      const currentTime = now();
      for (const [cacheKey, entry] of this) {
        if (currentTime >= entry.expiresAt) {
          this.delete(cacheKey);
        }
      }
      if (this.has(key)) {
        this.delete(key);
      } else {
        while (this.size >= MAX_SESSION_CACHE_ENTRIES) {
          const oldestKey = this.keys().next().value;
          if (typeof oldestKey !== "string") {
            break;
          }
          this.delete(oldestKey);
        }
      }
      return super.set(key, value);
    }
  })();

  const pruneExpiredSessions = () => {
    const currentTime = now();
    for (const [cacheKey, entry] of sessionCache) {
      if (currentTime >= entry.expiresAt) {
        sessionCache.delete(cacheKey);
      }
    }
  };

  const normalizeSessionId = (req: Request) => {
    // Express lowercases incoming header names. Coerce to string and
    // trim — empty / whitespace-only / invalid ids fall through to the
    // shared slot to avoid unbounded attacker-controlled key growth.
    const rawSessionId = req.header(SESSION_ID_HEADER);
    const trimmedSessionId = typeof rawSessionId === "string" ? rawSessionId.trim() : "";
    if (
      trimmedSessionId.length === 0 ||
      trimmedSessionId.length > MAX_SESSION_ID_LENGTH ||
      !SESSION_ID_PATTERN.test(trimmedSessionId)
    ) {
      return FALLBACK_KEY;
    }
    return trimmedSessionId;
  };

  const resolveRequirements = async (req: Request) => {
    pruneExpiredSessions();
    const sessionId = normalizeSessionId(req);

    const existing = sessionCache.get(sessionId);
    if (existing !== undefined) {
      sessionCache.set(sessionId, existing);
      return existing.promise;
    }

    const promise = server.buildPaymentRequirements({
      offer: {
        unsigned: buildUnsignedOffer({
          env,
          sellerAddress: seller.address,
          now: now(),
          sessionId,
          ...(protocolConfig !== undefined ? { protocolConfig } : {}),
        }),
      },
      asset: env.assetAddress,
      amount: env.amount,
      // BPIP-12's `executeMetaTransactionWithTokenTransferAuthorization`
      // has shipped, so any of the four strategies is end-to-end
      // settle-able when the matching token is in scope. Forks narrow
      // the advertised set via `ResourceServerAppOptions.tokenAuthStrategies`
      // when the asset only supports a subset (e.g. a non-EIP-3009 ERC-20).
      tokenAuthStrategies,
      recipientId: env.sellerId,
      maxTimeoutSeconds: env.maxTimeoutSeconds,
    });

    // Assign before awaiting so a concurrent retry on the same session
    // id joins the in-flight build; `expiresAt` is provisional until
    // the build resolves.
    const entry = { promise, expiresAt: Number.MAX_SAFE_INTEGER };
    sessionCache.set(sessionId, entry);
    try {
      await promise;
      entry.expiresAt = now() + SESSION_CACHE_TTL_MS;
    } catch (e) {
      if (sessionCache.get(sessionId) === entry) sessionCache.delete(sessionId);
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

  // Browser paywall branch — emitted only when (a) the buyer hasn't
  // already signed an X-PAYMENT header for the retry, and (b) the
  // Accept negotiation explicitly prefers `text/html` over
  // `application/json`. The `['json', 'html']` argument order means a
  // missing-or-`*/*` Accept resolves to `'json'`, so non-browser
  // callers (the e2e harness, raw curl, any client without an Accept
  // header) keep getting the existing JSON 402 — only browsers that
  // listed `text/html` ahead of catch-all flip to the HTML body.
  //
  // `currentUrl` is derived from the inbound request rather than
  // `env.publicUrl` so it matches the browser's view of the origin —
  // `env.publicUrl` may point at `host.docker.internal:4001` (used by
  // facilitator-side callbacks inside the compose network), which the
  // browser running on the host can't resolve.
  const paywallBranch = async (req: Request, res: Response, next: NextFunction) => {
    if (req.header("X-PAYMENT") !== undefined) {
      next();
      return;
    }
    if (req.accepts(["json", "html"]) !== "html") {
      next();
      return;
    }
    try {
      const requirements = await resolveRequirements(req);
      const host = req.get("host");
      const currentUrl = host
        ? `${req.protocol}://${host}${req.originalUrl}`
        : env.publicUrl + req.originalUrl;
      const html = evmEscrowPaywall.generateHtml({ requirements, currentUrl }, env.paywallConfig);
      res.status(402).type("html").send(html);
    } catch (e) {
      next(e);
    }
  };

  app.get(
    "/resource",
    paywallBranch,
    expressMiddleware(server, { resolveRequirements }),
    (_req, res) => {
      res.json({
        ok: true,
        x402b: res.locals.x402b,
        resource: "example resource bytes",
      });
    },
  );

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
