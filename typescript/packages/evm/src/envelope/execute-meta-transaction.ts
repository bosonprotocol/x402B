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
// The BPIP-12 variant `executeMetaTransactionWithTokenTransferAuthorization(...)`
// lives in the sibling `./execute-meta-transaction-with-token-auth.ts` module.

import { metaTx } from "@bosonprotocol/core-sdk";
import type { Address, Hex } from "viem";

import { packEcdsaSignature } from "../internal/signature-helpers.js";
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
  sig: { r: Hex; s: Hex; v: number | bigint };
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
