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
// `web3Lib`. We therefore pass a stub adapter whose methods all throw if
// called — making any future use of web3Lib loud rather than silent.
//
// The result hashes against the same Boson EIP-712 domain that
// `verifyOffer` uses on-chain (salt-based, "Boson Protocol" name) — the
// shape comes straight from core-sdk so we don't redefine it here.

import { exchanges } from "@bosonprotocol/core-sdk";
import type { FullOfferArgs, Web3LibAdapter } from "@bosonprotocol/common";
import { hashTypedData, recoverTypedDataAddress, type Address, type Hex } from "viem";

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

/**
 * Stub `Web3LibAdapter`. core-sdk's `signFullOffer` requires this argument
 * even when `returnTypedDataToSign: true`, but never calls any method in
 * that branch. If any method does end up invoked, throw loudly rather than
 * fall through with a default.
 */
const STUB_WEB3LIB: Web3LibAdapter = {
  uuid: "x402-core:stub",
  getSignerAddress: () => Promise.reject(unreachable("getSignerAddress")),
  isSignerContract: () => Promise.reject(unreachable("isSignerContract")),
  getChainId: () => Promise.reject(unreachable("getChainId")),
  getBalance: () => Promise.reject(unreachable("getBalance")),
  estimateGas: () => Promise.reject(unreachable("estimateGas")),
  sendTransaction: () => Promise.reject(unreachable("sendTransaction")),
  call: () => Promise.reject(unreachable("call")),
  send: () => Promise.reject(unreachable("send")),
  getTransactionReceipt: () => Promise.reject(unreachable("getTransactionReceipt")),
  getCurrentTimeMs: () => Promise.reject(unreachable("getCurrentTimeMs")),
};

function unreachable(method: string): Error {
  return new Error(
    `@bosonprotocol/x402-core: stub Web3LibAdapter.${method}() should never be called when ` +
      `returnTypedDataToSign is true. If you see this, either core-sdk changed its ` +
      `behaviour or the stub leaked into a non-signing-only path — file a bug.`,
  );
}

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
    web3Lib: STUB_WEB3LIB,
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
