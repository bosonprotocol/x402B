// Construct (and cache) the `CoreSDK` instance the client signs through.
//
// The buyer never queries Boson's subgraph in MVP — only the EIP-712 meta-tx
// signing path is invoked — but `CoreSDK`'s base constructor requires a
// `subgraphUrl` string. Callers can configure real URLs per chain via
// `subgraphUrls`, or omit it and rely on the placeholder sentinel below;
// either way no HTTP call to that URL is made during signing.

import { CoreSDK } from "@bosonprotocol/core-sdk";
import type { Address } from "viem";

import { signerToWeb3LibAdapter } from "./internal/web3lib-adapter.js";
import type { Signer, X402bClientConfig } from "./types.js";

// Sentinel used when the caller did not configure a real subgraph URL for
// the chain. The signing path never reads from it; the value just needs to
// be a non-empty string the constructor accepts.
const PLACEHOLDER_SUBGRAPH_URL = "https://x402-client.placeholder.invalid/subgraph";

export interface CoreSdkContext {
  coreSdk: CoreSDK;
  chainId: number;
}

/**
 * Parse a CAIP-2 EVM network identifier (e.g. `"eip155:8453"`) into its
 * numeric chain id. Throws if the network is not a well-formed `eip155:<N>`.
 */
export function parseChainId(network: string): number {
  const match = network.match(/^eip155:(\d+)$/);
  if (!match) {
    throw new Error(
      `x402-client: unsupported network '${network}' (expected CAIP-2 'eip155:<chainId>')`,
    );
  }
  const chainId = Number(match[1]);
  if (!Number.isSafeInteger(chainId) || chainId <= 0) {
    throw new Error(
      `x402-client: unsupported network '${network}' (chainId must be a positive safe integer)`,
    );
  }
  return chainId;
}

/**
 * Lazy factory that returns a `CoreSDK` instance configured against the
 * escrow contract advertised in the network. Instances are cached per
 * `(chainId, escrowAddress)` so repeated calls on the same network — for
 * commit and subsequent post-commit actions on the same exchange — reuse a
 * single SDK.
 *
 * The SDK's `web3Lib.call(...)` is wired through `config.publicClients[chainId]`
 * when one is configured; this enables read-only RPC reads (e.g. the EIP-2612
 * Permit strategy's `nonces(owner)` lookup). Chains without a PublicClient
 * configured can still sign meta-transactions and ERC-3009 / Permit2
 * token-auths.
 */
export function createCoreSdkFactory(
  signer: Signer,
  config: Pick<X402bClientConfig, "subgraphUrls" | "publicClients">,
) {
  const cache = new Map<string, CoreSDK>();

  return function buildCoreSdk(network: string, escrowAddress: Address): CoreSdkContext {
    const chainId = parseChainId(network);
    const cacheKey = `${chainId}:${escrowAddress.toLowerCase()}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      return { coreSdk: cached, chainId };
    }

    const subgraphUrl = config.subgraphUrls?.[chainId] ?? PLACEHOLDER_SUBGRAPH_URL;
    const publicClient = config.publicClients?.[chainId];
    const web3Lib = signerToWeb3LibAdapter(signer, chainId, publicClient);

    const coreSdk = new CoreSDK({
      web3Lib,
      subgraphUrl,
      protocolDiamond: escrowAddress,
      chainId,
    });

    cache.set(cacheKey, coreSdk);
    return { coreSdk, chainId };
  };
}
