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
import { createServer, type AddressInfo } from "node:net";
import { type Hex } from "viem";
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

const LOCALHOST_HTTP = "http://127.0.0.1";

export interface ScenarioContextArgs {
  /**
   * Override the seller private key. Defaults to `ROLE_ACCOUNTS.seller.privateKey`.
   * Taken as a raw key (not a `LocalAccount`) so the same identity drives both
   * the `SellerActor` and the in-process resource server's `sellerPk`.
   */
  sellerPk?: Hex;
  /** Override the buyer `LocalAccount`. Defaults to `ROLE_ACCOUNTS.buyer`. */
  buyerAccount?: LocalAccount;
  /** Override the resolver `LocalAccount`. Defaults to `ROLE_ACCOUNTS.resolver`. */
  resolverAccount?: LocalAccount;
  /** Override `ASSET_ADDRESS`. Defaults to the test ERC-20 (`testErc20`). */
  assetAddress?: `0x${string}`;
  /** Override `AMOUNT`. Defaults to `"1000000"` (1 USDC at 6dp). */
  amount?: string;
  /** Override `MAX_TIMEOUT_SECONDS`. Defaults to `3600`. */
  maxTimeoutSeconds?: number;
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

export async function createScenarioContext(
  args: ScenarioContextArgs = {},
): Promise<ScenarioContext> {
  const sellerPk = args.sellerPk ?? ROLE_ACCOUNTS.seller.privateKey;
  const sellerAccount = privateKeyToAccount(sellerPk);
  const buyerAccount = args.buyerAccount ?? privateKeyToAccount(ROLE_ACCOUNTS.buyer.privateKey);
  const resolverAccount =
    args.resolverAccount ?? privateKeyToAccount(ROLE_ACCOUNTS.resolver.privateKey);

  const suite = {
    sellerId: requireSuiteEnv(SUITE_STATE_ENV.sellerId),
    sellerAddress: requireSuiteEnv(SUITE_STATE_ENV.sellerAddress) as `0x${string}`,
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

  const { app } = createResourceServerApp(env, { exchangeReader, protocolConfig });
  const httpServer = app.listen(port);
  await new Promise<void>((resolve, reject) => {
    httpServer.once("listening", resolve);
    httpServer.once("error", reject);
  });

  const seller = createSellerActor({ account: sellerAccount });
  const buyer = createBuyerActor({ account: buyerAccount, publicClient });
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
