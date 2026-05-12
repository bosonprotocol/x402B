// On-chain simulation pre-flight.
//
// We don't reach for `publicClient.simulateContract` (which would require
// us to mirror or import the meta-tx handler's full viem-shaped ABI) —
// instead we lean on `@bosonprotocol/x402-evm`'s
// `buildExecuteMetaTransactionTx` to encode the outer envelope (the same
// calldata `settle()` will broadcast), then submit it via
// `publicClient.call` from the relayer's address. viem throws a
// structured `CallExecutionError` on revert; we map the revert reason
// into a `SIMULATION_REVERT` result so the caller can surface it.
//
// This catches protocol-level reverts (duplicate nonce, expired
// token-auth, insufficient buyer balance, paused contract, …) before
// `settle()` spends a single wei of gas.

import { buildExecuteMetaTransactionTx } from "@bosonprotocol/x402-evm/envelope";
import type { Address, BosonMetaTx, Hex } from "@bosonprotocol/x402-core/schemes/escrow";
import { type PublicClient } from "viem";

import type { StepResult } from "./structural.js";

export interface SimulateExecuteMetaTransactionArgs {
  escrowAddress: Address;
  buyer: Address;
  metaTx: BosonMetaTx;
  publicClient: PublicClient;
  /** Relayer's EOA — used as `msg.sender` for the `eth_call` simulation. */
  relayerAddress: Address;
}

export async function simulateExecuteMetaTransaction(
  args: SimulateExecuteMetaTransactionArgs,
): Promise<StepResult> {
  const tx = buildExecuteMetaTransactionTx({
    escrowAddress: args.escrowAddress as `0x${string}`,
    userAddress: args.buyer as `0x${string}`,
    functionName: args.metaTx.functionName,
    functionSignature: args.metaTx.functionSignature as `0x${string}`,
    nonce: BigInt(args.metaTx.nonce),
    sig: {
      r: args.metaTx.sig.r as `0x${string}`,
      s: args.metaTx.sig.s as `0x${string}`,
      v: args.metaTx.sig.v,
    },
  });
  try {
    await args.publicClient.call({
      account: args.relayerAddress as `0x${string}`,
      to: tx.to as `0x${string}`,
      data: tx.data as `0x${string}`,
    });
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      code: "SIMULATION_REVERT",
      reason: extractRevertReason(e),
    };
  }
}

/** Best-effort revert reason from a viem `CallExecutionError`. */
function extractRevertReason(e: unknown): string {
  if (!(e instanceof Error)) return String(e);
  // viem's structured errors expose the revert reason as `shortMessage`,
  // and the full call stack as `message`. The short form is the most
  // useful for an HTTP error response; fall back to the long form.
  const maybeShort = (e as Error & { shortMessage?: string }).shortMessage;
  return maybeShort ?? e.message;
}

// Re-export the hex-typed alias for downstream consumers — keeps this
// module's import surface narrow even when `verify/index.ts` only
// re-exports a subset.
export type { Hex };
