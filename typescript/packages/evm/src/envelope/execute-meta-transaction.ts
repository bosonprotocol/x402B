// Calldata builder for the existing
// `MetaTransactionsHandlerFacet.executeMetaTransaction(...)` entrypoint.
//
// On-chain ABI (per `IBosonMetaTransactionsHandler.json`):
//
//   executeMetaTransaction(
//     address _userAddress,
//     string  _functionName,
//     bytes   _functionSignature,
//     uint256 _nonce,
//     bytes   _signature      // packed r ++ s ++ v (65 bytes)
//   ) external payable returns (bytes)
//
// We reuse `@bosonprotocol/core-sdk`'s public `metaTx.iface.metaTransactionsHandlerIface`
// (an ethers `Interface` built from `@bosonprotocol/common`'s
// `IBosonMetaTransactionsHandlerABI`) so the encoding tracks whatever
// shape the deployed protocol's `MetaTransactionsHandlerFacet` exposes —
// no hand-mirrored ABI here.
//
// The BPIP-12 variant
// `executeMetaTransactionWithTokenTransferAuthorization(...)` is intentionally
// absent — it ships as a throwing stub in `./deferred-execute-with-token-auth.ts`
// until core-sdk exposes the new ABI.

import { metaTx } from "@bosonprotocol/core-sdk";
import { concat, type Address, type Hex } from "viem";

import type { TxRequest } from "../types.js";

export interface BuildExecuteMetaTransactionArgs {
  /** Boson escrow (Diamond) address — the meta-tx target contract. */
  escrowAddress: Address;
  /** Buyer EOA (the `_userAddress` argument). Must match the meta-tx signer. */
  userAddress: Address;
  /** Solidity function-selector string for the inner action, e.g. `createOfferAndCommit(...)`. */
  functionName: string;
  /** ABI-encoded inner-action calldata (the `_functionSignature` argument). */
  functionSignature: Hex;
  /** `MetaTransactionsHandlerFacet.usedNonce[from][nonce]` replay-protection slot. */
  nonce: bigint;
  /** Buyer EIP-712 signature over the meta-tx typed-data — split form. */
  sig: { r: Hex; s: Hex; v: number };
}

/**
 * Build the `{ to, data }` transaction for the existing Boson
 * `executeMetaTransaction` entrypoint. The caller (typically a facilitator
 * or relayer) is responsible for submitting and paying gas.
 */
export function buildExecuteMetaTransactionTx(args: BuildExecuteMetaTransactionArgs): TxRequest {
  const packedSig = packEcdsaSignature(args.sig);
  const data = metaTx.iface.metaTransactionsHandlerIface.encodeFunctionData(
    "executeMetaTransaction",
    [args.userAddress, args.functionName, args.functionSignature, args.nonce.toString(), packedSig],
  ) as Hex;
  return { to: args.escrowAddress, data };
}

/**
 * Pack a split ECDSA signature into the 65-byte `r ++ s ++ v` form the
 * contract's `LibSignature.recover` slices. `v` must be 27 or 28 — the
 * legacy Ethereum form; we don't accept the 0/1 variant since the on-chain
 * recover doesn't normalise.
 */
function packEcdsaSignature(sig: { r: Hex; s: Hex; v: number }): Hex {
  if (sig.v !== 27 && sig.v !== 28) {
    throw new Error(`@bosonprotocol/x402-evm: meta-tx signature v must be 27 or 28, got ${sig.v}`);
  }
  const vHex = `0x${sig.v.toString(16).padStart(2, "0")}` as Hex;
  return concat([sig.r, sig.s, vHex]);
}
