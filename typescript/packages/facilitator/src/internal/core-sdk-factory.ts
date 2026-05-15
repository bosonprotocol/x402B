// Build (and cache) the `CoreSDK` instance the facilitator submits
// through.
//
// `CoreSDK`'s constructor requires a `subgraphUrl` string. The
// facilitator never queries the subgraph during settlement — it
// drives `coreSdk.executeMetaTransaction(...)` which only touches the
// SDK's `web3Lib` adapter — but a non-empty placeholder value satisfies
// the constructor signature. Same pattern as the buyer-side client.

import { CoreSDK } from "@bosonprotocol/core-sdk";
import { walletClientToWeb3LibAdapter } from "@bosonprotocol/x402-evm/adapters";
import type { Address, PublicClient, WalletClient } from "viem";

const PLACEHOLDER_SUBGRAPH_URL = "https://x402-facilitator.placeholder.invalid/subgraph";

export interface FacilitatorCoreSdkArgs {
  walletClient: WalletClient;
  publicClient: PublicClient;
  chainId: number;
  escrowAddress: Address;
}

/**
 * Build a `CoreSDK` instance configured against the configured relayer
 * wallet + escrow address. Instances are cached per
 * `(chainId, escrowAddress, walletClient identity)` — repeated
 * `settle()` / `performAction()` calls in the same process reuse a
 * single SDK.
 */
export function createFacilitatorCoreSdk(args: FacilitatorCoreSdkArgs): CoreSDK {
  const key = `${args.chainId}:${args.escrowAddress.toLowerCase()}`;
  const cached = lookup(args.walletClient, key);
  if (cached) return cached;

  const web3Lib = walletClientToWeb3LibAdapter({
    walletClient: args.walletClient,
    publicClient: args.publicClient,
    chainId: args.chainId,
  });
  const sdk = new CoreSDK({
    web3Lib,
    subgraphUrl: PLACEHOLDER_SUBGRAPH_URL,
    protocolDiamond: args.escrowAddress,
    chainId: args.chainId,
  });
  store(args.walletClient, key, sdk);
  return sdk;
}

// Per-walletClient cache — different operator configurations (e.g.
// multiple wallets on the same chain in tests) get distinct SDKs.
const walletClientCaches = new WeakMap<WalletClient, Map<string, CoreSDK>>();

function lookup(walletClient: WalletClient, key: string): CoreSDK | undefined {
  return walletClientCaches.get(walletClient)?.get(key);
}

function store(walletClient: WalletClient, key: string, sdk: CoreSDK): void {
  let inner = walletClientCaches.get(walletClient);
  if (!inner) {
    inner = new Map();
    walletClientCaches.set(walletClient, inner);
  }
  inner.set(key, sdk);
}
