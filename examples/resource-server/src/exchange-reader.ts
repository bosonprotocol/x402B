// Placeholder `ExchangeReader` for the example.
//
// The convenience handlers in `@bosonprotocol/x402-server` (commit,
// redeem, complete, dispute/*) verify the post-settle exchange state
// by calling `exchangeReader.read(exchangeId)` and comparing the
// snapshot against the expectation derived from the request. A real
// reader queries the Boson subgraph (`coreSDK.getExchangeById`) or
// the Diamond directly (viem `publicClient.readContract`).
//
// This example ships a **logging stub** so the binary boots without a
// subgraph URL — the 402 challenge path doesn't touch the reader, so
// the demo is useful out of the box for poking the `GET /resource`
// endpoint. Write handlers (commit, redeem, …) **will fail loudly**
// with `EXCHANGE_NOT_FOUND` until you replace this with a real reader.
//
// The e2e suite imports `createResourceServerApp` directly and
// injects a subgraph-backed reader via the `overrides.exchangeReader`
// option, bypassing this stub.

import type { ExchangeReader, ExchangeSnapshot } from "@bosonprotocol/x402-server";

export function createPlaceholderExchangeReader(): ExchangeReader {
  return {
    read: async (exchangeId: string): Promise<ExchangeSnapshot | null> => {
      console.warn(
        `[resource-server] placeholder exchangeReader.read(${exchangeId}) returning null — wire up a real reader to enable write handlers`,
      );
      return null;
    },
  };
}
