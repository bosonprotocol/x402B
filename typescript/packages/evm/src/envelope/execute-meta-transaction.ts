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
 * contract's `LibSignature.recover` slices. `r` and `s` must each be exactly
 * a 32-byte hex word (no shortened representations — `LibSignature.recover`
 * does fixed-offset slicing and a malformed input would silently produce
 * revert-prone calldata). `v` must be 27 or 28 — the legacy Ethereum form;
 * we don't accept the 0/1 variant since the on-chain recover doesn't
 * normalise.
 */
function packEcdsaSignature(sig: { r: Hex; s: Hex; v: number }): Hex {
  assert32ByteHex(sig.r, "r");
  assert32ByteHex(sig.s, "s");
  if (sig.v !== 27 && sig.v !== 28) {
    throw new Error(`@bosonprotocol/x402-evm: meta-tx signature v must be 27 or 28, got ${sig.v}`);
  }
  const vHex = `0x${sig.v.toString(16).padStart(2, "0")}` as Hex;
  return concat([sig.r, sig.s, vHex]);
}

const WORD32_RE = /^0x[0-9a-fA-F]{64}$/;

function assert32ByteHex(value: Hex, field: "r" | "s"): void {
  if (!WORD32_RE.test(value)) {
    throw new Error(
      `@bosonprotocol/x402-evm: meta-tx signature ${field} must be a 32-byte hex value (0x-prefixed, 64 hex chars), got ${value}`,
    );
  }
}
