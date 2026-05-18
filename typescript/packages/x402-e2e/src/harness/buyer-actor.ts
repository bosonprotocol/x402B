// `BuyerActor` — the buyer-side persona for scenario tests.
//
// Wraps:
//   - a viem `LocalAccount` (the buyer's signing key)
//   - a viem `PublicClient` (read-only chain access for token-auth nonces)
//   - `createX402bClient` from `@bosonprotocol/x402-client` (handle402 +
//     signAction for post-commit actions)
//   - `wrapFetchWithPayment` from `@bosonprotocol/x402-client-fetch`
//     (transparent 402 retry)
//
// Each scenario test instantiates one BuyerActor per buyer persona. The
// actor surface is deliberately small — `buy(url)` covers the happy
// path; `sign(action, exchangeId)` covers post-commit transitions; the
// underlying `X402bClient` is exposed on `.client` for the edge cases
// the harness doesn't yet bake in (e.g. custom fulfillment selection).

import { createX402bClient, type Signer, type X402bClient } from "@bosonprotocol/x402-client";
import { wrapFetchWithPayment } from "@bosonprotocol/x402-client-fetch";
import type { Address, Hex, LocalAccount, PublicClient } from "viem";

import { LOCAL_31337_0 } from "../config/local-31337-0.js";

import { buildPublicClient } from "./clients.js";

export interface BuyerActorArgs {
  /** Buyer's signing key. Use one from `ROLE_ACCOUNTS.buyer` for shared scenarios. */
  account: LocalAccount;
  /** RPC URL for the buyer's read-side `PublicClient`. Defaults to the local stack. */
  rpcUrl?: string;
  /** Pre-built `PublicClient` to reuse across actors (skips constructing one per buyer). */
  publicClient?: PublicClient;
  /** Subgraph URL passed to the underlying `CoreSDK`. Defaults to the local stack. */
  subgraphUrl?: string;
  /** Chain id the buyer signs against. Defaults to `LOCAL_31337_0.chainId`. */
  chainId?: number;
}

/** Wrap a viem `LocalAccount` so it satisfies `@bosonprotocol/x402-client`'s `Signer` interface. */
function signerFromAccount(account: LocalAccount): Signer {
  return {
    getAddress: async () => account.address,
    signTypedData: async (args) =>
      account.signTypedData(args as Parameters<LocalAccount["signTypedData"]>[0]) as Promise<Hex>,
  };
}

export interface BuyerActor {
  readonly address: Address;
  readonly client: X402bClient;
  readonly publicClient: PublicClient;
  /**
   * `fetch`-shaped function that transparently retries 402 with a signed
   * `X-PAYMENT` header. Use this in place of `globalThis.fetch` to drive
   * the commit-time happy path against a resource server.
   */
  readonly fetch: typeof fetch;
}

export function createBuyerActor(args: BuyerActorArgs): BuyerActor {
  const chainId = args.chainId ?? LOCAL_31337_0.chainId;
  const publicClient =
    args.publicClient ??
    buildPublicClient(args.rpcUrl !== undefined ? { rpcUrl: args.rpcUrl } : {});

  const client = createX402bClient({
    signer: signerFromAccount(args.account),
    subgraphUrls: { [chainId]: args.subgraphUrl ?? LOCAL_31337_0.urls.subgraph },
    publicClients: { [chainId]: publicClient },
  });

  return {
    address: args.account.address,
    client,
    publicClient,
    fetch: wrapFetchWithPayment(globalThis.fetch.bind(globalThis), client),
  };
}
