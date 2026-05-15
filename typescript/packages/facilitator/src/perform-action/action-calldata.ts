// Validate that a perform-action request's declared action and key
// (exchangeId or entityId) match the Boson method embedded in the
// signed meta-transaction.

import type { BosonMetaTx } from "@bosonprotocol/x402-core/schemes/escrow";
import type {
  ActionId,
  EntityActionId,
  ExchangeActionId,
} from "@bosonprotocol/x402-core/state-machine";
import { isEntityKeyedAction } from "@bosonprotocol/x402-core/state-machine";
import { decodeFunctionData, parseAbi } from "viem";

import type { FacilitatorErrorCode } from "../types.js";

/** Exchange-keyed post-commit actions: a single `exchangeId` argument decides scope. */
export const POST_COMMIT_EXCHANGE_ACTION_IDS = [
  "boson-redeem",
  "boson-cancelVoucher",
  "boson-revokeVoucher",
  "boson-completeExchange",
  "boson-raiseDispute",
  "boson-resolveDispute",
  "boson-escalateDispute",
  "boson-retractDispute",
] as const satisfies readonly ExchangeActionId[];

/** Entity-keyed post-commit actions: scope is the Boson account `entityId`. */
export const POST_COMMIT_ENTITY_ACTION_IDS = [
  "boson-withdrawFunds",
] as const satisfies readonly EntityActionId[];

/** Union of all post-commit actions the facilitator currently dispatches. */
export const POST_COMMIT_ACTION_IDS = [
  ...POST_COMMIT_EXCHANGE_ACTION_IDS,
  ...POST_COMMIT_ENTITY_ACTION_IDS,
] as const;

export type PostCommitExchangeActionId = (typeof POST_COMMIT_EXCHANGE_ACTION_IDS)[number];
export type PostCommitEntityActionId = (typeof POST_COMMIT_ENTITY_ACTION_IDS)[number];
export type PostCommitActionId = PostCommitExchangeActionId | PostCommitEntityActionId;

const POST_COMMIT_EXCHANGE_ACTION_SET = new Set<string>(POST_COMMIT_EXCHANGE_ACTION_IDS);
const POST_COMMIT_ENTITY_ACTION_SET = new Set<string>(POST_COMMIT_ENTITY_ACTION_IDS);

const EXCHANGE_ACTION_FUNCTIONS: Record<
  PostCommitExchangeActionId,
  { name: string; signature: string }
> = {
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

const ENTITY_ACTION_FUNCTIONS: Record<
  PostCommitEntityActionId,
  { name: string; signature: string }
> = {
  "boson-withdrawFunds": {
    name: "withdrawFunds",
    signature: "withdrawFunds(uint256,address[],uint256[])",
  },
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
  "function withdrawFunds(uint256 entityId, address[] tokenList, uint256[] tokenAmounts)",
]);

const UINT256_MAX = (1n << 256n) - 1n;
const DECIMAL_UINT_RE = /^\d+$/;

export type ValidatePerformActionMetaTxResult =
  | { ok: true }
  | { ok: false; code: FacilitatorErrorCode; reason: string };

export function isPostCommitAction(action: string): action is PostCommitActionId {
  return POST_COMMIT_EXCHANGE_ACTION_SET.has(action) || POST_COMMIT_ENTITY_ACTION_SET.has(action);
}

export function isPostCommitExchangeAction(action: string): action is PostCommitExchangeActionId {
  return POST_COMMIT_EXCHANGE_ACTION_SET.has(action);
}

export function isPostCommitEntityAction(action: string): action is PostCommitEntityActionId {
  return POST_COMMIT_ENTITY_ACTION_SET.has(action);
}

/** Parse a decimal uint256 string. Used for both exchangeId and entityId. */
function parseUint256(
  label: string,
  value: string,
): { ok: true; value: bigint } | ValidatePerformActionMetaTxResult {
  if (!DECIMAL_UINT_RE.test(value)) {
    return {
      ok: false,
      code: "INVALID_PAYLOAD",
      reason: `${label} must be a uint256 decimal string, got "${value}"`,
    };
  }
  let parsed: bigint;
  try {
    parsed = BigInt(value);
  } catch {
    return {
      ok: false,
      code: "INVALID_PAYLOAD",
      reason: `${label} must be a uint256 decimal string, got "${value}"`,
    };
  }
  if (parsed > UINT256_MAX) {
    return {
      ok: false,
      code: "INVALID_PAYLOAD",
      reason: `${label} must be a uint256 decimal string, got "${value}"`,
    };
  }
  return { ok: true, value: parsed };
}

/**
 * Validate an exchange-keyed post-commit meta-tx: function signature
 * matches the action and the encoded `exchangeId` matches the request.
 */
export function validatePerformExchangeActionMetaTx(input: {
  action: ActionId;
  exchangeId: string;
  metaTx: BosonMetaTx;
}): ValidatePerformActionMetaTxResult {
  if (!isPostCommitExchangeAction(input.action)) {
    return {
      ok: false,
      code: "UNSUPPORTED_ACTION",
      reason: `expected an exchange-keyed post-commit action, got "${input.action}"`,
    };
  }

  const expected = EXCHANGE_ACTION_FUNCTIONS[input.action];
  if (input.metaTx.functionName !== expected.signature) {
    return {
      ok: false,
      code: "INVALID_PAYLOAD",
      reason: `signedPayload metaTx.functionName "${input.metaTx.functionName}" does not match action "${input.action}"`,
    };
  }

  const parsedExchangeId = parseUint256("exchangeId", input.exchangeId);
  if (!("value" in parsedExchangeId)) return parsedExchangeId;

  const decoded = decodeCalldata(input.metaTx.functionSignature);
  if (!decoded.ok) return decoded;

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
      reason:
        "signedPayload functionSignature does not encode exchangeId as the first uint256 argument",
    };
  }
  if (actualExchangeId !== parsedExchangeId.value) {
    return {
      ok: false,
      code: "INVALID_PAYLOAD",
      reason: `signedPayload exchangeId ${actualExchangeId.toString()} does not match request exchangeId ${parsedExchangeId.value.toString()}`,
    };
  }

  return { ok: true };
}

/**
 * Validate an entity-keyed post-commit meta-tx: function signature
 * matches the action and the encoded `entityId` (first arg) matches the
 * request.
 */
export function validatePerformEntityActionMetaTx(input: {
  action: ActionId;
  entityId: string;
  metaTx: BosonMetaTx;
}): ValidatePerformActionMetaTxResult {
  if (!isPostCommitEntityAction(input.action)) {
    return {
      ok: false,
      code: "UNSUPPORTED_ACTION",
      reason: `expected an entity-keyed post-commit action, got "${input.action}"`,
    };
  }

  const expected = ENTITY_ACTION_FUNCTIONS[input.action];
  if (input.metaTx.functionName !== expected.signature) {
    return {
      ok: false,
      code: "INVALID_PAYLOAD",
      reason: `signedPayload metaTx.functionName "${input.metaTx.functionName}" does not match action "${input.action}"`,
    };
  }

  const parsedEntityId = parseUint256("entityId", input.entityId);
  if (!("value" in parsedEntityId)) return parsedEntityId;

  const decoded = decodeCalldata(input.metaTx.functionSignature);
  if (!decoded.ok) return decoded;

  if (decoded.functionName !== expected.name) {
    return {
      ok: false,
      code: "INVALID_PAYLOAD",
      reason: `signedPayload functionSignature encodes "${decoded.functionName}", expected "${expected.name}" for action "${input.action}"`,
    };
  }

  const actualEntityId = decoded.args?.[0];
  if (typeof actualEntityId !== "bigint") {
    return {
      ok: false,
      code: "INVALID_PAYLOAD",
      reason:
        "signedPayload functionSignature does not encode entityId as the first uint256 argument",
    };
  }
  if (actualEntityId !== parsedEntityId.value) {
    return {
      ok: false,
      code: "INVALID_PAYLOAD",
      reason: `signedPayload entityId ${actualEntityId.toString()} does not match request entityId ${parsedEntityId.value.toString()}`,
    };
  }

  return { ok: true };
}

/**
 * Back-compat shim. Dispatches to the exchange- or entity-keyed validator
 * based on the action. New code should call the variant directly.
 */
export function validatePerformActionMetaTx(input: {
  action: ActionId;
  exchangeId?: string;
  entityId?: string;
  metaTx: BosonMetaTx;
}): ValidatePerformActionMetaTxResult {
  if (isEntityKeyedAction(input.action)) {
    if (input.entityId === undefined) {
      return {
        ok: false,
        code: "INVALID_PAYLOAD",
        reason: `action "${input.action}" is entity-keyed; request must carry entityId`,
      };
    }
    return validatePerformEntityActionMetaTx({
      action: input.action,
      entityId: input.entityId,
      metaTx: input.metaTx,
    });
  }
  if (input.exchangeId === undefined) {
    return {
      ok: false,
      code: "INVALID_PAYLOAD",
      reason: `action "${input.action}" is exchange-keyed; request must carry exchangeId`,
    };
  }
  return validatePerformExchangeActionMetaTx({
    action: input.action,
    exchangeId: input.exchangeId,
    metaTx: input.metaTx,
  });
}

type DecodeResult =
  | { ok: true; functionName: string; args?: readonly unknown[] }
  | { ok: false; code: FacilitatorErrorCode; reason: string };

function decodeCalldata(functionSignature: string): DecodeResult {
  try {
    const decoded = decodeFunctionData({
      abi: POST_COMMIT_ABI,
      data: functionSignature as `0x${string}`,
    });
    return { ok: true, functionName: decoded.functionName, args: decoded.args };
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
}
