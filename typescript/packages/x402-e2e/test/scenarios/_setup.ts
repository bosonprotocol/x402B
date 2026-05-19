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

import { createResourceServerApp, readEnv } from "@bosonprotocol/x402-example-resource-server";
import { type AddressInfo } from "node:net";
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
  type BuyerActor,
  type OnchainAsserter,
  type ResolverActor,
  type SellerActor,
} from "../../src/harness/index.js";

import { SUITE_STATE_ENV } from "../setup/globalSetup.js";

export interface ScenarioContextArgs {
  /** Override the seller `LocalAccount`. Defaults to `ROLE_ACCOUNTS.seller`. */
  sellerAccount?: LocalAccount;
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

export async function createScenarioContext(
  args: ScenarioContextArgs = {},
): Promise<ScenarioContext> {
  const sellerAccount = args.sellerAccount ?? privateKeyToAccount(ROLE_ACCOUNTS.seller.privateKey);
  const buyerAccount = args.buyerAccount ?? privateKeyToAccount(ROLE_ACCOUNTS.buyer.privateKey);
  const resolverAccount =
    args.resolverAccount ?? privateKeyToAccount(ROLE_ACCOUNTS.resolver.privateKey);

  const suite = {
    sellerId: requireSuiteEnv(SUITE_STATE_ENV.sellerId),
    sellerAddress: requireSuiteEnv(SUITE_STATE_ENV.sellerAddress) as `0x${string}`,
    disputeResolverId: requireSuiteEnv(SUITE_STATE_ENV.disputeResolverId),
  };

  const publicClient = buildPublicClient();
  const exchangeReader = createSubgraphExchangeReader();
  const asserter = createOnchainAsserter(exchangeReader);

  // Bind to port 0 so the OS picks a free port; tests use the
  // returned URL directly. The address() call below is synchronous
  // once the server emits `listening`.
  const env: ResourceServerEnv = {
    publicUrl: "http://127.0.0.1:0",
    rpcNode: LOCAL_31337_0.urls.jsonRpc,
    chainId: LOCAL_31337_0.chainId,
    network: LOCAL_31337_0.network,
    escrowAddress: LOCAL_31337_0.contracts.protocolDiamond,
    facilitatorUrl: "http://127.0.0.1:8889",
    sellerPk: ROLE_ACCOUNTS.seller.privateKey,
    sellerId: suite.sellerId,
    disputeResolverId: suite.disputeResolverId,
    assetAddress: args.assetAddress ?? LOCAL_31337_0.contracts.testErc20,
    amount: args.amount ?? "1000000",
    maxTimeoutSeconds: args.maxTimeoutSeconds ?? 3600,
    subgraphUrl: LOCAL_31337_0.urls.subgraph,
    port: 0,
  };

  const { app } = createResourceServerApp(env, { exchangeReader });
  const httpServer = app.listen(0);
  await new Promise<void>((resolve, reject) => {
    httpServer.once("listening", resolve);
    httpServer.once("error", reject);
  });
  const address = httpServer.address() as AddressInfo;
  const resourceServerUrl = `http://127.0.0.1:${address.port}`;

  const seller = createSellerActor({ account: sellerAccount });
  const buyer = createBuyerActor({ account: buyerAccount, publicClient });
  const resolver = createResolverActor({ account: resolverAccount });

  return {
    resourceServerUrl,
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
