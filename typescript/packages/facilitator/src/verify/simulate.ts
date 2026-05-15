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
// looking for a `RawContractError` / `ContractFunctionRevertedError` to
// distinguish a real on-chain revert from a transport-layer failure
// (HTTP timeout, JSON-RPC error, …) — only the former maps to
// `SIMULATION_REVERT`.
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
  RawContractError,
  type PublicClient,
} from "viem";

import { buildSettleCalldata } from "../internal/build-settle-calldata.js";
import {
  bosonTokenAuthToTransferAuthorization,
  type TransferAuthorization,
} from "../internal/token-auth-lift.js";

import type { StepResult } from "./structural.js";

export interface SimulateExecuteMetaTransactionArgs {
  escrowAddress: Address;
  buyer: Address;
  metaTx: BosonMetaTx;
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
  let transferAuthorizations: TransferAuthorization[] | undefined;
  if (args.tokenAuthStrategy !== "none") {
    if (!args.tokenAuth) {
      return {
        ok: false,
        code: "INVALID_PAYLOAD",
        reason: `tokenAuthStrategy "${args.tokenAuthStrategy}" requires payload.tokenAuth but none was provided`,
      };
    }
    transferAuthorizations = [bosonTokenAuthToTransferAuthorization(args.tokenAuth)];
  }

  let calldata: { to: string; data: string };
  try {
    calldata = await buildSettleCalldata({
      escrowAddress: args.escrowAddress,
      userAddress: args.buyer,
      metaTx: args.metaTx,
      transferAuthorizations,
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
      to: calldata.to as `0x${string}`,
      data: calldata.data as `0x${string}`,
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
