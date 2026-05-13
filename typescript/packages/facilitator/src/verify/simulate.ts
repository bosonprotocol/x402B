// On-chain simulation pre-flight.
//
// We don't reach for `publicClient.simulateContract` (which would require
// us to mirror or import the meta-tx handler's full viem-shaped ABI) —
// instead we lean on `@bosonprotocol/x402-evm`'s envelope builders to
// encode the outer envelope (the same calldata `settle()` will
// broadcast), then submit it via `publicClient.call` from the relayer's
// address. viem throws a structured error chain on revert; we walk that
// chain looking for a `RawContractError` /
// `ContractFunctionRevertedError` to distinguish a real on-chain revert
// from a transport-layer failure (HTTP timeout, JSON-RPC error, …) —
// only the former maps to `SIMULATION_REVERT`.
//
// This catches protocol-level reverts (duplicate nonce, insufficient
// buyer balance, paused contract, …) before `settle()` spends a single
// wei of gas.
//
// The BPIP-12 token-auth envelope is still deferred in
// `@bosonprotocol/x402-evm`, so non-`"none"` strategies short-circuit to
// `UNSUPPORTED_TOKEN_AUTH_STRATEGY` here rather than attempting to
// simulate with an empty `tokenTransferAuthorizations` queue (which
// would produce calldata that doesn't match what `settle()` would
// actually broadcast once the encoder ships).

import { buildExecuteMetaTransactionTx, type TxRequest } from "@bosonprotocol/x402-evm/envelope";
import type {
  Address,
  BosonMetaTx,
  Hex,
  TokenAuthStrategy,
} from "@bosonprotocol/x402-core/schemes/escrow";
import {
  BaseError,
  ContractFunctionRevertedError,
  RawContractError,
  type PublicClient,
} from "viem";

import type { StepResult } from "./structural.js";

export interface SimulateExecuteMetaTransactionArgs {
  escrowAddress: Address;
  buyer: Address;
  metaTx: BosonMetaTx;
  tokenAuthStrategy: TokenAuthStrategy;
  publicClient: PublicClient;
  /** Relayer's EOA — used as `msg.sender` for the `eth_call` simulation. */
  relayerAddress: Address;
}

export async function simulateExecuteMetaTransaction(
  args: SimulateExecuteMetaTransactionArgs,
): Promise<StepResult> {
  // The BPIP-12 envelope encoder is not yet shipped in
  // `@bosonprotocol/x402-evm` and even once it does, simulating with an
  // empty `tokenTransferAuthorizations` queue would produce calldata
  // that doesn't match what `settle()` would broadcast — the queue must
  // encode the buyer's signed authorization. Fail loudly until the
  // encoder is fully wired up.
  if (args.tokenAuthStrategy !== "none") {
    return {
      ok: false,
      code: "UNSUPPORTED_TOKEN_AUTH_STRATEGY",
      reason: `simulation for tokenAuthStrategy "${args.tokenAuthStrategy}" requires the BPIP-12 envelope builder, which is not yet shipped in @bosonprotocol/x402-evm`,
    };
  }

  let tx: TxRequest;
  try {
    tx = buildExecuteMetaTransactionTx({
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
  } catch (e) {
    return {
      ok: false,
      code: "INTERNAL_ERROR",
      reason: e instanceof Error ? e.message : String(e),
    };
  }

  try {
    await args.publicClient.call({
      account: args.relayerAddress as `0x${string}`,
      to: tx.to as `0x${string}`,
      data: tx.data as `0x${string}`,
    });
    return { ok: true };
  } catch (e) {
    if (isOnChainRevert(e)) {
      return {
        ok: false,
        code: "SIMULATION_REVERT",
        reason: extractRevertReason(e),
      };
    }
    // Transport-layer failure (RPC unreachable, HTTP timeout, malformed
    // response, …). Operators need to retry or investigate the RPC
    // provider — this is not a buyer-attributable error.
    return {
      ok: false,
      code: "INTERNAL_ERROR",
      reason: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Walk the viem error cause chain looking for a contract-level revert
 * marker. Returns false for non-viem errors and for viem transport
 * failures (HTTP / timeout / JSON-RPC) — only contract reverts carry a
 * `RawContractError` or `ContractFunctionRevertedError` in the chain.
 */
function isOnChainRevert(e: unknown): boolean {
  if (!(e instanceof BaseError)) return false;
  return (
    e.walk(
      (err) => err instanceof RawContractError || err instanceof ContractFunctionRevertedError,
    ) !== null
  );
}

/** Best-effort revert reason extracted from a viem error chain. */
function extractRevertReason(e: unknown): string {
  if (e instanceof BaseError) {
    const reverted = e.walk(
      (err) => err instanceof RawContractError || err instanceof ContractFunctionRevertedError,
    );
    if (reverted instanceof ContractFunctionRevertedError) {
      return reverted.reason ?? reverted.shortMessage ?? reverted.message;
    }
    if (reverted instanceof RawContractError) {
      return reverted.message || reverted.shortMessage || "execution reverted";
    }
    return e.shortMessage || e.message;
  }
  if (e instanceof Error) return e.message;
  return String(e);
}

// Re-export the hex-typed alias for downstream consumers — keeps this
// module's import surface narrow even when `verify/index.ts` only
// re-exports a subset.
export type { Hex };
