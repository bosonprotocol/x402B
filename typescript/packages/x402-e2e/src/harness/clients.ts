// Shared viem `PublicClient` + `WalletClient` builders for the harness.
// Every actor (BuyerActor, SellerActor, ResolverActor) and asserter
// (OnchainAsserter, subgraph reader) needs viem clients pinned to the
// local chain; centralising the chain definition + transport here keeps
// the harness honest about which RPC it talks to (host-side `localhost`
// when run from the test process, `host.docker.internal` when run from
// inside a compose container).

import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  type Account,
  type Chain,
  type PublicClient,
  type WalletClient,
} from "viem";

import { LOCAL_31337_0 } from "../config/local-31337-0.js";

/**
 * `defineChain` config for the local Boson stack. Test-only — points at
 * `http://localhost:8545` by default. Pass `rpcUrl` to override (for
 * example when running the harness from inside a container).
 */
export function localBosonChain(rpcUrl: string = LOCAL_31337_0.urls.jsonRpc): Chain {
  return defineChain({
    id: LOCAL_31337_0.chainId,
    name: `boson-${LOCAL_31337_0.chainId}`,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  });
}

export interface E2EClientsArgs {
  /** RPC URL the clients talk to. Defaults to `LOCAL_31337_0.urls.jsonRpc`. */
  rpcUrl?: string;
}

/**
 * Build a `PublicClient` pinned to the local Boson chain. Single shared
 * instance recommended per test run (viem reuses connections).
 */
export function buildPublicClient(args: E2EClientsArgs = {}): PublicClient {
  const rpcUrl = args.rpcUrl ?? LOCAL_31337_0.urls.jsonRpc;
  return createPublicClient({
    chain: localBosonChain(rpcUrl),
    transport: http(rpcUrl),
  });
}

/**
 * Build a `WalletClient` bound to a viem `Account`. Sends transactions
 * + signs typed data through `account`; the account itself stays
 * authoritative for its own signatures (no key material leaks past
 * `account.signTypedData`).
 */
export function buildWalletClient(account: Account, args: E2EClientsArgs = {}): WalletClient {
  const rpcUrl = args.rpcUrl ?? LOCAL_31337_0.urls.jsonRpc;
  return createWalletClient({
    account,
    chain: localBosonChain(rpcUrl),
    transport: http(rpcUrl),
  });
}
