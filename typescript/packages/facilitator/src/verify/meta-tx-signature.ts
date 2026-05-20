// Meta-tx signature recovery.
//
// The signer (buyer or seller) signs a Boson EIP-712 typed-data with
// the Diamond as the verifying contract. core-sdk uses FOUR distinct
// primary types depending on the action family:
//
//   - `MetaTransaction` — commit-time (`createOfferAndCommit`,
//     `createOfferCommitAndRedeem`), `revokeVoucher`,
//     `extendDisputeTimeout`, `depositFunds`. Message carries the raw
//     `functionSignature: bytes`.
//   - `MetaTxExchange` — exchange-keyed post-commit actions
//     (`redeemVoucher`, `cancelVoucher`, `completeExchange`,
//     `raiseDispute`, `retractDispute`, `escalateDispute`). Message
//     carries `exchangeDetails: {exchangeId}`.
//   - `MetaTxDisputeResolution` — `resolveDispute`. Message carries
//     `disputeResolutionDetails: {exchangeId, buyerPercentBasisPoints,
//     signature}`.
//   - `MetaTxFund` — `withdrawFunds`. Message carries `fundDetails:
//     {entityId, tokenList, tokenAmounts}`.
//
// We MUST reconstruct the same typed-data the signer used or
// `ecrecover` yields a garbage address. Each variant routes through
// the corresponding `@bosonprotocol/x402-core/eip712` builder which
// delegates to core-sdk's `signMetaTx*({returnTypedDataToSign: true})`
// — that keeps the reconstructed shape in lock-step with what
// `MetaTransactionsHandlerFacet` verifies on-chain.

import {
  metaTransactionDisputeResolutionTypedData,
  metaTransactionExchangeTypedData,
  metaTransactionFundTypedData,
  metaTransactionTypedData,
  type ActionMetaTransactionTypedData,
} from "@bosonprotocol/x402-core/eip712";
import type { Address, BosonMetaTx, Hex } from "@bosonprotocol/x402-core/schemes/escrow";
import type { ActionId } from "@bosonprotocol/x402-core/state-machine";
import { decodeFunctionData, parseAbi, recoverTypedDataAddress } from "viem";

import type { StepResult } from "./structural.js";

export interface VerifyMetaTxSignatureArgs {
  chainId: number;
  /** Boson escrow (Diamond) address — the EIP-712 verifyingContract. */
  escrowAddress: Address;
  /** The meta-tx envelope from the payload. */
  metaTx: BosonMetaTx;
  /** Buyer wallet from the payload — the recovered signer must match this. */
  buyer: Address;
}

export type RecoverMetaTxSignerResult =
  | { ok: true; recovered: Address }
  | { ok: false; code: "BAD_META_TX_SIGNATURE"; reason: string };

/**
 * Recover the meta-tx signer from the `MetaTransaction` (basic) EIP-712
 * typed-data — used by the commit-time `verify()` path and by
 * post-commit actions that share that primary type (`revokeVoucher`,
 * `extendDisputeTimeout`, `depositFunds`). Other post-commit actions
 * must route through {@link recoverActionMetaTxSigner}, which dispatches
 * on the action id and rebuilds the matching primary type.
 *
 * Does **not** check who the signer should be — that's the caller's job.
 * The on-chain `MetaTransactionsHandlerFacet.executeMetaTransaction`
 * recovers signatures with `LibSignature.recover`, which accepts only
 * the legacy `v ∈ {27, 28}` form — reject `v ∈ {0, 1}` upfront with a
 * clear error rather than letting the simulation fail later.
 */
export async function recoverMetaTxSigner(args: {
  chainId: number;
  escrowAddress: Address;
  metaTx: BosonMetaTx;
}): Promise<RecoverMetaTxSignerResult> {
  const { v, r, s } = args.metaTx.sig;
  const vCheck = checkV(v);
  if (vCheck !== null) return vCheck;
  const typedData = await metaTransactionTypedData({
    chainId: args.chainId,
    verifyingContract: args.escrowAddress as `0x${string}`,
    message: {
      nonce: BigInt(args.metaTx.nonce),
      from: args.metaTx.from as `0x${string}`,
      contractAddress: args.escrowAddress as `0x${string}`,
      functionName: args.metaTx.functionName,
      functionSignature: args.metaTx.functionSignature as `0x${string}`,
    },
  });
  return recoverFromTypedData(typedData, packRsv(r as Hex, s as Hex, v));
}

/**
 * Action-aware variant of {@link recoverMetaTxSigner}. Dispatches on
 * `args.action` to reconstruct the EIP-712 typed-data the buyer / seller
 * actually signed:
 *
 *   - Exchange-keyed family (`boson-redeem`, `boson-cancelVoucher`,
 *     `boson-completeExchange`, `boson-raiseDispute`,
 *     `boson-retractDispute`, `boson-escalateDispute`) → `MetaTxExchange`
 *     primary type, message carries `exchangeDetails: {exchangeId}`.
 *   - `boson-resolveDispute` → `MetaTxDisputeResolution`, message carries
 *     `disputeResolutionDetails: {exchangeId, buyerPercentBasisPoints,
 *     signature}`.
 *   - `boson-withdrawFunds` → `MetaTxFund`, message carries
 *     `fundDetails: {entityId, tokenList, tokenAmounts}`.
 *   - Anything else (`boson-revokeVoucher`, commit-time actions) →
 *     falls through to {@link recoverMetaTxSigner}'s basic
 *     `MetaTransaction` recovery.
 *
 * The action-specific args (`exchangeId`, `buyerPercent`, …) are
 * decoded from `metaTx.functionSignature` so callers only need to pass
 * the action id and the raw meta-tx envelope.
 */
export async function recoverActionMetaTxSigner(args: {
  chainId: number;
  escrowAddress: Address;
  metaTx: BosonMetaTx;
  action: ActionId;
}): Promise<RecoverMetaTxSignerResult> {
  const { v, r, s } = args.metaTx.sig;
  const vCheck = checkV(v);
  if (vCheck !== null) return vCheck;

  const escrow = args.escrowAddress as `0x${string}`;
  const baseArgs = {
    chainId: args.chainId,
    verifyingContract: escrow,
    nonce: BigInt(args.metaTx.nonce),
    from: args.metaTx.from as `0x${string}`,
  };
  const signature = packRsv(r as Hex, s as Hex, v);

  try {
    let typedData: ActionMetaTransactionTypedData;
    switch (args.action) {
      case "boson-redeem":
      case "boson-cancelVoucher":
      case "boson-completeExchange":
      case "boson-raiseDispute":
      case "boson-retractDispute":
      case "boson-escalateDispute": {
        const exchangeId = decodeExchangeIdArg(args.metaTx.functionSignature);
        if (!exchangeId.ok) return exchangeId;
        typedData = await metaTransactionExchangeTypedData({
          ...baseArgs,
          functionName: args.metaTx.functionName,
          exchangeId: exchangeId.value,
        });
        break;
      }
      case "boson-resolveDispute": {
        const decoded = decodeResolveDisputeArgs(args.metaTx.functionSignature);
        if (!decoded.ok) return decoded;
        typedData = await metaTransactionDisputeResolutionTypedData({
          ...baseArgs,
          exchangeId: decoded.exchangeId,
          buyerPercentBasisPoints: decoded.buyerPercentBasisPoints,
          counterpartySig: decoded.counterpartySig as `0x${string}`,
        });
        break;
      }
      case "boson-withdrawFunds": {
        const decoded = decodeWithdrawFundsArgs(args.metaTx.functionSignature);
        if (!decoded.ok) return decoded;
        typedData = await metaTransactionFundTypedData({
          ...baseArgs,
          entityId: decoded.entityId,
          tokenList: decoded.tokenList as readonly `0x${string}`[],
          tokenAmounts: decoded.tokenAmounts,
        });
        break;
      }
      default:
        // `boson-revokeVoucher`, `boson-createOfferAndCommit`,
        // `boson-createOfferCommitAndRedeem`, and any future action that
        // uses the basic `MetaTransaction` primary type fall through to
        // the existing recovery path.
        return recoverMetaTxSigner({
          chainId: args.chainId,
          escrowAddress: args.escrowAddress,
          metaTx: args.metaTx,
        });
    }
    return recoverFromTypedData(typedData, signature);
  } catch (e) {
    return {
      ok: false,
      code: "BAD_META_TX_SIGNATURE",
      reason: e instanceof Error ? `recovery failed: ${e.message}` : "recovery failed",
    };
  }
}

function checkV(v: number): RecoverMetaTxSignerResult | null {
  if (v !== 27 && v !== 28) {
    return {
      ok: false,
      code: "BAD_META_TX_SIGNATURE",
      reason: `meta-tx signature v must be 27 or 28, got ${v}`,
    };
  }
  return null;
}

async function recoverFromTypedData(
  typedData: ActionMetaTransactionTypedData,
  signature: Hex,
): Promise<RecoverMetaTxSignerResult> {
  try {
    const recovered = await recoverTypedDataAddress({
      domain: typedData.domain,
      types: typedData.types,
      primaryType: typedData.primaryType,
      message: typedData.message,
      signature: signature as `0x${string}`,
    } as Parameters<typeof recoverTypedDataAddress>[0]);
    return { ok: true, recovered };
  } catch (e) {
    return {
      ok: false,
      code: "BAD_META_TX_SIGNATURE",
      reason: e instanceof Error ? `recovery failed: ${e.message}` : "recovery failed",
    };
  }
}

// ABI used to decode the action-specific arguments out of
// `metaTx.functionSignature`. Only the actions that need their args fed
// into a typed-data builder are listed; commit-time and revoke skip
// straight to the basic-MetaTransaction path.
const ACTION_ARGS_ABI = parseAbi([
  "function redeemVoucher(uint256 exchangeId)",
  "function cancelVoucher(uint256 exchangeId)",
  "function completeExchange(uint256 exchangeId)",
  "function raiseDispute(uint256 exchangeId)",
  "function retractDispute(uint256 exchangeId)",
  "function escalateDispute(uint256 exchangeId)",
  "function resolveDispute(uint256 exchangeId, uint256 buyerPercent, bytes counterpartySig)",
  "function withdrawFunds(uint256 entityId, address[] tokenList, uint256[] tokenAmounts)",
]);

type DecodeFailure = { ok: false; code: "BAD_META_TX_SIGNATURE"; reason: string };

function decodeExchangeIdArg(
  functionSignature: string,
): { ok: true; value: bigint } | DecodeFailure {
  try {
    const decoded = decodeFunctionData({
      abi: ACTION_ARGS_ABI,
      data: functionSignature as `0x${string}`,
    });
    const exchangeId = decoded.args?.[0];
    if (typeof exchangeId !== "bigint") {
      return {
        ok: false,
        code: "BAD_META_TX_SIGNATURE",
        reason: "metaTx.functionSignature does not encode exchangeId as the first uint256 argument",
      };
    }
    return { ok: true, value: exchangeId };
  } catch (e) {
    return {
      ok: false,
      code: "BAD_META_TX_SIGNATURE",
      reason:
        e instanceof Error
          ? `metaTx.functionSignature decode failed: ${e.message}`
          : "metaTx.functionSignature decode failed",
    };
  }
}

function decodeResolveDisputeArgs(functionSignature: string):
  | {
      ok: true;
      exchangeId: bigint;
      buyerPercentBasisPoints: bigint;
      counterpartySig: Hex;
    }
  | DecodeFailure {
  try {
    const decoded = decodeFunctionData({
      abi: ACTION_ARGS_ABI,
      data: functionSignature as `0x${string}`,
    });
    if (decoded.functionName !== "resolveDispute") {
      return {
        ok: false,
        code: "BAD_META_TX_SIGNATURE",
        reason: `expected resolveDispute calldata, got "${decoded.functionName}"`,
      };
    }
    const [exchangeId, buyerPercent, counterpartySig] = decoded.args as readonly [
      bigint,
      bigint,
      `0x${string}`,
    ];
    return {
      ok: true,
      exchangeId,
      buyerPercentBasisPoints: buyerPercent,
      counterpartySig: counterpartySig as Hex,
    };
  } catch (e) {
    return {
      ok: false,
      code: "BAD_META_TX_SIGNATURE",
      reason:
        e instanceof Error
          ? `metaTx.functionSignature decode failed: ${e.message}`
          : "metaTx.functionSignature decode failed",
    };
  }
}

function decodeWithdrawFundsArgs(functionSignature: string):
  | {
      ok: true;
      entityId: bigint;
      tokenList: readonly Address[];
      tokenAmounts: readonly bigint[];
    }
  | DecodeFailure {
  try {
    const decoded = decodeFunctionData({
      abi: ACTION_ARGS_ABI,
      data: functionSignature as `0x${string}`,
    });
    if (decoded.functionName !== "withdrawFunds") {
      return {
        ok: false,
        code: "BAD_META_TX_SIGNATURE",
        reason: `expected withdrawFunds calldata, got "${decoded.functionName}"`,
      };
    }
    const [entityId, tokenList, tokenAmounts] = decoded.args as readonly [
      bigint,
      readonly `0x${string}`[],
      readonly bigint[],
    ];
    return {
      ok: true,
      entityId,
      tokenList: tokenList as readonly Address[],
      tokenAmounts,
    };
  } catch (e) {
    return {
      ok: false,
      code: "BAD_META_TX_SIGNATURE",
      reason:
        e instanceof Error
          ? `metaTx.functionSignature decode failed: ${e.message}`
          : "metaTx.functionSignature decode failed",
    };
  }
}

/**
 * Recover the meta-tx signer and confirm it matches `buyer`. Used by the
 * `verify()` / `settle()` commit path where `metaTx.from === payload.buyer`
 * is enforced.
 */
export async function verifyMetaTxSignature(args: VerifyMetaTxSignatureArgs): Promise<StepResult> {
  const recovery = await recoverMetaTxSigner({
    chainId: args.chainId,
    escrowAddress: args.escrowAddress,
    metaTx: args.metaTx,
  });
  if (!recovery.ok) return recovery;
  if (recovery.recovered.toLowerCase() !== args.buyer.toLowerCase()) {
    return {
      ok: false,
      code: "BAD_META_TX_SIGNATURE",
      reason: `recovered signer ${recovery.recovered} != payload.buyer ${args.buyer}`,
    };
  }
  // The protocol uses `metaTx.from` as the from-address recovered from the
  // signature too; verify that this matches the buyer (the spec treats
  // metaTx.from and payload.buyer as the same EOA).
  if (args.metaTx.from.toLowerCase() !== args.buyer.toLowerCase()) {
    return {
      ok: false,
      code: "BAD_META_TX_SIGNATURE",
      reason: `metaTx.from ${args.metaTx.from} != payload.buyer ${args.buyer}`,
    };
  }
  return { ok: true };
}

/** Pack split ECDSA signature into the 65-byte `r ++ s ++ v` form viem expects. */
export function packRsv(r: Hex, s: Hex, v: number): Hex {
  const vHex = v.toString(16).padStart(2, "0");
  return `0x${r.slice(2)}${s.slice(2)}${vHex}` as Hex;
}
