// Build and sign the buyer's EIP-2612 `Permit` for the escrow contract via
// `CoreSDK.signReceiveWithErc2612Permit`.
//
// The SDK fetches the token's `nonces(owner)` via `web3Lib.call(...)` before
// signing — that path requires the client's `signerToWeb3LibAdapter` to have
// been built with a configured `PublicClient`. Without one, the underlying
// `eth_call` rejects with a clear "no PublicClient configured" error,
// surfaced to the caller as a sign-time failure.
//
// The SDK returns `{ strategy: "EIP2612", data: { deadline }, r, s, v,
// signature }` — note that the nonce *is not* part of `data`. The wire
// format `PermitAuthData` carries the nonce because the facilitator's
// verification path needs it to rebuild the digest the buyer signed (the
// on-chain `permit()` call refetches the current nonce, but the signature
// is locked to the value at sign time). We recover it from the SDK's
// signed typed-data by paying a second on-chain read of `nonces(owner)`;
// in practice the value the SDK signed against is the one we observe
// (only an interleaved successful `permit()` between sign and read would
// shift it, which would then have invalidated the signature anyway).

import type { CoreSDK } from "@bosonprotocol/core-sdk";
import type {
  EscrowPaymentRequirements,
  PermitAuthData,
} from "@bosonprotocol/x402-core/schemes/escrow";
import {
  encodeFunctionData,
  decodeFunctionResult,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";

import { parseChainId } from "../core-sdk-factory.js";
import { UnsupportedTokenAuthError } from "../errors.js";
import type { TokenDomainResolver } from "../types.js";

const NONCES_ABI = [
  {
    type: "function",
    name: "nonces",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

export interface SignPermitArgs {
  requirements: EscrowPaymentRequirements;
  buyer: Address;
  coreSdk: CoreSDK;
  tokenDomainResolver: TokenDomainResolver;
  /** PublicClient for the chain — required to recover the nonce that the SDK signed against. */
  publicClient: PublicClient;
  /** Override the wall-clock; injected by tests for determinism. Defaults to `Date.now()`. */
  now?: () => number;
}

/**
 * Build the EIP-2612 Permit typed-data, sign it via core-sdk, look up the
 * token nonce the SDK signed against, and shape the result into the
 * `PermitAuthData` slot of the escrow payment payload.
 */
export async function signPermit({
  requirements,
  buyer,
  coreSdk,
  tokenDomainResolver,
  publicClient,
  now = Date.now,
}: SignPermitArgs): Promise<PermitAuthData> {
  const chainId = parseChainId(requirements.network);
  const domain = await tokenDomainResolver(requirements.asset as Address, chainId);

  const noncePreSign = await readNonce(publicClient, requirements.asset as Address, buyer);
  const deadline = Math.floor(now() / 1000) + requirements.maxTimeoutSeconds;

  const result = await coreSdk.signReceiveWithErc2612Permit(
    requirements.asset,
    { name: domain.name, version: domain.version },
    requirements.amount,
    deadline,
    { spender: requirements.escrowAddress as `0x${string}` },
  );

  const noncePostSign = await readNonce(publicClient, requirements.asset as Address, buyer);
  if (noncePreSign !== noncePostSign) {
    // A successful `permit()` for this owner landed on-chain between our
    // two reads, which means the SDK signed against either nonce. We can't
    // tell which without re-signing, so fail loudly.
    throw new UnsupportedTokenAuthError(
      `x402-client: token nonce shifted during permit signing (was ${noncePreSign}, now ${noncePostSign}); retry`,
    );
  }

  return {
    owner: buyer,
    spender: requirements.escrowAddress,
    value: requirements.amount,
    deadline,
    nonce: noncePreSign.toString(),
    v: result.v,
    r: result.r as Hex,
    s: result.s as Hex,
  };
}

async function readNonce(
  publicClient: PublicClient,
  token: Address,
  owner: Address,
): Promise<bigint> {
  const result = await publicClient.call({
    to: token as `0x${string}`,
    data: encodeFunctionData({
      abi: NONCES_ABI,
      functionName: "nonces",
      args: [owner as `0x${string}`],
    }),
  });
  if (!result.data) {
    throw new UnsupportedTokenAuthError(
      `x402-client: token ${token} did not return data for nonces(${owner}) — does it implement EIP-2612?`,
    );
  }
  return decodeFunctionResult({
    abi: NONCES_ABI,
    functionName: "nonces",
    data: result.data,
  });
}
