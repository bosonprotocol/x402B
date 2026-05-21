// `settle` — submit the buyer's signed meta-tx to the Boson Diamond.
//
// Pipeline:
//   1. Run `verify()` first — bail on any failure.
//   2. Submit via one of two envelopes:
//      - `none` strategy → `coreSdk.executeMetaTransaction(...)`. The
//        SDK builds the outer calldata and submits through the
//        relayer-side viem-backed Web3LibAdapter, which classifies
//        errors as a tagged `RelayerSubmitError`.
//      - non-`none` strategies → `buildSettleCalldata` builds the
//        BPIP-12 envelope with the action-aware queue layout (see
//        `internal/build-bpip12-calldata.ts`) and we submit through
//        `walletClient.sendTransaction` directly. The SDK's
//        `encodeTransferAuthorizationQueue` can't express the
//        empty-bytes fallback slots the protocol requires, so the
//        BPIP-12 path bypasses it.
//   3. Await the viem receipt; an on-chain revert surfaces as
//      ONCHAIN_REVERT.
//   4. Parse `BuyerCommitted` from the receipt to extract `exchangeId`.
//
// All steps return discriminated-union results — no thrown errors leak
// to the caller unless the underlying transport itself fails (those map
// to INTERNAL_ERROR via toResult()).

import { RelayerSubmitError } from "@bosonprotocol/x402-evm/adapters";
import { BaseError, ContractFunctionRevertedError, RawContractError, type Hex } from "viem";

import { toResult } from "../errors.js";
import { buildSettleCalldata } from "../internal/build-settle-calldata.js";
import { createFacilitatorCoreSdk } from "../internal/core-sdk-factory.js";
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

    // 2. Defensive structural check. The verify step already enforces
    //    this rule, but keeping the guard self-contained means a future
    //    direct caller of `settle()` (e.g. an internal admin tool) gets
    //    the same shape error rather than a confusing crash.
    if (inner.tokenAuthStrategy !== "none" && !inner.tokenAuth) {
      return {
        ok: false,
        code: "INVALID_PAYLOAD",
        reason: `tokenAuthStrategy "${inner.tokenAuthStrategy}" requires payload.tokenAuth but none was provided`,
      };
    }

    const chain = parseChainId(input.network);
    if (!chain.ok) return chain;

    const buyer = inner.buyer as `0x${string}`;
    let txHash: `0x${string}`;
    if (inner.tokenAuthStrategy === "none") {
      // 3a. `none` strategy → SDK's `executeMetaTransaction(...)`. The
      //     mixin builds the outer-envelope calldata and submits through
      //     the configured Web3LibAdapter, which classifies errors as
      //     `RelayerSubmitError` for `mapSubmitError`.
      const coreSdk = createFacilitatorCoreSdk({
        walletClient: config.walletClient,
        publicClient: config.publicClient,
        chainId: chain.chainId,
        escrowAddress,
      });
      try {
        const response = await coreSdk.executeMetaTransaction(
          {
            functionName: inner.metaTx.functionName,
            functionSignature: inner.metaTx.functionSignature,
            nonce: inner.metaTx.nonce,
            sigR: inner.metaTx.sig.r,
            sigS: inner.metaTx.sig.s,
            sigV: inner.metaTx.sig.v,
          },
          { userAddress: buyer, contractAddress: escrowAddress },
        );
        txHash = response.hash as `0x${string}`;
      } catch (e) {
        return mapSubmitError(e);
      }
    } else {
      // 3b. Non-`none` strategy → BPIP-12 envelope. We bypass core-sdk's
      //     `executeMetaTransaction` mixin because its
      //     `encodeTransferAuthorizationQueue` can't express the
      //     empty-bytes fallback slots the protocol expects ahead of
      //     the buyer's auth (one per pre-buyer `transferFundsIn` site,
      //     e.g. the zero-amount seller-deposit pull on
      //     `createOfferAndCommit`). `buildSettleCalldata` builds the
      //     queue + outer calldata via viem directly with the right
      //     layout, and we submit through the same `walletClient`.
      let calldata: { to: `0x${string}`; data: Hex };
      try {
        calldata = await buildSettleCalldata({
          escrowAddress,
          userAddress: buyer,
          metaTx: inner.metaTx,
          actionId: inner.action,
          tokenAuthStrategy: inner.tokenAuthStrategy,
          tokenAuth: inner.tokenAuth!,
        });
      } catch (e) {
        return {
          ok: false,
          code: "INTERNAL_ERROR",
          reason: e instanceof Error ? e.message : String(e),
        };
      }
      try {
        const relayer = config.walletClient.account;
        if (relayer === undefined) {
          return {
            ok: false,
            code: "INTERNAL_ERROR",
            reason: "facilitator walletClient has no account bound",
          };
        }
        txHash = await config.walletClient.sendTransaction({
          account: relayer,
          chain: config.walletClient.chain ?? null,
          to: calldata.to,
          data: calldata.data,
        });
      } catch (e) {
        return mapSubmitError(e);
      }
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
 * Map a submission error to a facilitator result. Two paths:
 *
 *   - core-sdk path (the `none` strategy): the viem-backed adapter
 *     throws `RelayerSubmitError` with a stable code; core-sdk wraps
 *     that in its own error, so we walk the cause chain.
 *   - direct-submit path (the BPIP-12 strategies): we call
 *     `walletClient.sendTransaction` ourselves, so a contract revert
 *     surfaces as a viem `ContractFunctionRevertedError` /
 *     `RawContractError` and pre-flight failures (insufficient gas,
 *     transport hiccups) come back as a plain `BaseError`.
 *
 * Anything we can't classify falls back to `INTERNAL_ERROR` carrying
 * the underlying message.
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
  // for a tagged RelayerSubmitError before falling back. Also capture the
  // first viem BaseError encountered (which may be `e` itself or a wrapped
  // cause) so the ONCHAIN_REVERT classifier below sees wrapped reverts.
  let cursor: unknown = e;
  let viemBase: BaseError | undefined = e instanceof BaseError ? e : undefined;
  while (cursor && typeof cursor === "object" && "cause" in cursor) {
    const cause = (cursor as { cause: unknown }).cause;
    if (cause instanceof RelayerSubmitError) {
      return {
        ok: false,
        code: cause.code as FacilitatorErrorCode,
        reason: cause.message,
      };
    }
    if (!viemBase && cause instanceof BaseError) {
      viemBase = cause;
    }
    if (cause === cursor) break;
    cursor = cause;
  }
  if (viemBase) {
    const reverted = viemBase.walk(
      (err) => err instanceof RawContractError || err instanceof ContractFunctionRevertedError,
    );
    if (reverted) {
      const reason =
        reverted instanceof ContractFunctionRevertedError
          ? (reverted.reason ?? reverted.shortMessage ?? reverted.message)
          : reverted instanceof RawContractError
            ? reverted.message || reverted.shortMessage || "execution reverted"
            : (viemBase.shortMessage ?? viemBase.message);
      return {
        ok: false,
        code: "ONCHAIN_REVERT",
        reason,
      };
    }
    return {
      ok: false,
      code: "INTERNAL_ERROR",
      reason: viemBase.shortMessage ?? viemBase.message,
    };
  }
  return {
    ok: false,
    code: "INTERNAL_ERROR",
    reason: e instanceof Error ? e.message : String(e),
  };
}
