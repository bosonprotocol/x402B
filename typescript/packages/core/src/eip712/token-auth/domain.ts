// EIP-712 domain shape every BPIP-12 token-auth signer expects.
//
// Both ERC-3009 (`ReceiveWithAuthorization`) and EIP-2612 (`Permit`) sign
// against the *token contract's* EIP-712 domain. Per their respective
// standards the domain MUST contain `{ name, version, chainId,
// verifyingContract }` to match the digest the token recovers on-chain;
// viem's `TypedDataDomain` types all four fields as optional, so callers
// could accidentally hash with an incomplete domain and produce a
// signature the token rejects. This type tightens those four fields to
// required while still allowing additional EIP-712 domain fields a token
// might publish (e.g. `salt`).

import type { Address, Hex } from "viem";

export interface TokenEip712Domain {
  /** Token's `EIP712Domain.name`, e.g. `"USD Coin"`. */
  name: string;
  /** Token's `EIP712Domain.version`, e.g. `"2"`. */
  version: string;
  chainId: number;
  /** Token contract address. */
  verifyingContract: Address;
  /** Optional extra domain field some tokens publish. */
  salt?: Hex;
}
