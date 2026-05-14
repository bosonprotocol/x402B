// EIP-712 typed-data builder for ERC-3009 `ReceiveWithAuthorization`.
//
// Boson uses the receive variant per docs/boson-impl-01-escrow-scheme.md §4.3
// because only the recipient (Boson escrow contract) can call
// `receiveWithAuthorization`, eliminating relayer front-running. The struct
// fields are identical to ERC-3009's `TransferWithAuthorization` — only the
// on-chain function name and primary type differ. The shape is fixed by
// EIP-3009 and hasn't changed since the standard was published.
//
// `@bosonprotocol/core-sdk` exposes the same type-list internally inside
// `signReceiveWithErc3009Authorization` but auto-generates the `nonce`
// before returning typed-data. The verification path needs a caller-supplied
// nonce (so it can rebuild the digest the buyer signed), so this module
// keeps a standalone typed-data builder. A KAT cross-validation test
// (`sdk-parity.test.ts`) asserts the type-list matches the SDK's internal
// one, catching drift if either side ever changes.

import { hashTypedData, recoverTypedDataAddress, type Address, type Hex } from "viem";

import type { TokenEip712Domain } from "./domain.js";

/** EIP-712 type definition, keyed under the Boson-side primary type. */
export const ERC3009_TYPES = {
  ReceiveWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

export const ERC3009_PRIMARY_TYPE = "ReceiveWithAuthorization" as const;

export interface Erc3009Message {
  from: Address;
  to: Address;
  value: bigint;
  validAfter: bigint;
  validBefore: bigint;
  /** 32-byte hex; should be cryptographically random per the ERC-3009 spec. */
  nonce: Hex;
}

export interface Erc3009TypedDataArgs {
  /**
   * The token contract's own EIP-712 domain. ERC-3009 requires
   * `{ name, version, chainId, verifyingContract }` to match what the
   * token recovers on-chain — see {@link TokenEip712Domain}.
   */
  domain: TokenEip712Domain;
  message: Erc3009Message;
}

export interface Erc3009TypedData {
  domain: TokenEip712Domain;
  types: typeof ERC3009_TYPES;
  primaryType: typeof ERC3009_PRIMARY_TYPE;
  message: Erc3009Message;
}

export function erc3009TypedData({ domain, message }: Erc3009TypedDataArgs): Erc3009TypedData {
  return { domain, types: ERC3009_TYPES, primaryType: ERC3009_PRIMARY_TYPE, message };
}

export function hashErc3009Authorization(args: Erc3009TypedDataArgs): Hex {
  return hashTypedData(erc3009TypedData(args));
}

export async function recoverErc3009Signer(
  args: Erc3009TypedDataArgs & { signature: Hex },
): Promise<Address> {
  const { signature, ...rest } = args;
  return recoverTypedDataAddress({ ...erc3009TypedData(rest), signature });
}
