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

import type { Address, PublicClient } from "viem";

import {
  createResourceServerApp,
  fetchProtocolConfig,
  readEnv,
  type ProtocolConfig,
} from "@bosonprotocol/x402-example-resource-server";

import { buildPublicClient } from "../harness/clients.js";
import { createSubgraphExchangeReader } from "../harness/exchange-reader.js";

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

async function main(): Promise<void> {
  const env = readEnv();

  if (env.subgraphUrl === undefined) {
    throw new Error(
      "[x402-e2e/resource-server] SUBGRAPH_URL is required so the entrypoint can construct the subgraph-backed ExchangeReader",
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

  const exchangeReader = createSubgraphExchangeReader({
    subgraphUrl: env.subgraphUrl,
    escrowAddress: env.escrowAddress,
    chainId: env.chainId,
    publicClient,
  });

  const { app, seller } = createResourceServerApp(env, { exchangeReader, protocolConfig });

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
