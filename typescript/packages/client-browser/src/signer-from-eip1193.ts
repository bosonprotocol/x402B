// Translator that wraps a raw EIP-1193 provider (e.g. `window.ethereum`)
// as an x402-client `Signer`. For consumers who don't want to layer a viem
// `WalletClient` on top — or who only have the injected provider handle.
//
// EIP-1193 doesn't expose a typed `signTypedData` directly; we drive
// `eth_signTypedData_v4` through `provider.request`. That RPC method
// requires `types.EIP712Domain` to be present and to match exactly the
// fields populated on `domain`; we use viem's `getTypesForEIP712Domain`
// to derive that list so the digest agrees with what any viem-based signer
// would produce against the same payload.

import {
  getAddress,
  getTypesForEIP712Domain,
  serializeTypedData,
  type Address,
  type Hex,
  type TypedDataDefinition,
} from "viem";

import type { Signer } from "@bosonprotocol/x402-client";

/**
 * Minimal structural subset of an EIP-1193 provider that
 * {@link signerFromEip1193} actually exercises. Browser-injected wallets
 * (e.g. `window.ethereum`) and wagmi connectors both satisfy this shape.
 */
export interface Eip1193Provider {
  request(args: { method: string; params?: readonly unknown[] | object }): Promise<unknown>;
}

export interface SignerFromEip1193Options {
  /**
   * Address to sign as. When supplied, skips the `eth_accounts` /
   * `eth_requestAccounts` round-trip and uses this address verbatim
   * (after checksum normalization).
   */
  account?: Address;
  /**
   * When `true` and no `account` override is given, resolve the signing
   * address via `eth_requestAccounts` (which may prompt the user to
   * connect). Defaults to `false`, which uses `eth_accounts` and assumes
   * the wallet is already connected.
   */
  requestAccounts?: boolean;
}

/**
 * Wrap a raw EIP-1193 provider as an x402-client {@link Signer}. The
 * returned signer resolves its address lazily on each call so wallet
 * account changes that happen between signatures are picked up
 * automatically, unless an explicit `account` is supplied via options.
 */
export function signerFromEip1193(
  provider: Eip1193Provider,
  options: SignerFromEip1193Options = {},
): Signer {
  const resolveAddress = async (): Promise<Address> => {
    if (options.account) return getAddress(options.account);
    const method = options.requestAccounts ? "eth_requestAccounts" : "eth_accounts";
    const accounts = await provider.request({ method });
    if (!Array.isArray(accounts) || accounts.length === 0 || typeof accounts[0] !== "string") {
      throw new Error(`signerFromEip1193: provider returned no accounts for ${method}`);
    }
    return getAddress(accounts[0]);
  };

  return {
    getAddress: resolveAddress,
    signTypedData: async ({ domain, types, primaryType, message }) => {
      const from = await resolveAddress();
      const typedData = {
        domain,
        types: { ...types, EIP712Domain: getTypesForEIP712Domain({ domain }) },
        primaryType,
        message,
      };
      const json = serializeTypedData(typedData as unknown as TypedDataDefinition);
      const sig = await provider.request({
        method: "eth_signTypedData_v4",
        params: [from, json],
      });
      if (typeof sig !== "string" || !/^0x[0-9a-fA-F]+$/.test(sig)) {
        throw new Error(
          "signerFromEip1193: provider.request did not return a hex signature string",
        );
      }
      return sig as Hex;
    },
  };
}
