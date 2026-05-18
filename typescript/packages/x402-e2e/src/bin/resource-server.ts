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

import { createResourceServerApp, readEnv } from "@bosonprotocol/x402-example-resource-server";

import { createSubgraphExchangeReader } from "../harness/exchange-reader.js";

const env = readEnv();

if (env.subgraphUrl === undefined) {
  throw new Error(
    "[x402-e2e/resource-server] SUBGRAPH_URL is required so the entrypoint can construct the subgraph-backed ExchangeReader",
  );
}

const exchangeReader = createSubgraphExchangeReader({
  subgraphUrl: env.subgraphUrl,
  protocolDiamond: env.escrowAddress,
  chainId: env.chainId,
});

const { app, seller } = createResourceServerApp(env, { exchangeReader });

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
