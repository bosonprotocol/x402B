// Validate that a perform-action request's declared action/exchangeId match
// the Boson method embedded in the signed meta-transaction.

import type { BosonMetaTx } from "@bosonprotocol/x402-core/schemes/escrow";
import type { ActionId } from "@bosonprotocol/x402-core/state-machine";
import { decodeFunctionData, parseAbi } from "viem";

import type { FacilitatorErrorCode } from "../types.js";

export const POST_COMMIT_ACTION_IDS = [
  "boson-redeem",
  "boson-cancelVoucher",
  "boson-revokeVoucher",
  "boson-completeExchange",
  "boson-raiseDispute",
  "boson-resolveDispute",
  "boson-escalateDispute",
  "boson-retractDispute",
] as const satisfies readonly ActionId[];

export type PostCommitActionId = (typeof POST_COMMIT_ACTION_IDS)[number];

const POST_COMMIT_ACTION_SET = new Set<string>(POST_COMMIT_ACTION_IDS);

const ACTION_FUNCTIONS: Record<PostCommitActionId, { name: string; signature: string }> = {
  "boson-redeem": { name: "redeemVoucher", signature: "redeemVoucher(uint256)" },
  "boson-cancelVoucher": { name: "cancelVoucher", signature: "cancelVoucher(uint256)" },
  "boson-revokeVoucher": { name: "revokeVoucher", signature: "revokeVoucher(uint256)" },
  "boson-completeExchange": { name: "completeExchange", signature: "completeExchange(uint256)" },
  "boson-raiseDispute": { name: "raiseDispute", signature: "raiseDispute(uint256)" },
  "boson-resolveDispute": {
    name: "resolveDispute",
    signature: "resolveDispute(uint256,uint256,bytes)",
  },
  "boson-escalateDispute": { name: "escalateDispute", signature: "escalateDispute(uint256)" },
  "boson-retractDispute": { name: "retractDispute", signature: "retractDispute(uint256)" },
};

const POST_COMMIT_ABI = parseAbi([
  "function redeemVoucher(uint256 exchangeId)",
  "function cancelVoucher(uint256 exchangeId)",
  "function revokeVoucher(uint256 exchangeId)",
  "function completeExchange(uint256 exchangeId)",
  "function raiseDispute(uint256 exchangeId)",
  "function resolveDispute(uint256 exchangeId, uint256 buyerPercent, bytes counterpartySig)",
  "function escalateDispute(uint256 exchangeId)",
  "function retractDispute(uint256 exchangeId)",
]);

const UINT256_MAX = (1n << 256n) - 1n;
const DECIMAL_UINT_RE = /^\d+$/;

export type ValidatePerformActionMetaTxResult =
  | { ok: true }
  | { ok: false; code: FacilitatorErrorCode; reason: string };

export function isPostCommitAction(action: string): action is PostCommitActionId {
  return POST_COMMIT_ACTION_SET.has(action);
}

export function validatePerformActionMetaTx(input: {
  action: ActionId;
  exchangeId: string;
  metaTx: BosonMetaTx;
}): ValidatePerformActionMetaTxResult {
  if (!isPostCommitAction(input.action)) {
    return {
      ok: false,
      code: "UNSUPPORTED_ACTION",
      reason: `performAction() only supports post-commit actions, got "${input.action}"`,
    };
  }

  const expected = ACTION_FUNCTIONS[input.action];
  if (input.metaTx.functionName !== expected.signature) {
    return {
      ok: false,
      code: "INVALID_PAYLOAD",
      reason: `signedPayload metaTx.functionName "${input.metaTx.functionName}" does not match action "${input.action}"`,
    };
  }

  let expectedExchangeId: bigint;
  if (!DECIMAL_UINT_RE.test(input.exchangeId)) {
    return {
      ok: false,
      code: "INVALID_PAYLOAD",
      reason: `exchangeId must be a uint256 decimal string, got "${input.exchangeId}"`,
    };
  }
  try {
    expectedExchangeId = BigInt(input.exchangeId);
  } catch {
    return {
      ok: false,
      code: "INVALID_PAYLOAD",
      reason: `exchangeId must be a uint256 decimal string, got "${input.exchangeId}"`,
    };
  }
  if (expectedExchangeId > UINT256_MAX) {
    return {
      ok: false,
      code: "INVALID_PAYLOAD",
      reason: `exchangeId must be a uint256 decimal string, got "${input.exchangeId}"`,
    };
  }

  let decoded: { functionName: string; args?: readonly unknown[] };
  try {
    decoded = decodeFunctionData({
      abi: POST_COMMIT_ABI,
      data: input.metaTx.functionSignature as `0x${string}`,
    });
  } catch (e) {
    return {
      ok: false,
      code: "INVALID_PAYLOAD",
      reason:
        e instanceof Error
          ? `signedPayload functionSignature decode failed: ${e.message}`
          : "signedPayload functionSignature decode failed",
    };
  }

  if (decoded.functionName !== expected.name) {
    return {
      ok: false,
      code: "INVALID_PAYLOAD",
      reason: `signedPayload functionSignature encodes "${decoded.functionName}", expected "${expected.name}" for action "${input.action}"`,
    };
  }

  const actualExchangeId = decoded.args?.[0];
  if (typeof actualExchangeId !== "bigint") {
    return {
      ok: false,
      code: "INVALID_PAYLOAD",
      reason: "signedPayload functionSignature does not encode exchangeId as the first uint256 argument",
    };
  }
  if (actualExchangeId !== expectedExchangeId) {
    return {
      ok: false,
      code: "INVALID_PAYLOAD",
      reason: `signedPayload exchangeId ${actualExchangeId.toString()} does not match request exchangeId ${expectedExchangeId.toString()}`,
    };
  }

  return { ok: true };
}
