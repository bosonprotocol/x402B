// Wire-format codec for the post-commit `signedPayload` Hex.
//
// The signed-payload Hex is the ABI-encoded tuple
//   (address from, string functionName, bytes functionSignature,
//    uint256 nonce, uint8 v, bytes32 r, bytes32 s)
// — i.e. a serialised `BosonMetaTx` ready to be unpacked and wrapped in
// `MetaTransactionsHandlerFacet.executeMetaTransaction(...)`. It lives
// here so the buyer's client (encoding) and the facilitator (decoding)
// share one definition and cannot drift.

import type { BosonMetaTx, Hex } from "@bosonprotocol/x402-core/schemes/escrow";
import { decodeAbiParameters, encodeAbiParameters, type AbiParameter } from "viem";

const SIGNED_PAYLOAD_ABI: readonly AbiParameter[] = [
  { name: "from", type: "address" },
  { name: "functionName", type: "string" },
  { name: "functionSignature", type: "bytes" },
  { name: "nonce", type: "uint256" },
  { name: "v", type: "uint8" },
  { name: "r", type: "bytes32" },
  { name: "s", type: "bytes32" },
] as const;

/** Encode a BosonMetaTx as the wire-format Hex for `signedPayload`. */
export function encodeSignedPayload(metaTx: BosonMetaTx): Hex {
  return encodeAbiParameters(SIGNED_PAYLOAD_ABI, [
    metaTx.from as `0x${string}`,
    metaTx.functionName,
    metaTx.functionSignature as `0x${string}`,
    BigInt(metaTx.nonce),
    metaTx.sig.v,
    metaTx.sig.r as `0x${string}`,
    metaTx.sig.s as `0x${string}`,
  ]);
}

/** Decode the wire-format Hex back into a BosonMetaTx. */
export function decodeSignedPayload(signedPayload: Hex): BosonMetaTx {
  const [from, functionName, functionSignature, nonce, v, r, s] = decodeAbiParameters(
    SIGNED_PAYLOAD_ABI,
    signedPayload as `0x${string}`,
  ) as [`0x${string}`, string, `0x${string}`, bigint, number, `0x${string}`, `0x${string}`];
  return {
    from,
    functionName,
    functionSignature,
    nonce: nonce.toString(),
    sig: { v: Number(v), r, s },
  };
}
