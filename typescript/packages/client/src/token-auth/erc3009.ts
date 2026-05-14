// Build and sign the buyer's ERC-3009 `ReceiveWithAuthorization` for the
// escrow contract via `CoreSDK.signReceiveWithErc3009Authorization`.
//
// The SDK generates a 32-byte random nonce internally, builds the EIP-712
// typed-data against the token's domain (taken from `tokenDomainResolver`),
// signs through the configured `Web3LibAdapter`, and returns a
// `TransferAuthorization` with `{ strategy, data: { validAfter, validBefore,
// nonce }, r, s, v, signature }`. We re-shape the result into the
// `Erc3009AuthData` slot of the escrow payment payload.

import type { CoreSDK } from "@bosonprotocol/core-sdk";
import type {
  Erc3009AuthData,
  EscrowPaymentRequirements,
} from "@bosonprotocol/x402-core/schemes/escrow";
import type { Address, Hex } from "viem";

import { parseChainId } from "../core-sdk-factory.js";
import type { TokenDomainResolver } from "../types.js";

export interface SignErc3009Args {
  requirements: EscrowPaymentRequirements;
  buyer: Address;
  coreSdk: CoreSDK;
  tokenDomainResolver: TokenDomainResolver;
  /** Override the wall-clock; injected by tests for determinism. Defaults to `Date.now()`. */
  now?: () => number;
}

/**
 * Build the ERC-3009 typed-data, sign it via core-sdk, and shape the result
 * into the `Erc3009AuthData` slot of the escrow payment payload.
 */
export async function signErc3009({
  requirements,
  buyer,
  coreSdk,
  tokenDomainResolver,
  now = Date.now,
}: SignErc3009Args): Promise<Erc3009AuthData> {
  const chainId = parseChainId(requirements.network);
  const domain = await tokenDomainResolver(requirements.asset as Address, chainId);

  const validAfter = 0;
  const validBefore = Math.floor(now() / 1000) + requirements.maxTimeoutSeconds;

  const result = await coreSdk.signReceiveWithErc3009Authorization(
    requirements.asset,
    { name: domain.name, version: domain.version },
    requirements.amount,
    validAfter,
    validBefore,
    { spender: requirements.escrowAddress as `0x${string}` },
  );

  return {
    from: buyer,
    to: requirements.escrowAddress,
    value: requirements.amount,
    validAfter: Number(result.data.validAfter),
    validBefore: Number(result.data.validBefore),
    nonce: result.data.nonce as Hex,
    v: result.v,
    r: result.r as Hex,
    s: result.s as Hex,
  };
}
