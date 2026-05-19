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
// indexer ingests the block. When a `PublicClient` is supplied the
// reader asks core-sdk to wait for the indexer to catch up to the
// current chain head before forwarding `null` — that is the canonical
// "indexer is behind" recovery path; the older polling wrapper
// (`withPollUntilFound`) remains for callers that don't have an
// `PublicClient` to hand.

import { CoreSDK } from "@bosonprotocol/core-sdk";
import type { ExchangeReader, ExchangeSnapshot } from "@bosonprotocol/x402-server";
import type { Address, PublicClient } from "viem";

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
  /**
   * Optional read-only chain client. When supplied, the reader queries
   * the chain head on a `null` subgraph result and waits for the
   * indexer to catch up before returning. Without it the reader
   * forwards `null` immediately (the server's own retry budget then
   * decides how long to wait, which is short — see
   * `withPollUntilFound`).
   */
  publicClient?: PublicClient;
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

/** CoreSDK exposes `waitForGraphNodeIndexing` via the subgraph mixin; narrow to that surface. */
interface CoreSdkWithIndexerWait {
  waitForGraphNodeIndexing(blockNumber?: number): Promise<void>;
  getExchangeById(id: string): Promise<unknown>;
}

/**
 * Build an `ExchangeReader` that resolves snapshots through the local
 * Boson subgraph. The CoreSDK is constructed with a throwing web3Lib
 * stub so any accidental write attempt surfaces immediately.
 *
 * When `args.publicClient` is set, a `null` from the subgraph is
 * treated as "indexer is behind" — the reader fetches the current
 * chain head and calls `coreSdk.waitForGraphNodeIndexing(blockNumber)`
 * before trying once more. The second `null` is forwarded so the
 * server's own retry path can take over.
 */
export function createSubgraphExchangeReader(
  args: SubgraphExchangeReaderArgs = {},
): ExchangeReader {
  const subgraphUrl = args.subgraphUrl ?? LOCAL_31337_0.urls.subgraph;
  const escrowAddress = args.escrowAddress ?? LOCAL_31337_0.contracts.protocolDiamond;
  const chainId = args.chainId ?? LOCAL_31337_0.chainId;
  const publicClient = args.publicClient;

  const sdk = new CoreSDK({
    web3Lib: createReadOnlyWeb3LibStub() as never,
    subgraphUrl,
    protocolDiamond: escrowAddress,
    chainId,
  }) as unknown as CoreSdkWithIndexerWait;

  const fetchSnapshot = async (exchangeId: string): Promise<ExchangeSnapshot | null> => {
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
  };

  return {
    read: async (exchangeId: string): Promise<ExchangeSnapshot | null> => {
      const first = await fetchSnapshot(exchangeId);
      if (first !== null) return first;
      if (publicClient === undefined) return null;

      // Indexer lag recovery: get the current chain head and ask
      // core-sdk to wait until the subgraph has ingested at least that
      // block. Any tx already mined has block <= head, so once the
      // indexer reaches `head`, our exchange (if it exists on chain)
      // is guaranteed visible. Cap the wait with `Promise.race` so a
      // stuck indexer doesn't pin a scenario indefinitely.
      try {
        const head = await publicClient.getBlockNumber();
        await sdk.waitForGraphNodeIndexing(Number(head));
      } catch {
        // Network hiccup against the indexer or the RPC — fall through
        // to a final read so the caller's retry budget (or
        // `withPollUntilFound`) can decide what to do.
      }
      return fetchSnapshot(exchangeId);
    },
  };
}
