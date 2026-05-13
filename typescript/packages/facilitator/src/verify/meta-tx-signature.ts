// Meta-tx signature recovery.
//
// The buyer signs the Boson `MetaTransaction` EIP-712 typed-data with
// the Diamond as the verifying contract. We reconstruct the same
// typed-data via `metaTransactionTypedData()` from
// `@bosonprotocol/x402-core/eip712` (which delegates the EIP-712 domain
// to `@bosonprotocol/core-sdk` so we stay in lock-step with the deployed
// protocol), then recover the signer with viem.

import { metaTransactionTypedData } from "@bosonprotocol/x402-core/eip712";
import type { Address, BosonMetaTx, Hex } from "@bosonprotocol/x402-core/schemes/escrow";
import { recoverTypedDataAddress } from "viem";

import type { StepResult } from "./structural.js";

export interface VerifyMetaTxSignatureArgs {
  chainId: number;
  /** Boson escrow (Diamond) address — the EIP-712 verifyingContract. */
  escrowAddress: Address;
  /** The meta-tx envelope from the payload. */
  metaTx: BosonMetaTx;
  /** Buyer wallet from the payload — the recovered signer must match this. */
  buyer: Address;
}

/**
 * Recover the meta-tx signer and confirm it matches `buyer`. The on-chain
 * `MetaTransactionsHandlerFacet.executeMetaTransaction` recovers signatures
 * with `LibSignature.recover`, which accepts only the legacy `v ∈ {27, 28}`
 * form — reject `v ∈ {0, 1}` upfront with a clear error rather than letting
 * the simulation fail later.
 */
export async function verifyMetaTxSignature(args: VerifyMetaTxSignatureArgs): Promise<StepResult> {
  const { v, r, s } = args.metaTx.sig;
  if (v !== 27 && v !== 28) {
    return {
      ok: false,
      code: "BAD_META_TX_SIGNATURE",
      reason: `meta-tx signature v must be 27 or 28, got ${v}`,
    };
  }
  const typedData = await metaTransactionTypedData({
    chainId: args.chainId,
    verifyingContract: args.escrowAddress as `0x${string}`,
    message: {
      nonce: BigInt(args.metaTx.nonce),
      from: args.metaTx.from as `0x${string}`,
      contractAddress: args.escrowAddress as `0x${string}`,
      functionName: args.metaTx.functionName,
      functionSignature: args.metaTx.functionSignature as `0x${string}`,
    },
  });
  const signature = packRsv(r as Hex, s as Hex, v);
  let recovered: Address;
  try {
    recovered = await recoverTypedDataAddress({
      domain: typedData.domain,
      types: typedData.types,
      primaryType: typedData.primaryType,
      message: typedData.message,
      signature: signature as `0x${string}`,
    });
  } catch (e) {
    return {
      ok: false,
      code: "BAD_META_TX_SIGNATURE",
      reason: e instanceof Error ? `recovery failed: ${e.message}` : "recovery failed",
    };
  }
  if (recovered.toLowerCase() !== args.buyer.toLowerCase()) {
    return {
      ok: false,
      code: "BAD_META_TX_SIGNATURE",
      reason: `recovered signer ${recovered} != payload.buyer ${args.buyer}`,
    };
  }
  // The protocol uses `metaTx.from` as the from-address recovered from the
  // signature too; verify that this matches the buyer (the spec treats
  // metaTx.from and payload.buyer as the same EOA).
  if (args.metaTx.from.toLowerCase() !== args.buyer.toLowerCase()) {
    return {
      ok: false,
      code: "BAD_META_TX_SIGNATURE",
      reason: `metaTx.from ${args.metaTx.from} != payload.buyer ${args.buyer}`,
    };
  }
  return { ok: true };
}

/** Pack split ECDSA signature into the 65-byte `r ++ s ++ v` form viem expects. */
export function packRsv(r: Hex, s: Hex, v: number): Hex {
  const vHex = v.toString(16).padStart(2, "0");
  return `0x${r.slice(2)}${s.slice(2)}${vHex}` as Hex;
}
