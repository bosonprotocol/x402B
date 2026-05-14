// EIP-712 typed-data builder for EIP-2612 `Permit`.
//
// Hand-mirrors the standard 5-field shape
//   Permit(address owner, address spender, uint256 value, uint256 nonce, uint256 deadline)
// which is identical across every well-implemented EIP-2612 token.
//
// `@bosonprotocol/core-sdk` exposes the same type-list internally inside
// `signReceiveWithErc2612Permit` but auto-fetches the `nonce` from the token
// via an on-chain `nonces(owner)` call before signing. The verification path
// needs a caller-supplied nonce (so it can rebuild the digest the buyer
// signed without going on-chain), so this module keeps a standalone
// typed-data builder. A KAT cross-validation test (`sdk-parity.test.ts`)
// asserts the type-list matches the SDK's internal one, catching drift if
// either side ever changes.

import { hashTypedData, recoverTypedDataAddress, type Address, type Hex } from "viem";

import type { TokenEip712Domain } from "./domain.js";

export const PERMIT_TYPES = {
  Permit: [
    { name: "owner", type: "address" },
    { name: "spender", type: "address" },
    { name: "value", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

export const PERMIT_PRIMARY_TYPE = "Permit" as const;

export interface PermitMessage {
  owner: Address;
  spender: Address;
  value: bigint;
  /** Token-internal sequential nonce — query via `IERC20Permit.nonces(owner)`. */
  nonce: bigint;
  deadline: bigint;
}

export interface PermitTypedDataArgs {
  /**
   * The token contract's own EIP-712 domain. EIP-2612 requires
   * `{ name, version, chainId, verifyingContract }` to produce the
   * digest the token recovers on-chain — see {@link TokenEip712Domain}.
   */
  domain: TokenEip712Domain;
  message: PermitMessage;
}

export interface PermitTypedData {
  domain: TokenEip712Domain;
  types: typeof PERMIT_TYPES;
  primaryType: typeof PERMIT_PRIMARY_TYPE;
  message: PermitMessage;
}

export function permitTypedData({ domain, message }: PermitTypedDataArgs): PermitTypedData {
  return { domain, types: PERMIT_TYPES, primaryType: PERMIT_PRIMARY_TYPE, message };
}

export function hashPermit(args: PermitTypedDataArgs): Hex {
  return hashTypedData(permitTypedData(args));
}

export async function recoverPermitSigner(
  args: PermitTypedDataArgs & { signature: Hex },
): Promise<Address> {
  const { signature, ...rest } = args;
  return recoverTypedDataAddress({ ...permitTypedData(rest), signature });
}
