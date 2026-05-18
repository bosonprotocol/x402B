// Boot entrypoint for the `x402b-resource-server` compose service.
//
// `@bosonprotocol/x402-example-resource-server`'s own `index.ts` throws
// at startup because it intentionally ships no `ExchangeReader`. This
// entrypoint provides one — for PR4 it's a logging placeholder that
// returns `null`; the 402 challenge path doesn't touch the reader, so
// the resource-server container boots and `/health` + `GET /resource`
// work end-to-end. Write handlers (commit, redeem, dispute/*) will
// fail with `STATE_VERIFY_EXCHANGE_NOT_FOUND` until PR5 swaps the
// reader for a subgraph-backed implementation against the
// `boson-subgraph` container.

import { createResourceServerApp, readEnv } from "@bosonprotocol/x402-example-resource-server";
import type { ExchangeReader, ExchangeSnapshot } from "@bosonprotocol/x402-server";

const placeholderExchangeReader: ExchangeReader = {
  read: async (exchangeId: string): Promise<ExchangeSnapshot | null> => {
    console.warn(
      `[x402-e2e/resource-server] placeholder ExchangeReader.read(${exchangeId}) returning null — PR5 wires the subgraph-backed reader`,
    );
    return null;
  },
};

const env = readEnv();
const { app, seller } = createResourceServerApp(env, {
  exchangeReader: placeholderExchangeReader,
});

app.listen(env.port, () => {
  console.log(
    `[x402-e2e/resource-server] listening on :${env.port} (chain ${env.chainId}, seller ${seller.address}, asset ${env.assetAddress})`,
  );
});
