// Convenience handler for the entity-keyed `boson-withdrawFunds`
// action. The buyer or seller signs an EIP-712 meta-tx for
// `withdrawFunds(uint256 entityId, address[] tokenList, uint256[] tokenAmounts)`;
// the server forwards the signed payload to the facilitator and
// returns the resulting tx hash.
//
// Unlike the exchange-keyed `handlePerformAction`, this handler:
//   - takes an `entityId` (or an `address` + optional `role`) instead
//     of an `exchangeId`,
//   - skips the post-action `exchangeReader.read` + `verifyExchange`
//     step (the action doesn't transition the exchange state machine),
//   - returns just `{ txHash, entityId, role? }` — no `nextActions`
//     envelope (withdraw is deliberately absent from `next[]`).

import type { Address } from "@bosonprotocol/x402-core/schemes/escrow";
import type { Hex } from "viem";

import type { X402bServerConfig } from "../config.js";
import type { FacilitatorClient } from "../facilitator/client.js";
import { FacilitatorHttpError } from "../facilitator/errors.js";
import type { CoreSdkReadAdapter } from "../onchain/core-sdk-read.js";
import { resolveEntityId } from "./resolve-entity.js";
import { handlerErr, plainHandlerOk, type PlainHandlerResult } from "./types.js";

const DECIMAL_UINT_RE = /^\d+$/;
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export interface WithdrawFundsBaseInput {
  /** ABI-encoded `BosonMetaTx` tuple — see `encodeSignedPayload` in `@bosonprotocol/x402-evm/codec`. */
  signedPayload: Hex;
}

export type WithdrawFundsInput = WithdrawFundsBaseInput &
  ({ entityId: string } | { address: string; role?: "buyer" | "seller" });

export interface WithdrawFundsContext {
  config: X402bServerConfig;
  facilitator: FacilitatorClient;
  coreSdkRead: CoreSdkReadAdapter;
}

export interface WithdrawFundsOk {
  txHash: string;
  entityId: string;
  role?: "buyer" | "seller";
}

export async function handleWithdrawFunds(
  input: WithdrawFundsInput,
  ctx: WithdrawFundsContext,
): Promise<PlainHandlerResult<WithdrawFundsOk>> {
  let entityId: string;
  let role: "buyer" | "seller" | undefined;

  if ("entityId" in input) {
    if (!DECIMAL_UINT_RE.test(input.entityId)) {
      return handlerErr(
        400,
        "INVALID_ENTITY_ID",
        `entityId must be a decimal uint256 string, got "${input.entityId}"`,
      );
    }
    entityId = input.entityId;
  } else {
    if (!ADDRESS_RE.test(input.address)) {
      return handlerErr(
        400,
        "INVALID_ADDRESS",
        `address must be a 20-byte 0x-prefixed hex string, got "${input.address}"`,
      );
    }
    const resolved = await resolveEntityId(ctx.coreSdkRead, {
      address: input.address,
      ...(input.role !== undefined ? { role: input.role } : {}),
    });
    if (!resolved.ok) {
      const status =
        resolved.code === "NOT_FOUND" ? 404 : resolved.code === "AMBIGUOUS" ? 409 : 502;
      const details =
        resolved.code === "AMBIGUOUS"
          ? { sellerId: resolved.sellerId, buyerId: resolved.buyerId }
          : undefined;
      return handlerErr(status, resolved.code, resolved.reason, details);
    }
    entityId = resolved.entityId;
    role = resolved.role;
  }

  let result: Awaited<ReturnType<FacilitatorClient["performAction"]>>;
  try {
    result = await ctx.facilitator.performAction({
      network: ctx.config.network,
      escrowAddress: ctx.config.escrow as Address,
      entityId,
      action: "boson-withdrawFunds",
      signedPayload: input.signedPayload,
    });
  } catch (e) {
    if (e instanceof FacilitatorHttpError) {
      return handlerErr(502, "FACILITATOR_UNREACHABLE", e.message, {
        code: e.code,
        status: e.status,
        facilitatorCode: e.facilitatorCode,
      });
    }
    throw e;
  }

  if (!result.ok) {
    return handlerErr(502, "FACILITATOR_REJECTED", result.reason, {
      facilitatorCode: result.code,
    });
  }

  return plainHandlerOk<WithdrawFundsOk>({
    txHash: result.txHash,
    entityId,
    ...(role !== undefined ? { role } : {}),
  });
}
