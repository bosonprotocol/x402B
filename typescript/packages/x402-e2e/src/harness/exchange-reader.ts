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
// Subgraph indexer lag affects every read after a fresh on-chain
// write: `coreSdk.getExchangeById(id)` either returns `null` (the id
// doesn't exist yet) or — more subtly — returns a STALE snapshot
// (the indexer reports the previous state because the new state's
// block hasn't been ingested). The "still says COMMITTED" right after
// a `redeemVoucher` tx is the canonical example.
//
// When a `PublicClient` is supplied the reader unconditionally calls
// `coreSdk.waitForGraphNodeIndexing(chainHead)` BEFORE every read so
// both failure modes collapse into "the reader returns the freshest
// snapshot the subgraph can provide". Without a `PublicClient` the
// reader forwards whatever the subgraph has and the older polling
// wrapper (`withPollUntilFound`) is the only recovery — kept for
// backwards compatibility but generally outclassed by the wait path.

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
   * Optional read-only chain client. When supplied, the reader calls
   * `coreSdk.waitForGraphNodeIndexing(chainHead)` **before every read**
   * so the returned snapshot reflects the latest block, not a stale
   * pre-action state. Without it the reader returns whatever the
   * subgraph has at query time, and the server's bounded retry budget
   * (`verifyExchange` defaults to 3 attempts × 50 ms) decides whether
   * to ask again — usually too short for an indexer that needs 1-5 s.
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
 * When `args.publicClient` is set, the reader fetches the current
 * chain head and calls `coreSdk.waitForGraphNodeIndexing(blockNumber)`
 * BEFORE every subgraph read. That guarantees the returned snapshot
 * reflects the freshest on-chain state — necessary after a
 * post-commit action (redeem / complete / dispute family) whose tx
 * has been mined but whose block the indexer hasn't yet ingested,
 * which would otherwise surface as a `STATE_VERIFY_STATE_MISMATCH`
 * (e.g. the subgraph still reports `COMMITTED` immediately after a
 * `redeemVoucher` tx confirms).
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
      // Wait for the subgraph to ingest the current chain head before
      // reading. The on-chain tx for any in-flight action has a block
      // number ≤ head, so once the indexer reaches `head` the
      // resulting state transition is guaranteed visible. Both lag
      // modes — missing entity (NULL row) and stale snapshot
      // (previous state still indexed) — are covered by this single
      // wait. Failures here (e.g. RPC hiccup) fall through to a
      // best-effort read so a network blip doesn't break the suite.
      if (publicClient !== undefined) {
        try {
          // `cacheTime: 0` defeats viem's default block-number cache
          // (≈ pollingInterval, 4 s for chain 31337). Without it, a
          // post-action read inside the same test reuses the
          // pre-action block N as the head, `waitForGraphNodeIndexing(N)`
          // is a no-op (subgraph already past N), and we get the
          // pre-action state for the post-action verify.
          const head = await publicClient.getBlockNumber({ cacheTime: 0 });
          await sdk.waitForGraphNodeIndexing(Number(head));
        } catch {
          // Continue with the read; the caller's retry budget
          // (`withPollUntilFound` or `verifyExchange`) decides what
          // to do with a stale or missing result.
        }
      }
      return fetchSnapshot(exchangeId);
    },
  };
}
