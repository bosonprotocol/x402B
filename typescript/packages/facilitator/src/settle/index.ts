// `settle` — submit the buyer's signed meta-tx to the Boson Diamond.
//
// Pipeline:
//   1. Run `verify()` first — bail on any failure.
//   2. Build the optional `transferAuthorizations` queue from the
//      buyer's wire-format `tokenAuth` payload.
//   3. Submit via `coreSdk.executeMetaTransaction(...)` — the unified
//      core-sdk entrypoint that routes between `executeMetaTransaction`
//      (no token auth) and the BPIP-12
//      `executeMetaTransactionWithTokenTransferAuthorization` based on
//      whether `transferAuthorizations` is provided. The SDK drives the
//      tx through the relayer-side viem-backed Web3LibAdapter, which
//      submits via `walletClient.sendTransaction` and surfaces
//      classified errors as a tagged `RelayerSubmitError`.
//   4. Await the viem receipt; an on-chain revert surfaces as
//      ONCHAIN_REVERT.
//   5. Parse `BuyerCommitted` from the receipt to extract `exchangeId`.
//
// All steps return discriminated-union results — no thrown errors leak
// to the caller unless the underlying transport itself fails (those map
// to INTERNAL_ERROR via toResult()).

import { RelayerSubmitError } from "@bosonprotocol/x402-evm/adapters";

import { toResult } from "../errors.js";
import { createFacilitatorCoreSdk } from "../internal/core-sdk-factory.js";
import {
  bosonTokenAuthToTransferAuthorization,
  type TransferAuthorization,
} from "../internal/token-auth-lift.js";
import type {
  FacilitatorConfig,
  FacilitatorErrorCode,
  FacilitatorSettleInput,
  FacilitatorSettleResult,
} from "../types.js";
import { parseChainId } from "../verify/structural.js";
import { verify } from "../verify/index.js";

import { extractExchangeId } from "./extract-exchange-id.js";

export async function settle(
  input: FacilitatorSettleInput,
  config: FacilitatorConfig,
): Promise<FacilitatorSettleResult> {
  try {
    // 1. Verify first. The verify() result type doesn't carry a success
    //    payload, so we can re-emit failures as-is and proceed on ok.
    const v = await verify(input, config);
    if (!v.ok) return v;

    const inner = input.payload.payload;
    const escrowAddress = input.requirements.escrowAddress as `0x${string}`;

    // 2. Lift the buyer's tokenAuth (if any) into the SDK's
    //    `TransferAuthorization` queue. The verify step already
    //    validated payload structure, so a missing tokenAuth on a
    //    non-"none" strategy would have been caught upstream — guard
    //    again defensively here to keep `settle()` self-contained.
    let transferAuthorizations: TransferAuthorization[] | undefined;
    if (inner.tokenAuthStrategy !== "none") {
      if (!inner.tokenAuth) {
        return {
          ok: false,
          code: "INVALID_PAYLOAD",
          reason: `tokenAuthStrategy "${inner.tokenAuthStrategy}" requires payload.tokenAuth but none was provided`,
        };
      }
      transferAuthorizations = [bosonTokenAuthToTransferAuthorization(inner.tokenAuth)];
    }

    // 3. Submit through coreSdk.executeMetaTransaction. The mixin routes
    //    to executeMetaTransaction or
    //    executeMetaTransactionWithTokenTransferAuthorization based on
    //    whether transferAuthorizations is non-empty; the relayer wallet
    //    pays gas via the configured Web3LibAdapter.
    const chain = parseChainId(input.network);
    if (!chain.ok) return chain;
    const coreSdk = createFacilitatorCoreSdk({
      walletClient: config.walletClient,
      publicClient: config.publicClient,
      chainId: chain.chainId,
      escrowAddress,
    });

    const buyer = inner.buyer as `0x${string}`;
    let txHash: `0x${string}`;
    try {
      const response = await coreSdk.executeMetaTransaction(
        {
          functionName: inner.metaTx.functionName,
          functionSignature: inner.metaTx.functionSignature,
          nonce: inner.metaTx.nonce,
          sigR: inner.metaTx.sig.r,
          sigS: inner.metaTx.sig.s,
          sigV: inner.metaTx.sig.v,
          transferAuthorizations,
        },
        { userAddress: buyer, contractAddress: escrowAddress },
      );
      txHash = response.hash as `0x${string}`;
    } catch (e) {
      return mapSubmitError(e);
    }

    // 4. Wait for the viem receipt. We poll via publicClient directly
    //    (rather than core-sdk's response.wait()) so extractExchangeId
    //    sees the viem-shaped logs it parses against. wait() failures
    //    here are transport issues, not buyer-attributable reverts.
    let receipt;
    try {
      receipt = await config.publicClient.waitForTransactionReceipt({ hash: txHash });
    } catch (e) {
      return {
        ok: false,
        code: "INTERNAL_ERROR",
        reason:
          e instanceof Error
            ? `waitForTransactionReceipt failed: ${e.message}`
            : "waitForTransactionReceipt failed",
      };
    }
    if (receipt.status !== "success") {
      return {
        ok: false,
        code: "ONCHAIN_REVERT",
        reason: `transaction ${txHash} reverted on-chain`,
      };
    }

    // 5. Extract exchangeId from BuyerCommitted.
    const extracted = extractExchangeId(receipt);
    if (!extracted.ok) return extracted;

    return {
      ok: true,
      exchangeId: extracted.exchangeId,
      txHash,
    };
  } catch (e) {
    return toResult(e);
  }
}

/**
 * Map an error raised by `coreSdk.executeMetaTransaction(...)` to a
 * facilitator result. Errors thrown by the viem-backed adapter come out
 * as `RelayerSubmitError` carrying a stable code; anything else falls
 * back to `INTERNAL_ERROR` with the underlying message.
 */
export function mapSubmitError(e: unknown): Exclude<FacilitatorSettleResult, { ok: true }> {
  if (e instanceof RelayerSubmitError) {
    return {
      ok: false,
      code: e.code as FacilitatorErrorCode,
      reason: e.message,
    };
  }
  // core-sdk wraps adapter errors in its own Error. Walk the cause chain
  // for a tagged RelayerSubmitError before falling back.
  let cursor: unknown = e;
  while (cursor && typeof cursor === "object" && "cause" in cursor) {
    const cause = (cursor as { cause: unknown }).cause;
    if (cause instanceof RelayerSubmitError) {
      return {
        ok: false,
        code: cause.code as FacilitatorErrorCode,
        reason: cause.message,
      };
    }
    if (cause === cursor) break;
    cursor = cause;
  }
  return {
    ok: false,
    code: "INTERNAL_ERROR",
    reason: e instanceof Error ? e.message : String(e),
  };
}
