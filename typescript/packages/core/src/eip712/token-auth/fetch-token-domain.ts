// Shared resolver for a token contract's EIP-712 domain (`name`,
// `version`). ERC-3009 (`ReceiveWithAuthorization`) and EIP-2612
// (`Permit`) signers and the facilitator's verify path both need this
// lookup — keeping it in a single place ensures signing and verification
// stay in lock-step on one ABI surface and one fallback flow.
//
// Tries EIP-5267's canonical `eip712Domain()` view first; on a contract
// that doesn't implement it, falls back to ERC-20 `name()` + EIP-2612
// `version()` with `"1"` as the default if `version()` reverts (the
// EIP-2612-specified default).
//
// Error handling: only `ContractFunctionExecutionError` is treated as
// "method not implemented" and triggers a fallback. RPC / transport
// failures propagate as-is so callers can distinguish them and surface a
// clear failure rather than a silent fallback that fails again on the
// next call. `name()` is required by ERC-20 so any failure there is a
// real error and propagates.

import { ContractFunctionExecutionError, type Address, type Hex, type PublicClient } from "viem";

import type { TokenEip712Domain } from "./domain.js";

export const EIP5267_ABI = [
  {
    type: "function",
    name: "eip712Domain",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "fields", type: "bytes1" },
      { name: "name", type: "string" },
      { name: "version", type: "string" },
      { name: "chainId", type: "uint256" },
      { name: "verifyingContract", type: "address" },
      { name: "salt", type: "bytes32" },
      { name: "extensions", type: "uint256[]" },
    ],
  },
] as const;

export const NAME_ABI = [
  {
    type: "function",
    name: "name",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string" }],
  },
] as const;

export const VERSION_ABI = [
  {
    type: "function",
    name: "version",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string" }],
  },
] as const;

export async function fetchTokenDomain(
  publicClient: PublicClient,
  token: Address,
  chainId: number,
): Promise<TokenEip712Domain> {
  try {
    const result = (await publicClient.readContract({
      address: token,
      abi: EIP5267_ABI,
      functionName: "eip712Domain",
    })) as readonly [Hex, string, string, bigint, Address, Hex, readonly bigint[]];
    return {
      name: result[1],
      version: result[2],
      chainId: Number(result[3]),
      verifyingContract: result[4],
    };
  } catch (e) {
    if (!(e instanceof ContractFunctionExecutionError)) {
      throw e;
    }
    // EIP-5267 not implemented — fall back to name() + version().
  }
  const name = (await publicClient.readContract({
    address: token,
    abi: NAME_ABI,
    functionName: "name",
  })) as string;
  let version = "1";
  try {
    version = (await publicClient.readContract({
      address: token,
      abi: VERSION_ABI,
      functionName: "version",
    })) as string;
  } catch (e) {
    if (!(e instanceof ContractFunctionExecutionError)) {
      throw e;
    }
    // version() is optional per EIP-2612 — keep the default "1".
  }
  return { name, version, chainId, verifyingContract: token };
}
