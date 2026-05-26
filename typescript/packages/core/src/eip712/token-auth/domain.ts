// EIP-712 domain shape every BPIP-12 token-auth signer expects, plus the
// on-chain helper that resolves it from the token contract.
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

import type { Address, Hex, PublicClient } from "viem";

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

// Duck-type check for viem's `ContractFunctionExecutionError` (and the
// other `ContractFunction*Error` subclasses it nests as a `cause`).
// We compare by `.name` rather than `instanceof` because the paywall's
// browser IIFE bundle ends up with multiple viem class instances
// (esbuild inlines viem along several import chains —
// `@bosonprotocol/x402-core`, `@bosonprotocol/x402-client-browser`,
// wagmi, and direct paywall imports — and class identity is not
// preserved across them). An `instanceof` check there would falsely
// re-throw what's really a "method not implemented" revert. Name
// strings are stable across bundles (viem sets them via
// `Object.defineProperty(this, "name", ...)`) and plain `Error` from
// transport failures still falls through to the rethrow path because
// its `.name` is `"Error"`.
function isContractFunctionError(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  return e.name.startsWith("ContractFunction");
}

/**
 * Look up the token's EIP-712 domain. Tries EIP-5267 first (one call,
 * canonical); falls back to `name()` + `version()` (with version
 * defaulting to `"1"` per EIP-2612 if `version()` reverts).
 *
 * Error handling: only contract-level errors (any `ContractFunction*`
 * class viem throws via `getContractError`) are treated as "method not
 * implemented" and trigger the fallback. RPC / transport failures
 * (HTTP timeouts, JSON-RPC errors) propagate as-is so the caller can
 * distinguish them and surface a clear internal error rather than a
 * silent fallback that fails again on the next call. `name()` is
 * required by ERC-20 so any failure there is a real error and
 * propagates.
 *
 * Both the facilitator (recovering a signature) and the browser paywall
 * (about to sign one) call this against the same chain — keeping the
 * lookup in one place keeps signer and verifier in lockstep.
 */
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
    if (!isContractFunctionError(e)) {
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
    if (!isContractFunctionError(e)) {
      throw e;
    }
    // version() is optional per EIP-2612 — keep the default.
  }
  return { name, version, chainId, verifyingContract: token };
}
