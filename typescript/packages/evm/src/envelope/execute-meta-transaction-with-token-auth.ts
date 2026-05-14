// Calldata builder for the BPIP-12 variant
// `MetaTransactionsHandlerFacet.executeMetaTransactionWithTokenTransferAuthorization(...)`.
//
// On-chain ABI (per `IBosonMetaTransactionsHandler.json`):
//
//   executeMetaTransactionWithTokenTransferAuthorization(
//     address _userAddress,
//     string  _functionName,
//     bytes   _functionSignature,
//     uint256 _nonce,
//     bytes   _signature,                  // packed r ++ s ++ v (65 bytes)
//     bytes   _tokenTransferAuthorization  // ABI-encoded queue via `erc20.handler.encodeTransferAuthorizationQueue`
//   ) external payable returns (bytes)
//
// We reuse `@bosonprotocol/core-sdk`'s public
// `metaTx.iface.metaTransactionsHandlerIface` (an ethers `Interface` built
// from `@bosonprotocol/common`'s `IBosonMetaTransactionsHandlerABI`) so the
// encoding tracks whatever shape the deployed protocol's
// `MetaTransactionsHandlerFacet` exposes — no hand-mirrored ABI here.
//
// `transferAuthorizations` accepts the SDK's typed `TransferAuthorization`
// discriminated union (ERC3009 / EIP2612 / Permit2 variants); the SDK's
// `erc20.handler.encodeTransferAuthorizationQueue` lays them out per
// BPIP-12's wire format and we hand the result to the meta-tx envelope as
// a single `bytes` field. Callers (typically a facilitator) construct the
// queue by lifting the buyer's wire-format `BosonTokenAuth` into a
// `TransferAuthorization`.

import { erc20, metaTx } from "@bosonprotocol/core-sdk";
import { concat, type Hex } from "viem";

import type { TxRequest } from "../types.js";
import type { BuildExecuteMetaTransactionArgs } from "./execute-meta-transaction.js";

/**
 * One entry of the BPIP-12 token-transfer authorization queue. Sourced
 * structurally from `erc20.handler.encodeTransferAuthorizationQueue`'s
 * input parameter rather than deep-imported, so the type tracks whatever
 * the SDK's public namespace exposes.
 */
export type TransferAuthorization = Parameters<
  typeof erc20.handler.encodeTransferAuthorizationQueue
>[0][number];

export interface BuildExecuteMetaTransactionWithTokenAuthArgs extends BuildExecuteMetaTransactionArgs {
  /**
   * BPIP-12 token-transfer authorization queue. The SDK's
   * `encodeTransferAuthorizationQueue` packs this into the single `bytes`
   * field the on-chain entrypoint consumes.
   */
  transferAuthorizations: readonly TransferAuthorization[];
}

/**
 * Build the `{ to, data }` transaction for the BPIP-12
 * `executeMetaTransactionWithTokenTransferAuthorization` entrypoint. The
 * caller (typically a facilitator or relayer) is responsible for
 * submitting and paying gas.
 */
export function buildExecuteMetaTransactionWithTokenAuthTx(
  args: BuildExecuteMetaTransactionWithTokenAuthArgs,
): TxRequest {
  const packedSig = packEcdsaSignature(args.sig);
  const queueBytes = erc20.handler.encodeTransferAuthorizationQueue([
    ...args.transferAuthorizations,
  ]) as Hex;
  const data = metaTx.iface.metaTransactionsHandlerIface.encodeFunctionData(
    "executeMetaTransactionWithTokenTransferAuthorization",
    [
      args.userAddress,
      args.functionName,
      args.functionSignature,
      args.nonce.toString(),
      packedSig,
      queueBytes,
    ],
  ) as Hex;
  return { to: args.escrowAddress, data };
}

/**
 * Pack a split ECDSA signature into the 65-byte `r ++ s ++ v` form the
 * contract's `LibSignature.recover` slices. Same shape as the sibling
 * `execute-meta-transaction.ts` packer; duplicated locally because the
 * `executeMetaTransaction` module keeps the helper private to avoid
 * leaking a low-level primitive into the package's public exports.
 */
function packEcdsaSignature(sig: { r: Hex; s: Hex; v: number | bigint }): Hex {
  assert32ByteHex(sig.r, "r");
  assert32ByteHex(sig.s, "s");
  const v = normalizeRecoveryId(sig.v);
  if (v !== 27 && v !== 28) {
    throw new Error(`@bosonprotocol/x402-evm: meta-tx signature v must be 27 or 28, got ${sig.v}`);
  }
  const vHex = `0x${v.toString(16).padStart(2, "0")}` as Hex;
  return concat([sig.r, sig.s, vHex]);
}

const WORD32_RE = /^0x[0-9a-fA-F]{64}$/;

function normalizeRecoveryId(v: number | bigint): number {
  return typeof v === "bigint" ? Number(v) : v;
}

function assert32ByteHex(value: Hex, field: "r" | "s"): void {
  if (!WORD32_RE.test(value)) {
    throw new Error(
      `@bosonprotocol/x402-evm: meta-tx signature ${field} must be a 32-byte hex value (0x-prefixed, 64 hex chars), got ${value}`,
    );
  }
}
