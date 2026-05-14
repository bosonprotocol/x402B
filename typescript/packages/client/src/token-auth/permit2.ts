// Build and sign the buyer's Uniswap Permit2 `PermitTransferFrom` for the
// escrow contract via `CoreSDK.signReceiveWithPermit2`.
//
// The SDK accepts an optional `permit2Nonce` override; if omitted it
// generates a random uint256. We pass one explicitly via `randomUint256()`
// so tests can stub the RNG and so the value never depends on the SDK's
// internal nonce-generation surface. The Permit2 contract address comes
// from the wire-format `requirements.onchainHints?.permit2` when present,
// or falls back to the canonical CREATE2 vanity address re-exported from
// `@bosonprotocol/x402-core/eip712/token-auth`.
//
// Result shape from core-sdk:
//   { strategy: "Permit2", data: { nonce, deadline }, r, s, v, signature }
// — we lift it into the wire-format `Permit2AuthData`.

import type { CoreSDK } from "@bosonprotocol/core-sdk";
import { PERMIT2_ADDRESS } from "@bosonprotocol/x402-core/eip712/token-auth";
import type {
  EscrowPaymentRequirements,
  Permit2AuthData,
} from "@bosonprotocol/x402-core/schemes/escrow";
import type { Address, Hex } from "viem";

import { randomUint256 } from "../utils/crypto.js";

export interface SignPermit2Args {
  requirements: EscrowPaymentRequirements;
  buyer: Address;
  coreSdk: CoreSDK;
  /** Override the wall-clock; injected by tests for determinism. Defaults to `Date.now()`. */
  now?: () => number;
}

/**
 * Build the Permit2 `PermitTransferFrom` typed-data, sign it via core-sdk,
 * and shape the result into the `Permit2AuthData` slot of the escrow
 * payment payload.
 */
export async function signPermit2({
  requirements,
  buyer,
  coreSdk,
  now = Date.now,
}: SignPermit2Args): Promise<Permit2AuthData> {
  const deadline = Math.floor(now() / 1000) + requirements.maxTimeoutSeconds;
  const permit2Nonce = randomUint256();

  // `buyer` is exposed in the call site for symmetry with the other
  // strategies and to keep the function signature stable as we add
  // explicit-`user` overrides. Today the SDK derives `user` internally
  // from `coreSdk._web3Lib.getSignerAddress()`, which we route through the
  // configured `signer.getAddress()` in `signerToWeb3LibAdapter`.
  void buyer;

  const result = await coreSdk.signReceiveWithPermit2(
    requirements.asset,
    requirements.amount,
    deadline,
    {
      spender: requirements.escrowAddress as `0x${string}`,
      permit2Address: PERMIT2_ADDRESS,
      permit2Nonce,
    },
  );

  return {
    permitted: { token: requirements.asset, amount: requirements.amount },
    spender: requirements.escrowAddress,
    nonce: permit2Nonce.toString(),
    deadline,
    signature: result.signature as Hex,
  };
}
