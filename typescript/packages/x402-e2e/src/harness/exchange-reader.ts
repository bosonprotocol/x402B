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
  /** Escrow address (the Boson protocol entry point). Defaults to `LOCAL_31337_0.contracts.protocolDiamond`. */
  escrowAddress?: Address;
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

export interface WithPollUntilFoundOptions {
  /** Max times the wrapper re-asks the underlying reader. Default: 30. */
  attempts?: number;
  /** Delay between attempts in ms. Default: 1000 (1 s). */
  delayMs?: number;
}

/**
 * Wrap an `ExchangeReader` so it polls internally until the snapshot
 * is non-null, instead of forwarding `null` immediately.
 *
 * Why: `@bosonprotocol/x402-server`'s `verifyExchange` defaults to
 * **3 attempts × 50 ms** before giving up with
 * `STATE_VERIFY_EXCHANGE_NOT_FOUND` — fine for a fast/cached subgraph,
 * too short for the local `boson-subgraph` container whose indexer
 * typically needs 1–5 s to ingest a fresh block. Wrapping the reader
 * effectively extends that budget without touching the server's
 * defaults (production consumers want the fast path).
 *
 * No behaviour change for non-null reads: `verifyExchangeSnapshot`
 * does field-level comparison, which the wrapper doesn't interpose
 * on. Once the subgraph has indexed, the first poll returns the
 * snapshot and the wrapper exits.
 */
export function withPollUntilFound(
  reader: ExchangeReader,
  options: WithPollUntilFoundOptions = {},
): ExchangeReader {
  const attempts = Math.max(1, Math.floor(options.attempts ?? 30));
  const delayMs = Math.max(0, Math.floor(options.delayMs ?? 1000));
  return {
    read: async (exchangeId: string): Promise<ExchangeSnapshot | null> => {
      for (let i = 0; i < attempts; i++) {
        const snapshot = await reader.read(exchangeId);
        if (snapshot !== null) return snapshot;
        if (i < attempts - 1) await new Promise<void>((r) => setTimeout(r, delayMs));
      }
      return null;
    },
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
  const escrowAddress = args.escrowAddress ?? LOCAL_31337_0.contracts.protocolDiamond;
  const chainId = args.chainId ?? LOCAL_31337_0.chainId;

  const sdk = new CoreSDK({
    web3Lib: createReadOnlyWeb3LibStub() as never,
    subgraphUrl,
    protocolDiamond: escrowAddress,
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
