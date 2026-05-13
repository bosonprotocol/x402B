// EIP-712 typed-data builder for the BPIP-10 FullOffer signed by the seller.
//
// FullOffer's nested struct shape (Offer / OfferDates / OfferDurations /
// DRParameters / Condition / RoyaltyInfo) is large and protocol-internal — it
// can change as the contracts evolve. Rather than hand-mirroring it here,
// this module wraps `@bosonprotocol/core-sdk`'s
// `exchanges.handler.signFullOffer({..., returnTypedDataToSign: true})` and
// re-exposes the typed-data through a viem-friendly hash + recover API.
//
// In `returnTypedDataToSign: true` mode, core-sdk's `prepareDataSignatureParameters`
// returns the StructuredData immediately and never invokes any method on
// `web3Lib`. We therefore pass the shared throwing stub from
// `internal/web3lib-stub.ts` — any future use of web3Lib is loud rather than
// silent.
//
// The result hashes against the same Boson EIP-712 domain that
// `verifyOffer` uses on-chain (salt-based, "Boson Protocol" name) — the
// shape comes straight from core-sdk so we don't redefine it here.

import { exchanges } from "@bosonprotocol/core-sdk";
import type { FullOfferArgs } from "@bosonprotocol/common";
import { hashTypedData, recoverTypedDataAddress, type Address, type Hex } from "viem";

import { createThrowingWeb3LibAdapter } from "../internal/web3lib-stub.js";

/** Unsigned FullOffer payload — same shape core-sdk accepts. */
export type UnsignedFullOffer = Omit<FullOfferArgs, "signature">;

/** A single EIP-712 type field — a `{ name, type }` pair. */
export type TypedDataField = { name: string; type: string };

/**
 * EIP-712 typed-data ready for any viem signer. Uses a deliberately-loose
 * `types` shape (not viem's `TypedData`) because Boson's `EIP712Domain`
 * field set is non-standard and viem's strict union rejects it; consumers
 * pass this shape directly to `hashTypedData` / `signTypedData` /
 * `recoverTypedDataAddress`, which accept it structurally.
 */
export interface FullOfferTypedData {
  domain: Record<string, unknown>;
  types: Record<string, readonly TypedDataField[]>;
  primaryType: "FullOffer";
  message: Record<string, unknown>;
}

export interface FullOfferArgsForBuilder {
  fullOffer: UnsignedFullOffer;
  /** Address of the Boson escrow contract — the EIP-712 verifyingContract. */
  verifyingContract: Address;
  chainId: number;
}

const STUB_CALLER_TAG = "@bosonprotocol/x402-core:full-offer";

/**
 * Build EIP-712 typed-data for a FullOffer that the seller will sign.
 * Delegates the struct definition to `@bosonprotocol/core-sdk` so we stay in
 * lock-step with whatever shape the deployed protocol's `verifyOffer`
 * accepts.
 */
export async function fullOfferTypedData({
  fullOffer,
  verifyingContract,
  chainId,
}: FullOfferArgsForBuilder): Promise<FullOfferTypedData> {
  const sd = await exchanges.handler.signFullOffer({
    fullOfferArgsUnsigned: fullOffer,
    contractAddress: verifyingContract,
    chainId,
    web3Lib: createThrowingWeb3LibAdapter(STUB_CALLER_TAG),
    returnTypedDataToSign: true,
  });

  return {
    domain: sd.domain as unknown as Record<string, unknown>,
    types: sd.types as unknown as Record<string, readonly TypedDataField[]>,
    primaryType: "FullOffer",
    message: sd.message,
  };
}

/** EIP-712 digest for a FullOffer — what the seller signs. */
export async function hashFullOffer(args: FullOfferArgsForBuilder): Promise<Hex> {
  const td = await fullOfferTypedData(args);
  return hashTypedData(td as Parameters<typeof hashTypedData>[0]);
}

/** Recover the seller address from a FullOffer signature. */
export async function recoverFullOfferSigner(
  args: FullOfferArgsForBuilder & { signature: Hex },
): Promise<Address> {
  const { signature, ...rest } = args;
  const td = await fullOfferTypedData(rest);
  return recoverTypedDataAddress({
    domain: td.domain,
    types: td.types,
    primaryType: td.primaryType,
    message: td.message,
    signature,
  } as unknown as Parameters<typeof recoverTypedDataAddress>[0]);
}
