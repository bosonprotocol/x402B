// Boot entrypoint for the `x402b-resource-server` compose service.
//
// `@bosonprotocol/x402-example-resource-server`'s own `index.ts`
// refuses to start because it intentionally ships no `ExchangeReader`.
// This entrypoint provides one — the subgraph-backed reader from
// `src/harness/exchange-reader.ts`, which queries the
// `boson-subgraph` container's GraphQL endpoint via
// `@bosonprotocol/core-sdk`'s `getExchangeById`.
//
// The reader's subgraph URL comes from the `SUBGRAPH_URL` env the
// canonical compose already wires to the in-container subgraph
// endpoint (`http://host.docker.internal:8000/subgraphs/name/boson/corecomponents`).
//
// Seller self-seeding: the example's `readEnv` requires a `SELLER_ID`,
// but on a fresh devnet stack the seller entity behind the configured
// `SELLER_PK` doesn't exist yet — and the on-chain numeric id can't be
// known until `createSeller` has been called. The entrypoint mirrors
// the harness's `seedSuite` flow: look up the subgraph for a seller
// whose `assistant` matches `SELLER_PK`'s address, call `createSeller`
// when absent, then override `env.sellerId` with the resolved id
// before constructing the app. Without this step, the buyer's
// `createOfferAndCommit` reverts `NotAssistant()` because the recovered
// `offer.creator` isn't a registered assistant on chain. Idempotent —
// a re-boot against a stack where the seller already exists is a
// no-op lookup.

import { privateKeyToAccount } from "viem/accounts";
import { getAddress, type Address, type Hex, type PublicClient } from "viem";

import { CoreSDK } from "@bosonprotocol/core-sdk";
import { asCoreSdkReadAdapter } from "@bosonprotocol/x402-server";
import {
  createResourceServerApp,
  fetchProtocolConfig,
  readEnv,
  type ProtocolConfig,
} from "@bosonprotocol/x402-example-resource-server";

import { buildPublicClient, buildWalletClient } from "../harness/clients.js";
import { buildCreateSellerCallback } from "../harness/create-seller.js";
import { createSubgraphExchangeReader } from "../harness/exchange-reader.js";
import { ensureTokenBalance } from "../harness/fund.js";
import { seedSuite } from "../harness/seed.js";

// `docker compose up --wait` only blocks until each container reports
// healthy; the contracts inside `boson-protocol-node` are still
// deploying asynchronously when this entrypoint starts. The deploy
// script proceeds in stages — Diamond bytecode appears first, then
// each facet is cut into the Diamond, and finally `ConfigHandlerFacet`
// is initialized — so we gate boot in two stages:
//
//   1. Poll `eth_getCode` until the Diamond is on chain (otherwise the
//      first `readContract` returns `0x` and crashes).
//   2. Poll `fetchProtocolConfig` until the call succeeds AND returns
//      non-zero values — facet-cut races surface as `readContract`
//      reverts ("Diamond: Function does not exist"), and an
//      uninitialized `ConfigHandlerFacet` returns `0` for both fields.
//
// Mirrors the docker-exec-based `/app/deploy.done` probe in
// `src/stack/readiness.ts` over RPC, since the compose-service
// entrypoint can't `docker compose exec` against the protocol node.
const ESCROW_DEPLOY_TIMEOUT_MS = 10 * 60_000;
const ESCROW_DEPLOY_POLL_INTERVAL_MS = 2_000;

// The `boson-subgraph` (graph-node) container reports healthy long
// before the `boson/corecomponents` subgraph has been deployed and
// indexed up to the chain head. Cold subgraph deploys can take a
// while, so reuse the same generous 10-minute ceiling as the escrow /
// config gates.
const SUBGRAPH_READY_TIMEOUT_MS = 10 * 60_000;
const SUBGRAPH_READY_POLL_INTERVAL_MS = 2_000;

/** CoreSDK exposes `waitForGraphNodeIndexing` via the subgraph mixin; narrow to that surface. */
interface CoreSdkWithIndexerWait {
  waitForGraphNodeIndexing(blockNumber?: number): Promise<void>;
}

/**
 * Throwing `Web3LibAdapter` stub — read-only paths through CoreSDK
 * never invoke `web3Lib`, so any access surfaces as a loud error
 * rather than a silent network call. Mirrors the stubs in
 * `src/harness/seed.ts` and `src/harness/exchange-reader.ts`.
 */
function createReadOnlyWeb3LibStub(): never {
  const handler: ProxyHandler<object> = {
    get(_target, prop) {
      throw new Error(
        `[x402-e2e/resource-server] read-only CoreSDK should not invoke web3Lib.${String(prop)}`,
      );
    },
  };
  return new Proxy({}, handler) as never;
}

// Target balance minted to each `BUYER_WALLETS` entry on boot. 100 USDC
// at 6dp = 100× the default offer price (AMOUNT=1000000), so a browser
// demo can pay ~100 times before re-funding — well above the "repeat
// ≥20×" requirement.
const BUYER_FUND_AMOUNT = 100_000_000n;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForEscrowDeployed(args: {
  publicClient: PublicClient;
  escrowAddress: Address;
}): Promise<void> {
  const deadline = Date.now() + ESCROW_DEPLOY_TIMEOUT_MS;
  console.log(
    `[x402-e2e/resource-server] waiting for escrow ${args.escrowAddress} to be deployed…`,
  );
  while (true) {
    try {
      const code = await args.publicClient.getCode({ address: args.escrowAddress });
      if (code !== undefined && code !== "0x") {
        console.log(`[x402-e2e/resource-server] escrow ${args.escrowAddress} is deployed`);
        return;
      }
    } catch {
      // RPC not ready (boson-protocol-node still booting) — keep polling.
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `[x402-e2e/resource-server] timed out after ${ESCROW_DEPLOY_TIMEOUT_MS / 1000}s waiting for escrow ${args.escrowAddress} to be deployed`,
      );
    }
    await sleep(ESCROW_DEPLOY_POLL_INTERVAL_MS);
  }
}

async function waitForProtocolConfigInitialized(args: {
  publicClient: PublicClient;
  escrowAddress: Address;
}): Promise<ProtocolConfig> {
  const deadline = Date.now() + ESCROW_DEPLOY_TIMEOUT_MS;
  console.log(
    `[x402-e2e/resource-server] waiting for ConfigHandlerFacet at ${args.escrowAddress} to be initialized…`,
  );
  while (true) {
    try {
      const config = await fetchProtocolConfig({
        publicClient: args.publicClient,
        escrowAddress: args.escrowAddress,
      });
      if (config.maxOfferFeeBps > 0 && config.minDisputePeriodMs > 0) {
        console.log(
          `[x402-e2e/resource-server] ConfigHandlerFacet initialized (maxOfferFeeBps=${config.maxOfferFeeBps}, minDisputePeriodMs=${config.minDisputePeriodMs})`,
        );
        return config;
      }
    } catch {
      // Facet not yet cut into the Diamond — readContract reverts. Keep polling.
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `[x402-e2e/resource-server] timed out after ${ESCROW_DEPLOY_TIMEOUT_MS / 1000}s waiting for ConfigHandlerFacet at ${args.escrowAddress} to be initialized`,
      );
    }
    await sleep(ESCROW_DEPLOY_POLL_INTERVAL_MS);
  }
}

/**
 * Block until the `boson-subgraph` is ready to serve the seller
 * lookup — both *responsive* (the `boson/corecomponents` subgraph is
 * deployed and serving GraphQL) and *caught up* to the current chain
 * head. A plain `depends_on` only waits for the graph-node container
 * to start, and the container reports healthy well before the subgraph
 * is deployed/indexed, so on a cold stack the first
 * `getSellersByAddress` (in `seedSuite`) would throw and crash boot.
 *
 * Gating on indexing-to-head also fixes a latent idempotency bug: on a
 * re-boot against a stack whose seller already exists, an under-indexed
 * subgraph reports it absent, which would trigger a spurious
 * `createSeller` (and an on-chain revert). Waiting for the head
 * guarantees an already-registered seller is visible before the lookup.
 *
 * Builds a read-only CoreSDK with a throwing `web3Lib` stub (mirrors
 * `seed.ts` / `exchange-reader.ts`) — no on-chain writes happen here.
 */
async function waitForSubgraphReady(args: {
  publicClient: PublicClient;
  subgraphUrl: string;
  escrowAddress: Address;
  chainId: number;
  sellerAddress: Address;
}): Promise<void> {
  const deadline = Date.now() + SUBGRAPH_READY_TIMEOUT_MS;
  console.log(
    `[x402-e2e/resource-server] waiting for subgraph ${args.subgraphUrl} to be ready (deployed and indexed to head)…`,
  );
  const sdk = new CoreSDK({
    web3Lib: createReadOnlyWeb3LibStub() as never,
    subgraphUrl: args.subgraphUrl,
    protocolDiamond: args.escrowAddress,
    chainId: args.chainId,
  });
  const indexerWait = sdk as unknown as CoreSdkWithIndexerWait;
  const coreSdkRead = asCoreSdkReadAdapter(sdk);
  while (true) {
    try {
      // `cacheTime: 0` defeats viem's block-number cache so we wait on
      // the freshest head, not a stale cached one (see exchange-reader.ts).
      const head = await args.publicClient.getBlockNumber({ cacheTime: 0 });
      // Resolves only once the subgraph exists and its indexer has
      // reached `head`; throws while the endpoint isn't serving yet.
      await indexerWait.waitForGraphNodeIndexing(Number(head));
      // Final liveness check on the exact query path the seller lookup
      // uses. Return value is irrelevant — we only care it doesn't throw.
      await coreSdkRead.getSellersByAddress(args.sellerAddress);
      console.log(`[x402-e2e/resource-server] subgraph ${args.subgraphUrl} is ready`);
      return;
    } catch {
      // Subgraph not deployed / not yet indexed — keep polling.
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `[x402-e2e/resource-server] timed out after ${SUBGRAPH_READY_TIMEOUT_MS / 1000}s waiting for subgraph ${args.subgraphUrl} to be ready`,
      );
    }
    await sleep(SUBGRAPH_READY_POLL_INTERVAL_MS);
  }
}

/**
 * Look up — or create — the Boson seller entity whose assistant is
 * the address derived from `sellerPk`. Returns the resolved seller id
 * (decimal string) so the caller can override `env.sellerId` before
 * handing it to `createResourceServerApp`. Idempotent against an
 * already-registered seller: the subgraph hit short-circuits before
 * any on-chain write.
 */
async function ensureSellerEntity(args: {
  sellerPk: Hex;
  rpcUrl: string;
  publicClient: PublicClient;
  escrowAddress: Address;
  chainId: number;
  subgraphUrl: string;
}): Promise<string> {
  const sellerAccount = privateKeyToAccount(args.sellerPk);
  console.log(
    `[x402-e2e/resource-server] ensuring seller entity for assistant ${sellerAccount.address}…`,
  );
  const walletClient = buildWalletClient(sellerAccount, { rpcUrl: args.rpcUrl });
  const createSeller = buildCreateSellerCallback({
    walletClient,
    publicClient: args.publicClient,
    escrowAddress: args.escrowAddress,
    chainId: args.chainId,
    subgraphUrl: args.subgraphUrl,
  });
  const state = await seedSuite({
    sellerAddress: sellerAccount.address,
    subgraphUrl: args.subgraphUrl,
    escrowAddress: args.escrowAddress,
    chainId: args.chainId,
    createSeller,
  });
  console.log(
    `[x402-e2e/resource-server] seller entity ready: id=${state.seller.id}, assistant=${state.seller.assistant}`,
  );
  return state.seller.id;
}

/**
 * Parse the optional `BUYER_WALLETS` env — a comma-separated list of
 * wallet addresses to fund on boot — into checksummed addresses.
 * Returns `[]` when unset/empty. Throws a clear, prefixed error on a
 * malformed entry so a typo surfaces at boot rather than as an opaque
 * mint revert.
 */
function parseBuyerWallets(raw: string | undefined): Address[] {
  if (raw === undefined) return [];
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => {
      try {
        return getAddress(entry);
      } catch {
        throw new Error(
          `[x402-e2e/resource-server] BUYER_WALLETS contains an invalid address: ${entry}`,
        );
      }
    });
}

/**
 * Mint each listed buyer wallet up to `BUYER_FUND_AMOUNT` of the
 * payment asset so a human-driven browser wallet can pay the paywall.
 * Signs the mints with `sellerPk` — the entrypoint's already-funded
 * account; the mock token's `mint` is public, so any funded signer
 * works. Sequential to avoid racing the signer's nonce. Idempotent —
 * a wallet already at the target is skipped.
 */
async function fundBuyerWallets(args: {
  wallets: Address[];
  assetAddress: Address;
  sellerPk: Hex;
  rpcUrl: string;
  publicClient: PublicClient;
}): Promise<void> {
  const walletClient = buildWalletClient(privateKeyToAccount(args.sellerPk), {
    rpcUrl: args.rpcUrl,
  });
  for (const wallet of args.wallets) {
    console.log(
      `[x402-e2e/resource-server] funding buyer wallet ${wallet} with ${BUYER_FUND_AMOUNT} of ${args.assetAddress}…`,
    );
    await ensureTokenBalance({
      walletClient,
      publicClient: args.publicClient,
      tokenAddress: args.assetAddress,
      owner: wallet,
      targetBalance: BUYER_FUND_AMOUNT,
    });
  }
}

async function main(): Promise<void> {
  // The example's `readEnv` flags `SELLER_ID` as required so library
  // operators always pin the on-chain seller id at boot. The harness
  // can't — the id is only knowable after `createSeller` lands. Inject
  // a placeholder so `readEnv`'s validator accepts the env, then
  // overwrite `env.sellerId` further down with the real value resolved
  // by `ensureSellerEntity`. The placeholder is never observed by the
  // app because the override happens before `createResourceServerApp`.
  process.env.SELLER_ID ??= "0";

  const env = readEnv();

  if (env.subgraphUrl === undefined) {
    throw new Error(
      "[x402-e2e/resource-server] SUBGRAPH_URL is required so the entrypoint can construct the subgraph-backed ExchangeReader and self-seed the seller entity",
    );
  }

  // Reader uses the chain head to wait for the subgraph indexer to
  // catch up on a `null` lookup (see `exchange-reader.ts`). Reuse the
  // harness's viem builder so the chain id / RPC URL stay consistent
  // with the rest of the suite.
  const publicClient = buildPublicClient({ rpcUrl: env.rpcNode });

  await waitForEscrowDeployed({ publicClient, escrowAddress: env.escrowAddress });

  // Tighten the offer's `feeLimit` cap and floor its
  // `disputePeriodDurationInMS` against the live `ConfigHandlerFacet`
  // values, instead of the hand-picked safe defaults baked into
  // `buildUnsignedOffer`. Reuses the polled fetch result so we don't
  // call the view twice.
  const protocolConfig = await waitForProtocolConfigInitialized({
    publicClient,
    escrowAddress: env.escrowAddress,
  });

  // Gate on the subgraph being deployed and indexed to the chain head
  // before the seller lookup in `ensureSellerEntity` — on a cold stack
  // the graph-node container is up but the subgraph isn't serving yet,
  // which would otherwise crash the first `getSellersByAddress`.
  const sellerAddress = privateKeyToAccount(env.sellerPk).address;
  await waitForSubgraphReady({
    publicClient,
    subgraphUrl: env.subgraphUrl,
    escrowAddress: env.escrowAddress,
    chainId: env.chainId,
    sellerAddress,
  });

  const sellerId = await ensureSellerEntity({
    sellerPk: env.sellerPk,
    rpcUrl: env.rpcNode,
    publicClient,
    escrowAddress: env.escrowAddress,
    chainId: env.chainId,
    subgraphUrl: env.subgraphUrl,
  });

  // Optionally pre-fund human-driven browser wallets so a developer can
  // connect MetaMask and pay the paywall without a separate mint step.
  const buyerWallets = parseBuyerWallets(process.env.BUYER_WALLETS);
  if (buyerWallets.length > 0) {
    await fundBuyerWallets({
      wallets: buyerWallets,
      assetAddress: env.assetAddress,
      sellerPk: env.sellerPk,
      rpcUrl: env.rpcNode,
      publicClient,
    });
  }

  const exchangeReader = createSubgraphExchangeReader({
    subgraphUrl: env.subgraphUrl,
    escrowAddress: env.escrowAddress,
    chainId: env.chainId,
    publicClient,
  });

  const { app, seller } = createResourceServerApp(
    { ...env, sellerId },
    { exchangeReader, protocolConfig },
  );

  const server = app.listen(env.port, () => {
    console.log(
      `[x402-e2e/resource-server] listening on :${env.port} (chain ${env.chainId}, seller ${seller.address}, asset ${env.assetAddress}, subgraph ${env.subgraphUrl})`,
    );
  });

  server.on("error", (err: Error) => {
    console.error(
      `[x402-e2e/resource-server] failed to bind on :${env.port} (chain ${env.chainId}, seller ${seller.address}, asset ${env.assetAddress}): ${err.message}`,
    );
    process.exit(1);
  });
}

main().catch((err: unknown) => {
  console.error("[x402-e2e/resource-server] boot failed:", err);
  process.exit(1);
});
