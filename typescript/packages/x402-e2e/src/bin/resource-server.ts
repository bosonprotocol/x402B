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

import {
  createResourceServerApp,
  fetchProtocolConfig,
  readEnv,
} from "@bosonprotocol/x402-example-resource-server";

import { buildPublicClient } from "../harness/clients.js";
import { createSubgraphExchangeReader } from "../harness/exchange-reader.js";

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

  const exchangeReader = createSubgraphExchangeReader({
    subgraphUrl: env.subgraphUrl,
    escrowAddress: env.escrowAddress,
    chainId: env.chainId,
    publicClient,
  });

  // Tighten the offer's `feeLimit` cap and floor its
  // `disputePeriodDurationInMS` against the live `ConfigHandlerFacet`
  // values, instead of the hand-picked safe defaults baked into
  // `buildUnsignedOffer`.
  const protocolConfig = await fetchProtocolConfig({
    publicClient,
    escrowAddress: env.escrowAddress,
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
