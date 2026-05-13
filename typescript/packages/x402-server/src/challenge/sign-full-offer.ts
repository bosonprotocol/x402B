// FullOffer signer hook — produces the seller's `BosonOfferRef` from
// an unsigned FullOffer. Wraps `@bosonprotocol/x402-core/eip712`'s
// `fullOfferTypedData` to build the EIP-712 typed-data, then hands it
// to the configured `SellerSigner` for signing.
//
// Output is the literal `{ fullOffer, sellerSig, creator }` shape that
// goes into `EscrowPaymentRequirements.offer`, validated against
// `recoverFullOfferSigner` to guard against signer/address mismatch.

import { fullOfferTypedData, type UnsignedFullOffer } from "@bosonprotocol/x402-core/eip712";
import type { Address, BosonOfferRef, FullOffer } from "@bosonprotocol/x402-core/schemes/escrow";
import type { Address as ViemAddress, Hex } from "viem";

import type { SellerSigner } from "../config.js";

export interface SignFullOfferArgs {
  fullOffer: UnsignedFullOffer;
  signer: SellerSigner;
  /** Boson Diamond address — the EIP-712 `verifyingContract`. */
  escrow: Address;
  chainId: number;
}

/**
 * Build the FullOffer EIP-712 typed-data, sign it with the seller's
 * signer, and return a `BosonOfferRef` ready to embed in a 402
 * `PaymentRequirements`.
 *
 * The returned `creator` is the seller signer's address. Callers that
 * need to support ERC-1271 contract-wallet sellers can pass the
 * contract address as `signer.address` and route signing through a
 * custom `signTypedData` that proxies to the wallet — the recovery
 * step in `verifyOffer` on-chain runs via `EIP712Lib.verify`, which
 * already handles both ECDSA and ERC-1271.
 */
export async function signFullOffer({
  fullOffer,
  signer,
  escrow,
  chainId,
}: SignFullOfferArgs): Promise<BosonOfferRef> {
  // The wire-format `Address` is a plain string (validated at the zod
  // boundary); viem's typed-data builder wants its template-literal
  // `0x${string}` brand. Coerce at this boundary only.
  const td = await fullOfferTypedData({
    fullOffer,
    verifyingContract: escrow as ViemAddress,
    chainId,
  });

  const sellerSig: Hex = await signer.signTypedData({
    domain: td.domain,
    types: td.types,
    primaryType: td.primaryType,
    message: td.message,
  });

  return {
    fullOffer: fullOffer as unknown as FullOffer,
    sellerSig,
    creator: signer.address,
  };
}
