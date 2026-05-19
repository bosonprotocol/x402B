// Wallet-bound `createSeller` callback for `seedSuite`.
//
// `seedSuite` is generic — it accepts any `(assistant) => Promise<void>`
// callback so each suite can plug in whichever core-sdk shape its
// version supports. This helper is the concrete wiring against
// `@bosonprotocol/core-sdk`'s `AccountsMixin.createSeller` for
// the local `boson-protocol-node` stack: it builds a `CoreSDK` bound
// to the seller's viem `WalletClient`, submits the on-chain seller
// registration, and awaits the receipt before returning so
// `seedSuite`'s post-create subgraph poll only fires once the
// indexer has a block to ingest.

import { CoreSDK } from "@bosonprotocol/core-sdk";
import { walletClientToWeb3LibAdapter } from "@bosonprotocol/x402-evm/adapters";
import type { Address, PublicClient, WalletClient } from "viem";

import { LOCAL_31337_0 } from "../config/local-31337-0.js";

export interface BuildCreateSellerCallbackArgs {
  /** Seller's viem `WalletClient` (must hold native ETH on the local chain). */
  walletClient: WalletClient;
  /** Read-side `PublicClient` the SDK uses for receipt polling. */
  publicClient: PublicClient;
  /** Boson Diamond. Defaults to `LOCAL_31337_0.contracts.protocolDiamond`. */
  escrowAddress?: Address;
  /** Chain id. Defaults to `LOCAL_31337_0.chainId`. */
  chainId?: number;
  /** Subgraph URL. Only used to satisfy CoreSDK's constructor — `createSeller` itself doesn't query it. */
  subgraphUrl?: string;
  /** Seller account-level metadata. Defaults to a static x402b-e2e contract URI. */
  contractUri?: string;
  /** Seller account-level metadata URI. Defaults to a static x402b-e2e seller URI. */
  metadataUri?: string;
}

/**
 * Build a callback compatible with `seedSuite({ createSeller })`. The
 * returned function calls `coreSdk.createSeller({...})` with the
 * supplied `assistant` as the seller's `assistant` / `admin` / `treasury`
 * — single-wallet seller, simplest valid configuration. Returns once
 * the transaction is mined.
 */
export function buildCreateSellerCallback(
  args: BuildCreateSellerCallbackArgs,
): (assistant: Address) => Promise<void> {
  const escrowAddress = args.escrowAddress ?? LOCAL_31337_0.contracts.protocolDiamond;
  const chainId = args.chainId ?? LOCAL_31337_0.chainId;
  const subgraphUrl = args.subgraphUrl ?? LOCAL_31337_0.urls.subgraph;
  const contractUri = args.contractUri ?? "ipfs://x402b-e2e/seller";
  const metadataUri = args.metadataUri ?? "ipfs://x402b-e2e/metadata";

  const web3Lib = walletClientToWeb3LibAdapter({
    walletClient: args.walletClient,
    publicClient: args.publicClient,
    chainId,
  });
  const coreSdk = new CoreSDK({
    web3Lib,
    subgraphUrl,
    protocolDiamond: escrowAddress,
    chainId,
  });

  return async (assistant: Address): Promise<void> => {
    const tx = await coreSdk.createSeller({
      assistant,
      admin: assistant,
      treasury: assistant,
      contractUri,
      royaltyPercentage: "0",
      authTokenId: "0",
      authTokenType: 0,
      metadataUri,
    });
    // `coreSdk`'s `TransactionResponse` carries a `wait()` that resolves
    // once the receipt is in. Block here so `seedSuite`'s subgraph
    // poll has something to find.
    if (typeof (tx as { wait?: unknown }).wait === "function") {
      await (tx as { wait: () => Promise<unknown> }).wait();
    }
  };
}
