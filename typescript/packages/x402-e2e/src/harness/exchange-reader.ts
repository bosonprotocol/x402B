// Subgraph-backed `ExchangeReader` for the harness.
//
// The convenience handlers in `@bosonprotocol/x402-server`
// (commit, redeem, complete, dispute/*) verify post-settle exchange
// state through an `ExchangeReader`. The placeholder reader in
// `src/bin/resource-server.ts` (returns `null`) is good enough for the
// 402 challenge path but fails write handlers with
// `STATE_VERIFY_EXCHANGE_NOT_FOUND`. This reader queries the
// `boson-subgraph` container's GraphQL endpoint via
// `@bosonprotocol/core-sdk`'s `getExchangeById` and maps the result to
// the `ExchangeSnapshot` shape the server expects.
//
// Subgraph indexer lag is the dominant failure mode immediately after
// a settle: `coreSdk.getExchangeById(id)` returns `null` until the
// indexer ingests the block. The server's `verifyExchange` already
// retries on `null` with a bounded wait — this reader just forwards
// `null` so that retry path kicks in.

import { CoreSDK } from "@bosonprotocol/core-sdk";
import type { ExchangeReader, ExchangeSnapshot } from "@bosonprotocol/x402-server";
import type { Address } from "viem";

import { LOCAL_31337_0 } from "../config/local-31337-0.js";

/**
 * A throwing `Web3LibAdapter` stub — read-only paths through CoreSDK
 * never invoke `web3Lib`, so any access surfaces as a loud error
 * pointing at the misuse. Mirrors the pattern in
 * `@bosonprotocol/x402-facilitator`'s `createFacilitatorCoreSdk`.
 */
function createReadOnlyWeb3LibStub(): never[] {
  const handler: ProxyHandler<object> = {
    get(_target, prop) {
      throw new Error(
        `[x402-e2e/exchange-reader] read-only CoreSDK should not invoke web3Lib.${String(prop)}`,
      );
    },
  };
  return new Proxy({}, handler) as never;
}

export interface SubgraphExchangeReaderArgs {
  /** Subgraph GraphQL endpoint. Defaults to `LOCAL_31337_0.urls.subgraph`. */
  subgraphUrl?: string;
  /** Boson Diamond address. Defaults to `LOCAL_31337_0.contracts.protocolDiamond`. */
  protocolDiamond?: Address;
  /** Chain id. Defaults to `LOCAL_31337_0.chainId`. */
  chainId?: number;
}

/** Shape returned by `coreSdk.getExchangeById`. Narrowed to the fields the snapshot needs. */
interface CoreSdkExchangeEntity {
  state: ExchangeSnapshot["state"];
  disputed?: boolean;
  dispute?: { state?: ExchangeSnapshot["disputeState"] };
  offer: {
    price: string;
    exchangeToken: { address: string };
    seller: { assistant: string };
  };
}

/**
 * Build an `ExchangeReader` that resolves snapshots through the local
 * Boson subgraph. The CoreSDK is constructed with a throwing web3Lib
 * stub so any accidental write attempt surfaces immediately.
 */
export function createSubgraphExchangeReader(
  args: SubgraphExchangeReaderArgs = {},
): ExchangeReader {
  const subgraphUrl = args.subgraphUrl ?? LOCAL_31337_0.urls.subgraph;
  const protocolDiamond = args.protocolDiamond ?? LOCAL_31337_0.contracts.protocolDiamond;
  const chainId = args.chainId ?? LOCAL_31337_0.chainId;

  const sdk = new CoreSDK({
    web3Lib: createReadOnlyWeb3LibStub() as never,
    subgraphUrl,
    protocolDiamond,
    chainId,
  });

  return {
    read: async (exchangeId: string): Promise<ExchangeSnapshot | null> => {
      // `getExchangeById` returns `null` when the subgraph hasn't yet
      // indexed the commit transaction. Forward the null so the server's
      // bounded retry path can resolve once the indexer catches up.
      const raw = (await sdk.getExchangeById(exchangeId)) as CoreSdkExchangeEntity | null;
      if (raw === null) return null;

      const snapshot: ExchangeSnapshot = {
        state: raw.state,
        seller: raw.offer.seller.assistant as Address,
        exchangeToken: raw.offer.exchangeToken.address as Address,
        price: raw.offer.price,
      };
      if (raw.disputed === true && raw.dispute?.state !== undefined) {
        snapshot.disputeState = raw.dispute.state;
      }
      return snapshot;
    },
  };
}
