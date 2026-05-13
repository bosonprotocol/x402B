// Broadcast the envelope and await the receipt.
//
// Submission uses the configured viem `WalletClient` (the relayer pays
// gas); we then call `waitForTransactionReceipt` on the `PublicClient`
// to confirm the transaction mined. A receipt with `status !== "success"`
// is an on-chain revert — surfaced as `ONCHAIN_REVERT`. Pre-broadcast
// operator/provider failures remain distinguishable as INTERNAL_ERROR,
// except relayer balance failures which map to INSUFFICIENT_FUNDS_FOR_GAS.
//
// Note: `walletClient.sendTransaction` here goes through whatever
// account/transport the operator configured. We don't fetch a fresh
// nonce or set gas price — that's the wallet client's responsibility,
// kept out of this package per the v0.1 scope of
// docs/boson-impl-07-facilitator.md.

import type { Hex } from "@bosonprotocol/x402-core/schemes/escrow";
import type { TxRequest } from "@bosonprotocol/x402-evm/envelope";
import {
  BaseError,
  ContractFunctionRevertedError,
  ExecutionRevertedError,
  InsufficientFundsError,
  RawContractError,
  type PublicClient,
  type TransactionReceipt,
  type WalletClient,
} from "viem";

import type { FacilitatorErrorCode } from "../types.js";

export interface SubmitArgs {
  tx: TxRequest;
  walletClient: WalletClient;
  publicClient: PublicClient;
}

export type SubmitResult =
  | { ok: true; txHash: Hex; receipt: TransactionReceipt }
  | { ok: false; code: FacilitatorErrorCode; reason: string };

export async function submit(args: SubmitArgs): Promise<SubmitResult> {
  const account = args.walletClient.account;
  if (!account) {
    return {
      ok: false,
      code: "INTERNAL_ERROR",
      reason: "walletClient has no account; cannot send transaction",
    };
  }
  const chain = args.walletClient.chain ?? null;
  let txHash: Hex;
  try {
    txHash = await args.walletClient.sendTransaction({
      account,
      chain,
      to: args.tx.to as `0x${string}`,
      data: args.tx.data as `0x${string}`,
      value: args.tx.value ?? 0n,
    });
  } catch (e) {
    return classifySendError(e);
  }
  const receipt = await args.publicClient.waitForTransactionReceipt({
    hash: txHash as `0x${string}`,
  });
  if (receipt.status !== "success") {
    return {
      ok: false,
      code: "ONCHAIN_REVERT",
      reason: `transaction ${txHash} reverted on-chain`,
    };
  }
  return { ok: true, txHash, receipt };
}

function classifySendError(e: unknown): Exclude<SubmitResult, { ok: true }> {
  const reason = e instanceof Error ? `sendTransaction failed: ${e.message}` : "sendTransaction failed";

  if (hasViemCause(e, InsufficientFundsError)) {
    return { ok: false, code: "INSUFFICIENT_FUNDS_FOR_GAS", reason };
  }
  if (
    hasViemCause(e, ExecutionRevertedError) ||
    hasViemCause(e, ContractFunctionRevertedError) ||
    hasViemCause(e, RawContractError)
  ) {
    return { ok: false, code: "ONCHAIN_REVERT", reason };
  }
  return { ok: false, code: "INTERNAL_ERROR", reason };
}

function hasViemCause<T extends abstract new (...args: never[]) => Error>(
  e: unknown,
  ctor: T,
): boolean {
  if (e instanceof ctor) return true;
  if (!(e instanceof BaseError)) return false;
  return e.walk((err) => err instanceof ctor) !== null;
}
