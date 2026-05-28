// On-chain simulation pre-flight.
//
// Builds the outer-envelope calldata via core-sdk's
// `metaTx.handler.executeMetaTransaction(..., returnTxInfo: true)` (and
// the BPIP-12 token-auth variant when an authorization queue is
// supplied), then drives it through `publicClient.call` from the
// relayer's address. The `"none"` path targets
// `executeMetaTransaction`; ERC-3009 / Permit / Permit2 target
// `executeMetaTransactionWithTokenTransferAuthorization`.
//
// viem throws a structured error chain on revert; we walk that chain
// looking for an on-chain-revert marker to distinguish a real revert
// from a transport-layer failure (HTTP timeout, JSON-RPC error, …) —
// only the former maps to `SIMULATION_REVERT`. The markers are:
//   - `ContractFunctionRevertedError` / `RawContractError` — set by
//     viem actions with ABI context (`readContract`, `simulateContract`).
//   - `ExecutionRevertedError` — set by viem's `getNodeError` for any
//     RPC error whose `code === 3` (the standard JSON-RPC error code
//     for "execution reverted").
//
// Hardhat is the exception: it returns reverts as `-32603` ("Internal
// error") rather than `3`, with the actual revert text in the inner
// error's `details` field (e.g.
// "VM Exception while processing transaction: reverted with reason
// string 'ERC20: …'"). Viem can't classify that, so we fall back to
// matching the textual "reverted"/"VM Exception" wording in the
// error's `details` payload as a Hardhat-aware safety net. Transport
// failures still don't carry that wording and fall through to
// `INTERNAL_ERROR`.
//
// This catches protocol-level reverts (duplicate nonce, expired auth,
// insufficient buyer balance, paused contract, …) before `settle()`
// spends a single wei of gas.

import type {
  Address,
  BosonMetaTx,
  BosonTokenAuth,
  Hex,
  TokenAuthStrategy,
} from "@bosonprotocol/x402-core/schemes/escrow";
import {
  BaseError,
  ContractFunctionRevertedError,
  ExecutionRevertedError,
  RawContractError,
  type PublicClient,
} from "viem";

import { buildSettleCalldata } from "../internal/build-settle-calldata.js";

import type { StepResult } from "./structural.js";

export interface SimulateExecuteMetaTransactionArgs {
  escrowAddress: Address;
  buyer: Address;
  metaTx: BosonMetaTx;
  /** Action id from the payload — drives the BPIP-12 queue layout. */
  actionId: string;
  tokenAuthStrategy: TokenAuthStrategy;
  /** Required when `tokenAuthStrategy !== "none"`. */
  tokenAuth?: BosonTokenAuth;
  publicClient: PublicClient;
  /** Relayer's EOA — used as `msg.sender` for the `eth_call` simulation. */
  relayerAddress: Address;
}

export async function simulateExecuteMetaTransaction(
  args: SimulateExecuteMetaTransactionArgs,
): Promise<StepResult> {
  if (args.tokenAuthStrategy !== "none" && !args.tokenAuth) {
    return {
      ok: false,
      code: "INVALID_PAYLOAD",
      reason: `tokenAuthStrategy "${args.tokenAuthStrategy}" requires payload.tokenAuth but none was provided`,
    };
  }

  let calldata: { to: `0x${string}`; data: `0x${string}` };
  try {
    calldata = await buildSettleCalldata({
      escrowAddress: args.escrowAddress,
      userAddress: args.buyer,
      metaTx: args.metaTx,
      actionId: args.actionId,
      tokenAuthStrategy: args.tokenAuthStrategy,
      ...(args.tokenAuth !== undefined ? { tokenAuth: args.tokenAuth } : {}),
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
      to: calldata.to,
      data: calldata.data,
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
 * failures (HTTP / timeout / JSON-RPC). Contract reverts carry one of
 * `RawContractError` / `ContractFunctionRevertedError` (set by viem
 * actions with ABI context) or `ExecutionRevertedError` (set by viem's
 * `getNodeError` for RPC code 3). Hardhat returns reverts as code
 * `-32603` so we additionally match the "reverted"/"VM Exception"
 * wording viem copies into a `BaseError`'s `details` field.
 */
function isOnChainRevert(e: unknown): boolean {
  if (!(e instanceof BaseError)) return false;
  if (e.walk((err) => isRevertMarker(err)) !== null) return true;
  return e.walk((err) => isHardhatRevertDetails(err)) !== null;
}

/** Best-effort revert reason extracted from a viem error chain. */
function extractRevertReason(e: unknown): string {
  if (e instanceof BaseError) {
    const reverted = e.walk((err) => isRevertMarker(err));
    if (reverted instanceof ContractFunctionRevertedError) {
      return reverted.reason ?? reverted.shortMessage ?? reverted.message;
    }
    if (reverted instanceof RawContractError) {
      return reverted.message || reverted.shortMessage || "execution reverted";
    }
    if (reverted instanceof ExecutionRevertedError) {
      return reverted.shortMessage || reverted.message || "execution reverted";
    }
    const hardhatRevert = e.walk((err) => isHardhatRevertDetails(err));
    if (hardhatRevert instanceof BaseError) {
      return hardhatRevert.details || hardhatRevert.shortMessage || hardhatRevert.message;
    }
    return e.shortMessage || e.message;
  }
  if (e instanceof Error) return e.message;
  return String(e);
}

function isRevertMarker(err: unknown): boolean {
  return (
    err instanceof RawContractError ||
    err instanceof ContractFunctionRevertedError ||
    err instanceof ExecutionRevertedError
  );
}

const HARDHAT_REVERT_DETAILS = /reverted|VM Exception|out of gas/i;

function isHardhatRevertDetails(err: unknown): boolean {
  return err instanceof BaseError && HARDHAT_REVERT_DETAILS.test(err.details ?? "");
}

// Re-export the hex-typed alias for downstream consumers — keeps this
// module's import surface narrow even when `verify/index.ts` only
// re-exports a subset.
export type { Hex };
