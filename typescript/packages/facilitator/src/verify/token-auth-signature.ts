// Token-auth signature recovery.
//
// For non-`"none"` strategies the buyer signed an EIP-712 payload against
// the token contract's own domain (ERC-3009, EIP-2612) or against Permit2
// (Uniswap). We delegate the typed-data + recovery to
// `@bosonprotocol/x402-core/eip712/token-auth`'s strategy-specific
// helpers (they hand-mirror the canonical EIP-712 type-lists) and only
// add the cross-field assertions: the recovered signer must equal the
// buyer, the asset and recipient must match the requirements, etc.
//
// For ERC-3009 / EIP-2612 we need the token's EIP-712 domain
// (`name`, `version`). We resolve it via EIP-5267's `eip712Domain()`
// when the token supports it, falling back to `name()` + `version()`
// with a default `"1"` if `version()` reverts (the EIP-2612 default).

import type { Address, BosonTokenAuth, Hex } from "@bosonprotocol/x402-core/schemes/escrow";
import {
  type TokenEip712Domain,
  recoverErc3009Signer,
  recoverPermit2Signer,
  recoverPermitSigner,
} from "@bosonprotocol/x402-core/eip712/token-auth";
import { type PublicClient } from "viem";

import { packRsv } from "./meta-tx-signature.js";
import type { StepResult } from "./structural.js";

export interface VerifyTokenAuthSignatureArgs {
  chainId: number;
  /** Asset (ERC-20 token) address from the requirements. */
  asset: Address;
  /** Expected token amount from the requirements, in atomic units. */
  amount: string;
  /** Maximum allowed validity window, in seconds. */
  maxTimeoutSeconds: number;
  /** Buyer EOA from the payload — the recovered signer must match this. */
  buyer: Address;
  /** Boson escrow (Diamond) address — the expected `to` / `spender`. */
  escrowAddress: Address;
  /** Discriminated union from the payload; never `"none"` (caller skips this step for none). */
  tokenAuth: BosonTokenAuth;
  /** Used to look up the token's EIP-712 domain (`name` / `version`) for ERC-3009 and EIP-2612. */
  publicClient: PublicClient;
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

/**
 * Look up the token's EIP-712 domain. Tries EIP-5267 first (one call,
 * canonical); falls back to `name()` + `version()` (with version
 * defaulting to `"1"` per EIP-2612 if the function reverts).
 *
 * Exported so tests can inject a mocked PublicClient and so future
 * caching layers can wrap it.
 */
export async function fetchTokenDomain(
  publicClient: PublicClient,
  token: Address,
  chainId: number,
): Promise<TokenEip712Domain> {
  try {
    const result = (await publicClient.readContract({
      address: token as `0x${string}`,
      abi: EIP5267_ABI,
      functionName: "eip712Domain",
    })) as readonly [Hex, string, string, bigint, Address, Hex, readonly bigint[]];
    return {
      name: result[1],
      version: result[2],
      chainId: Number(result[3]),
      verifyingContract: result[4] as `0x${string}`,
    };
  } catch {
    // EIP-5267 not implemented — fall back to name() + version().
  }
  const name = (await publicClient.readContract({
    address: token as `0x${string}`,
    abi: NAME_ABI,
    functionName: "name",
  })) as string;
  let version = "1";
  try {
    version = (await publicClient.readContract({
      address: token as `0x${string}`,
      abi: VERSION_ABI,
      functionName: "version",
    })) as string;
  } catch {
    // version() is optional per EIP-2612 — keep the default.
  }
  return { name, version, chainId, verifyingContract: token as `0x${string}` };
}

export async function verifyTokenAuthSignature(
  args: VerifyTokenAuthSignatureArgs,
): Promise<StepResult> {
  switch (args.tokenAuth.kind) {
    case "erc3009":
      return verifyErc3009(args, args.tokenAuth.data);
    case "permit":
      return verifyPermit(args, args.tokenAuth.data);
    case "permit2":
      return verifyPermit2(args, args.tokenAuth.data);
    default: {
      // Compile-time exhaustiveness check: a new `kind` added to the
      // `BosonTokenAuth` discriminated union without updating this
      // switch will break this `never` assignment, forcing the new
      // strategy to grow a matching `verifyXxx` helper here.
      const _exhaustive: never = args.tokenAuth;
      void _exhaustive;
      return {
        ok: false,
        code: "INVALID_PAYLOAD",
        reason: `unsupported tokenAuth.kind: ${(args.tokenAuth as { kind: string }).kind}`,
      };
    }
  }
}

async function verifyErc3009(
  args: VerifyTokenAuthSignatureArgs,
  data: Extract<BosonTokenAuth, { kind: "erc3009" }>["data"],
): Promise<StepResult> {
  if (data.v !== 27 && data.v !== 28) {
    return {
      ok: false,
      code: "BAD_TOKEN_AUTH_SIGNATURE",
      reason: `ERC-3009 signature v must be 27 or 28, got ${data.v}`,
    };
  }
  // Cross-field: from == buyer, to == escrow.
  if (data.from.toLowerCase() !== args.buyer.toLowerCase()) {
    return {
      ok: false,
      code: "BAD_TOKEN_AUTH_SIGNATURE",
      reason: `ERC-3009 from ${data.from} != payload.buyer ${args.buyer}`,
    };
  }
  if (data.to.toLowerCase() !== args.escrowAddress.toLowerCase()) {
    return {
      ok: false,
      code: "BAD_TOKEN_AUTH_SIGNATURE",
      reason: `ERC-3009 to ${data.to} != escrowAddress ${args.escrowAddress}`,
    };
  }
  if (data.value !== args.amount) {
    return {
      ok: false,
      code: "BAD_TOKEN_AUTH_SIGNATURE",
      reason: `ERC-3009 value ${data.value} != requirements.amount ${args.amount}`,
    };
  }
  const timeout = validateDeadlineWindow(
    data.validBefore,
    args.maxTimeoutSeconds,
    "ERC-3009 validBefore",
  );
  if (!timeout.ok) return timeout;

  const domain = await fetchTokenDomain(args.publicClient, args.asset, args.chainId);
  const signature = packRsv(data.r as Hex, data.s as Hex, data.v);
  let recovered: Address;
  try {
    recovered = await recoverErc3009Signer({
      domain,
      message: {
        from: data.from as `0x${string}`,
        to: data.to as `0x${string}`,
        value: BigInt(data.value),
        validAfter: BigInt(data.validAfter),
        validBefore: BigInt(data.validBefore),
        nonce: data.nonce as `0x${string}`,
      },
      signature: signature as `0x${string}`,
    });
  } catch (e) {
    return {
      ok: false,
      code: "BAD_TOKEN_AUTH_SIGNATURE",
      reason:
        e instanceof Error ? `ERC-3009 recovery failed: ${e.message}` : "ERC-3009 recovery failed",
    };
  }
  if (recovered.toLowerCase() !== args.buyer.toLowerCase()) {
    return {
      ok: false,
      code: "BAD_TOKEN_AUTH_SIGNATURE",
      reason: `ERC-3009 recovered signer ${recovered} != payload.buyer ${args.buyer}`,
    };
  }
  return { ok: true };
}

async function verifyPermit(
  args: VerifyTokenAuthSignatureArgs,
  data: Extract<BosonTokenAuth, { kind: "permit" }>["data"],
): Promise<StepResult> {
  if (data.v !== 27 && data.v !== 28) {
    return {
      ok: false,
      code: "BAD_TOKEN_AUTH_SIGNATURE",
      reason: `EIP-2612 Permit signature v must be 27 or 28, got ${data.v}`,
    };
  }
  if (data.owner.toLowerCase() !== args.buyer.toLowerCase()) {
    return {
      ok: false,
      code: "BAD_TOKEN_AUTH_SIGNATURE",
      reason: `Permit owner ${data.owner} != payload.buyer ${args.buyer}`,
    };
  }
  if (data.spender.toLowerCase() !== args.escrowAddress.toLowerCase()) {
    return {
      ok: false,
      code: "BAD_TOKEN_AUTH_SIGNATURE",
      reason: `Permit spender ${data.spender} != escrowAddress ${args.escrowAddress}`,
    };
  }
  if (data.value !== args.amount) {
    return {
      ok: false,
      code: "BAD_TOKEN_AUTH_SIGNATURE",
      reason: `Permit value ${data.value} != requirements.amount ${args.amount}`,
    };
  }
  const timeout = validateDeadlineWindow(data.deadline, args.maxTimeoutSeconds, "Permit deadline");
  if (!timeout.ok) return timeout;

  const domain = await fetchTokenDomain(args.publicClient, args.asset, args.chainId);
  const signature = packRsv(data.r as Hex, data.s as Hex, data.v);
  let recovered: Address;
  try {
    recovered = await recoverPermitSigner({
      domain,
      message: {
        owner: data.owner as `0x${string}`,
        spender: data.spender as `0x${string}`,
        value: BigInt(data.value),
        nonce: BigInt(data.nonce),
        deadline: BigInt(data.deadline),
      },
      signature: signature as `0x${string}`,
    });
  } catch (e) {
    return {
      ok: false,
      code: "BAD_TOKEN_AUTH_SIGNATURE",
      reason:
        e instanceof Error ? `Permit recovery failed: ${e.message}` : "Permit recovery failed",
    };
  }
  if (recovered.toLowerCase() !== args.buyer.toLowerCase()) {
    return {
      ok: false,
      code: "BAD_TOKEN_AUTH_SIGNATURE",
      reason: `Permit recovered signer ${recovered} != payload.buyer ${args.buyer}`,
    };
  }
  return { ok: true };
}

async function verifyPermit2(
  args: VerifyTokenAuthSignatureArgs,
  data: Extract<BosonTokenAuth, { kind: "permit2" }>["data"],
): Promise<StepResult> {
  if (data.permitted.token.toLowerCase() !== args.asset.toLowerCase()) {
    return {
      ok: false,
      code: "BAD_TOKEN_AUTH_SIGNATURE",
      reason: `Permit2 permitted.token ${data.permitted.token} != requirements.asset ${args.asset}`,
    };
  }
  if (data.spender.toLowerCase() !== args.escrowAddress.toLowerCase()) {
    return {
      ok: false,
      code: "BAD_TOKEN_AUTH_SIGNATURE",
      reason: `Permit2 spender ${data.spender} != escrowAddress ${args.escrowAddress}`,
    };
  }
  if (data.permitted.amount !== args.amount) {
    return {
      ok: false,
      code: "BAD_TOKEN_AUTH_SIGNATURE",
      reason: `Permit2 permitted.amount ${data.permitted.amount} != requirements.amount ${args.amount}`,
    };
  }
  const timeout = validateDeadlineWindow(data.deadline, args.maxTimeoutSeconds, "Permit2 deadline");
  if (!timeout.ok) return timeout;

  let recovered: Address;
  try {
    recovered = await recoverPermit2Signer({
      chainId: args.chainId,
      message: {
        permitted: {
          token: data.permitted.token as `0x${string}`,
          amount: BigInt(data.permitted.amount),
        },
        spender: data.spender as `0x${string}`,
        nonce: BigInt(data.nonce),
        deadline: BigInt(data.deadline),
      },
      signature: data.signature as `0x${string}`,
    });
  } catch (e) {
    return {
      ok: false,
      code: "BAD_TOKEN_AUTH_SIGNATURE",
      reason:
        e instanceof Error ? `Permit2 recovery failed: ${e.message}` : "Permit2 recovery failed",
    };
  }
  if (recovered.toLowerCase() !== args.buyer.toLowerCase()) {
    return {
      ok: false,
      code: "BAD_TOKEN_AUTH_SIGNATURE",
      reason: `Permit2 recovered signer ${recovered} != payload.buyer ${args.buyer}`,
    };
  }
  return { ok: true };
}

function validateDeadlineWindow(
  deadlineSeconds: number,
  maxTimeoutSeconds: number,
  label: string,
): StepResult {
  const nowSeconds = Math.floor(Date.now() / 1000);
  // Reject already-expired deadlines before checking the future-window —
  // an expired signature should never reach the on-chain simulation,
  // where it would surface as a less-actionable SIMULATION_REVERT.
  if (deadlineSeconds <= nowSeconds) {
    return {
      ok: false,
      code: "BAD_TOKEN_AUTH_SIGNATURE",
      reason: `${label} has already expired (deadline ${deadlineSeconds} <= now ${nowSeconds})`,
    };
  }
  if (deadlineSeconds - nowSeconds > maxTimeoutSeconds) {
    return {
      ok: false,
      code: "BAD_TOKEN_AUTH_SIGNATURE",
      reason: `${label} exceeds requirements.maxTimeoutSeconds (${maxTimeoutSeconds})`,
    };
  }
  return { ok: true };
}
