// `TokenDomainResolver` for ERC-3009 / EIP-2612 buyer signing.
//
// `@bosonprotocol/x402-client`'s dispatcher only picks ERC-3009 or
// Permit when the caller supplies a `tokenDomainResolver` — both
// strategies sign against the **token contract's** EIP-712 domain
// (`name`, `version`), not the escrow's, and the resolver lets the
// client read those without dragging in a chain-wide config blob.
//
// Mirrors the facilitator's `fetchTokenDomain` (which performs the same
// lookup on the verify path): try EIP-5267's canonical `eip712Domain()`
// first, fall back to `name()` + `version()` (with the EIP-2612 default
// of `"1"` if `version()` reverts). The facilitator's copy lives inside
// the facilitator package and isn't exported for reuse, so the harness
// keeps its own minimal copy — short, self-contained, and matched
// against the on-chain protocol's expectations.

import type { TokenDomainResolver } from "@bosonprotocol/x402-client";
import type { TokenEip712Domain } from "@bosonprotocol/x402-core/eip712/token-auth";
import { ContractFunctionExecutionError, type Address, type Hex, type PublicClient } from "viem";

const EIP5267_ABI = [
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

const NAME_ABI = [
  {
    type: "function",
    name: "name",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string" }],
  },
] as const;

const VERSION_ABI = [
  {
    type: "function",
    name: "version",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string" }],
  },
] as const;

/**
 * Build a `TokenDomainResolver` backed by an on-chain `PublicClient`.
 * The same resolver works for any ERC-20 that publishes either an
 * EIP-5267 `eip712Domain()` view or the EIP-2612 `name()`/`version()`
 * pair. Used by the scenario harness to wire ERC-3009 + Permit signing
 * for whichever test token the scenario picks.
 */
export function createChainTokenDomainResolver(publicClient: PublicClient): TokenDomainResolver {
  return async (asset, chainId) => fetchTokenDomain(publicClient, asset, chainId);
}

async function fetchTokenDomain(
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
