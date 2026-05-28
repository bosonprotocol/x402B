// Translator that wraps a viem `WalletClient` as an x402-client `Signer`.
//
// Browser apps typically obtain a `WalletClient` by combining
// `createWalletClient` with `custom(window.ethereum)` (raw EIP-1193) or
// with a wagmi connector. The client's `Signer` interface and viem's
// `WalletClient.signTypedData` line up exactly except that the latter
// requires `account` on every call — this helper resolves the bound
// account (or an explicit override) once at construction time and
// forwards the rest of the typed-data payload verbatim.

import {
  getAddress,
  type Address,
  type Hex,
  type TypedDataDomain,
  type TypedDataParameter,
} from "viem";

import type { Signer } from "@bosonprotocol/x402-client";

/**
 * Structural subset of viem's `WalletClient` that
 * {@link signerFromWalletClient} actually exercises. A concrete
 * `WalletClient` instance satisfies this shape by structural typing,
 * without forcing this package to take viem as a peer dep.
 */
export interface WalletClientLike {
  account?: { address: Address } | undefined;
  signTypedData(parameters: {
    account: Address;
    domain?: TypedDataDomain | undefined;
    types: Record<string, readonly TypedDataParameter[]>;
    primaryType: string;
    message: Record<string, unknown>;
  }): Promise<Hex>;
}

export interface SignerFromWalletClientOptions {
  /**
   * Address to sign as. When supplied, takes precedence over any bound
   * `walletClient.account`; required only when no bound account exists.
   * Resolves through viem's `getAddress` to a checksummed form before
   * being passed on.
   */
  account?: Address;
}

/**
 * Wrap a viem `WalletClient` (or any object structurally matching
 * {@link WalletClientLike}) as an x402-client {@link Signer}.
 *
 * Throws synchronously at construction time if the wallet client has no
 * bound account and no `account` override is supplied — failing fast here
 * surfaces the misconfiguration before `handle402` is ever called.
 */
export function signerFromWalletClient(
  walletClient: WalletClientLike,
  options: SignerFromWalletClientOptions = {},
): Signer {
  const candidate = options.account ?? walletClient.account?.address;
  if (!candidate) {
    throw new Error(
      "signerFromWalletClient: walletClient has no bound account and no `account` override was supplied",
    );
  }
  const resolved = getAddress(candidate);
  return {
    getAddress: async () => resolved,
    signTypedData: ({ domain, types, primaryType, message }) =>
      walletClient.signTypedData({
        account: resolved,
        domain,
        types,
        primaryType,
        message,
      }),
  };
}
