// Shared per-test scaffolding for the scenario suite. Each scenario
// file's `beforeAll` constructs a `ScenarioContext` and tears it down
// in `afterAll`. The context wires:
//
//   - Resource server (in-process via `createResourceServerApp`)
//     listening on an OS-assigned port so parallel test files don't
//     collide on a fixed port.
//   - SellerActor / BuyerActor / ResolverActor against the wallets
//     from `ROLE_ACCOUNTS`.
//   - Subgraph-backed `ExchangeReader` + `OnchainAsserter`.
//
// The resource server is in-process (not the `x402b-resource-server`
// compose service) so each scenario can reconfigure `SELLER_ID`,
// `ASSET_ADDRESS`, etc. with the seeded state. The compose service
// stays available for manual smoke testing.

import {
  createResourceServerApp,
  fetchProtocolConfig,
  readEnv,
} from "@bosonprotocol/x402-example-resource-server";
import type { Policy, TokenDomainResolver } from "@bosonprotocol/x402-client";
import type { TokenAuthStrategy } from "@bosonprotocol/x402-core/schemes/escrow";
import { createServer, type AddressInfo } from "node:net";
import { privateKeyToAccount, type LocalAccount } from "viem/accounts";

/** `ResourceServerEnv` isn't re-exported from the example's barrel; derive it from `readEnv`'s return type. */
type ResourceServerEnv = ReturnType<typeof readEnv>;

import { ROLE_ACCOUNTS } from "../../src/config/accounts.js";
import { LOCAL_31337_0 } from "../../src/config/local-31337-0.js";
import {
  buildPublicClient,
  createBuyerActor,
  createOnchainAsserter,
  createResolverActor,
  createSellerActor,
  createSubgraphExchangeReader,
  withPollUntilFound,
  type BuyerActor,
  type OnchainAsserter,
  type ResolverActor,
  type SellerActor,
} from "../../src/harness/index.js";

import { SUITE_STATE_ENV } from "../setup/globalSetup.js";

import { SEED_WALLETS, getSellerInfo, type SeedWalletName } from "./_seed-wallets.js";

const LOCALHOST_HTTP = "http://127.0.0.1";

export interface ScenarioContextArgs {
  /**
   * Per-file seed-wallet slot. The slot's account is the registered seller
   * (its `sellerId` was published by `globalSetup`) and supplies the
   * `sellerPk` the in-process resource server signs FullOffer templates
   * with. Two chain-touching test files MUST NOT pick the same slot —
   * see `_seed-wallets.ts`.
   */
  slot: SeedWalletName;
  /**
   * Buyer `LocalAccount` — typically a fresh random EOA built via
   * `createFundedBuyer({ funder: SEED_WALLETS[slot].account, … })` so each
   * describe transacts from its own nonce space.
   */
  buyerAccount: LocalAccount;
  /** Override the resolver `LocalAccount`. Defaults to `ROLE_ACCOUNTS.resolver`. */
  resolverAccount?: LocalAccount;
  /** Override `ASSET_ADDRESS`. Defaults to the test ERC-20 (`testErc20`). */
  assetAddress?: `0x${string}`;
  /** Override `AMOUNT`. Defaults to `"1000000"` (1 USDC at 6dp). */
  amount?: string;
  /** Override `MAX_TIMEOUT_SECONDS`. Defaults to `3600`. */
  maxTimeoutSeconds?: number;
  /**
   * Override the strategies the in-process resource server advertises
   * in its 402 challenge. Defaults to the full set when omitted (the
   * example's `DEFAULT_TOKEN_AUTH_STRATEGIES`). Tests that exercise
   * a specific strategy (A3 ERC-3009, A4 Permit, A5 Permit2) narrow
   * the list to force the client dispatcher's hand.
   */
  tokenAuthStrategies?: readonly TokenAuthStrategy[];
  /**
   * Optional `TokenDomainResolver` plumbed into the BuyerActor's
   * `X402bClient`. Required by the client dispatcher for ERC-3009 and
   * EIP-2612 Permit; omitted scenarios fall back to Permit2 (which
   * needs no resolver).
   */
  tokenDomainResolver?: TokenDomainResolver;
  /**
   * Optional `Policy` override for the BuyerActor. Use this to pin a
   * specific `tokenAuthStrategy` (e.g. `"none"` so the buyer doesn't
   * sign a token-auth payload, and the protocol pulls funds via a
   * standing ERC-20 allowance) or to switch `redeemMode` for atomic
   * commit-and-redeem scenarios.
   */
  buyerPolicy?: Policy;
}

export interface ScenarioContext {
  /** Public URL of the in-process resource server (`http://127.0.0.1:<port>`). */
  resourceServerUrl: string;
  /** Facilitator HTTP service (compose-service URL). Used by scenarios that bypass the resource server. */
  facilitatorUrl: string;
  /** CAIP-2 network id (`eip155:31337` for the local stack). */
  network: `eip155:${number}`;
  /** Escrow address baked into requirements + EIP-712 domain. */
  escrowAddress: `0x${string}`;
  seller: SellerActor;
  buyer: BuyerActor;
  resolver: ResolverActor;
  asserter: OnchainAsserter;
  /** Resolved suite state pulled from `globalSetup`'s env exports. */
  suite: { sellerId: string; sellerAddress: `0x${string}`; disputeResolverId: string };
  /** Stop the in-process resource server. Call in `afterAll`. */
  teardown: () => Promise<void>;
}

function requireSuiteEnv(key: string): string {
  const v = process.env[key];
  if (v === undefined || v.length === 0) {
    throw new Error(
      `[x402-e2e/scenarios] missing ${key} — did globalSetup run? (set E2E_DOCKER=1)`,
    );
  }
  return v;
}

/**
 * Reserve a free TCP port on 127.0.0.1 by binding a throwaway server to port 0,
 * reading the OS-assigned port, then releasing it. The resource server bakes
 * `publicUrl` into ChannelRegistry endpoints at construction time, so we need
 * the real port *before* calling `createResourceServerApp`. The brief gap
 * between close and re-listen has a theoretical TOCTOU race, but it's
 * acceptable for the in-process test scaffolding.
 */
async function allocateFreePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve, reject) => {
    probe.once("listening", resolve);
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1");
  });
  const port = (probe.address() as AddressInfo).port;
  await new Promise<void>((resolve, reject) => {
    probe.close((err) => (err ? reject(err) : resolve()));
  });
  return port;
}

export async function createScenarioContext(args: ScenarioContextArgs): Promise<ScenarioContext> {
  const slot = SEED_WALLETS[args.slot];
  const sellerPk = slot.privateKey;
  const sellerAccount = slot.account;
  const buyerAccount = args.buyerAccount;
  const resolverAccount =
    args.resolverAccount ?? privateKeyToAccount(ROLE_ACCOUNTS.resolver.privateKey);

  const sellerInfo = getSellerInfo(args.slot);
  const suite = {
    sellerId: sellerInfo.id,
    sellerAddress: sellerInfo.address as `0x${string}`,
    disputeResolverId: requireSuiteEnv(SUITE_STATE_ENV.disputeResolverId),
  };

  const publicClient = buildPublicClient();
  // The local boson-subgraph container's indexer typically needs 1–5 s
  // to ingest a freshly-mined block; `@bosonprotocol/x402-server`'s
  // default `verifyExchange` retry budget (3 × 50 ms) gives up well
  // before that, surfacing as `STATE_VERIFY_EXCHANGE_NOT_FOUND` on
  // every commit. Plumbing `publicClient` into the reader gives it
  // the chain head it needs to call `waitForGraphNodeIndexing(block)`
  // on a miss — the canonical "indexer caught up" wait. The
  // `withPollUntilFound` outer wrapper backs the indexer-wait path
  // with a bounded retry so a transient subgraph hiccup doesn't
  // collapse straight into `STATE_VERIFY_EXCHANGE_NOT_FOUND`.
  const exchangeReader = withPollUntilFound(createSubgraphExchangeReader({ publicClient }));
  const asserter = createOnchainAsserter(exchangeReader);

  // Reserve a real port up front: `createResourceServerApp` builds the
  // ChannelRegistry (and stamps `publicUrl` into every server-channel
  // endpoint URL) at construction time, so a `:0` placeholder would
  // bake an unreachable port into `nextActions`.
  const port = await allocateFreePort();
  const resourceServerUrl = `${LOCALHOST_HTTP}:${port}`;
  const env: ResourceServerEnv = {
    publicUrl: resourceServerUrl,
    rpcNode: LOCAL_31337_0.urls.jsonRpc,
    chainId: LOCAL_31337_0.chainId,
    network: LOCAL_31337_0.network,
    escrowAddress: LOCAL_31337_0.contracts.protocolDiamond,
    facilitatorUrl: `${LOCALHOST_HTTP}:8889`,
    sellerPk,
    sellerId: suite.sellerId,
    disputeResolverId: suite.disputeResolverId,
    assetAddress: args.assetAddress ?? LOCAL_31337_0.contracts.testErc20,
    amount: args.amount ?? "1000000",
    maxTimeoutSeconds: args.maxTimeoutSeconds ?? 3600,
    subgraphUrl: LOCAL_31337_0.urls.subgraph,
    port,
  };

  // Tighten the in-process offer's `feeLimit` cap + `disputePeriodDurationInMS`
  // floor against the live `ConfigHandlerFacet` values. The compose-service
  // entrypoint does the same fetch in `src/bin/resource-server.ts`.
  const protocolConfig = await fetchProtocolConfig({
    publicClient,
    escrowAddress: env.escrowAddress,
  });

  const { app } = createResourceServerApp(env, {
    exchangeReader,
    protocolConfig,
    ...(args.tokenAuthStrategies !== undefined
      ? { tokenAuthStrategies: args.tokenAuthStrategies }
      : {}),
  });
  const httpServer = app.listen(port);
  await new Promise<void>((resolve, reject) => {
    httpServer.once("listening", resolve);
    httpServer.once("error", reject);
  });

  const seller = createSellerActor({ account: sellerAccount });
  const buyer = createBuyerActor({
    account: buyerAccount,
    publicClient,
    ...(args.tokenDomainResolver !== undefined
      ? { tokenDomainResolver: args.tokenDomainResolver }
      : {}),
    ...(args.buyerPolicy !== undefined ? { policy: args.buyerPolicy } : {}),
  });
  const resolver = createResolverActor({ account: resolverAccount });

  return {
    resourceServerUrl,
    facilitatorUrl: env.facilitatorUrl,
    network: env.network,
    escrowAddress: env.escrowAddress,
    seller,
    buyer,
    resolver,
    asserter,
    suite,
    teardown: () =>
      new Promise<void>((resolve, reject) => {
        httpServer.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
