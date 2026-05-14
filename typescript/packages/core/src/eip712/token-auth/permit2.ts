// EIP-712 typed-data builder for Uniswap Permit2 `PermitTransferFrom`.
//
// Boson uses the no-witness `PermitTransferFrom` flavor per
// docs/boson-impl-01-escrow-scheme.md §4.3 (the witness-bearing
// `PermitWitnessTransferFrom` variant is for x402's exact scheme, which
// pins the recipient inside the witness — Boson doesn't need that since
// the escrow contract is the only valid recipient anyway).
//
// `@bosonprotocol/core-sdk` exposes the same type-list internally inside
// `signReceiveWithPermit2`, but routes the Permit2 contract address through
// `_contracts.permit2` (or `overrides.permit2Address`) on the configured
// SDK instance. The verification path needs a stable canonical address
// without an SDK round-trip, and the type-list is fixed by Permit2's
// deployed contract — so this module keeps the canonical address +
// type-list hand-defined as Uniswap protocol constants. A KAT
// cross-validation test (`sdk-parity.test.ts`) asserts the type-list
// matches the SDK's internal one, catching drift.
//
// `@x402/evm`'s public `./exact/client` exposes `createPermit2ApprovalTx`
// and `getPermit2AllowanceReadParams` (re-exported below).

import { createPermit2ApprovalTx, getPermit2AllowanceReadParams } from "@x402/evm/exact/client";
import {
  hashTypedData,
  recoverTypedDataAddress,
  type Address,
  type Hex,
  type TypedDataDomain,
} from "viem";

export { createPermit2ApprovalTx, getPermit2AllowanceReadParams };

/**
 * Canonical Permit2 contract address. Same on every EVM chain via CREATE2
 * deployment.
 *
 * @see https://github.com/Uniswap/permit2
 */
export const PERMIT2_ADDRESS: Address = "0x000000000022D473030F116dDEE9F6B43aC78BA3";

/** Permit2's EIP-712 `name` field. No `version`, no `salt`. */
export const PERMIT2_DOMAIN_NAME = "Permit2" as const;

export const PERMIT2_TYPES = {
  PermitTransferFrom: [
    { name: "permitted", type: "TokenPermissions" },
    { name: "spender", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
  TokenPermissions: [
    { name: "token", type: "address" },
    { name: "amount", type: "uint256" },
  ],
} as const;

export const PERMIT2_PRIMARY_TYPE = "PermitTransferFrom" as const;

export interface Permit2Message {
  permitted: { token: Address; amount: bigint };
  spender: Address;
  /** Permit2 word-bitmap nonce. */
  nonce: bigint;
  deadline: bigint;
}

export interface Permit2TypedDataArgs {
  chainId: number;
  message: Permit2Message;
}

export interface Permit2TypedData {
  domain: TypedDataDomain;
  types: typeof PERMIT2_TYPES;
  primaryType: typeof PERMIT2_PRIMARY_TYPE;
  message: Permit2Message;
}

/** Permit2's EIP-712 domain on a given chain. The `verifyingContract` is the canonical Permit2 address. */
export function permit2Domain(chainId: number): TypedDataDomain {
  return { name: PERMIT2_DOMAIN_NAME, chainId, verifyingContract: PERMIT2_ADDRESS };
}

export function permit2TypedData({ chainId, message }: Permit2TypedDataArgs): Permit2TypedData {
  return {
    domain: permit2Domain(chainId),
    types: PERMIT2_TYPES,
    primaryType: PERMIT2_PRIMARY_TYPE,
    message,
  };
}

export function hashPermit2(args: Permit2TypedDataArgs): Hex {
  return hashTypedData(permit2TypedData(args));
}

export async function recoverPermit2Signer(
  args: Permit2TypedDataArgs & { signature: Hex },
): Promise<Address> {
  const { signature, ...rest } = args;
  return recoverTypedDataAddress({ ...permit2TypedData(rest), signature });
}
