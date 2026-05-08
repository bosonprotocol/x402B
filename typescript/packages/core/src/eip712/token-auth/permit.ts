// EIP-712 typed-data builder for EIP-2612 `Permit`.
//
// `@x402/evm@2.11.0` does not expose the EIP-2612 Permit type definition
// (it's reserved for that package's internal sign-permit flow inside the
// exact scheme), so this module hand-mirrors the standard 5-field shape:
//   Permit(address owner, address spender, uint256 value, uint256 nonce, uint256 deadline)
// which is identical across every well-implemented EIP-2612 token.

import {
  hashTypedData,
  recoverTypedDataAddress,
  type Address,
  type Hex,
  type TypedDataDomain,
} from "viem";

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
   * The token contract's own EIP-712 domain. EIP-2612 prescribes
   * `{ name, version, chainId, verifyingContract: tokenAddress }`.
   */
  domain: TypedDataDomain;
  message: PermitMessage;
}

export interface PermitTypedData {
  domain: TypedDataDomain;
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
