// Convenience handlers for the post-commit actions — `redeem`,
// `complete`, and the four dispute transitions. Each is a thin
// wrapper over the facilitator's `/perform-action` endpoint:
// forward the buyer- or seller-signed payload, verify the resulting
// exchange snapshot reaches the action's `ACTION_POST_STATE`, emit
// fresh `nextActions`.

import { ExchangeState } from "@bosonprotocol/x402-actions";
import { ACTION_POST_STATE, type ActionId } from "@bosonprotocol/x402-core/state-machine";
import type { Hex } from "viem";

import { emitNextActions } from "./next-actions.js";
import { handlerErr, handlerOk, type HandlerResult } from "./types.js";
import type { FacilitatorClient } from "../facilitator/client.js";
import { FacilitatorHttpError } from "../facilitator/errors.js";
import type { X402bServerConfig } from "../config.js";
import {
  verifyExchange,
  type ExchangeReader,
  type VerifyExchangeExpected,
} from "../onchain/verify-exchange.js";

/** Per-action inputs accepted by every post-commit convenience handler. */
export interface PerformActionInput {
  exchangeId: string;
  /** ABI-encoded `BosonMetaTx` tuple — see `encodeSignedPayload` in `@bosonprotocol/x402-facilitator`. */
  signedPayload: Hex;
}

export interface PerformActionContext {
  config: X402bServerConfig;
  facilitator: FacilitatorClient;
  exchangeReader: ExchangeReader;
}

export interface PerformActionOk {
  txHash: string;
}

/** Generic post-commit handler — wired from each of the per-action wrappers below. */
export async function handlePerformAction(
  action: ActionId,
  input: PerformActionInput,
  ctx: PerformActionContext,
): Promise<HandlerResult<PerformActionOk>> {
  const reference = await ctx.exchangeReader.read(input.exchangeId);
  if (reference === null) {
    return handlerErr(
      502,
      "STATE_VERIFY_EXCHANGE_NOT_FOUND",
      "pre-action exchange reference could not be read",
      { action, exchangeId: input.exchangeId },
    );
  }

  let result: Awaited<ReturnType<FacilitatorClient["performAction"]>>;
  try {
    result = await ctx.facilitator.performAction({
      network: ctx.config.network,
      escrowAddress: ctx.config.escrow,
      exchangeId: input.exchangeId,
      action,
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

  const postState = ACTION_POST_STATE[action];
  const expected: VerifyExchangeExpected = {
    state: postState.exchange,
    ...(postState.dispute !== undefined ? { disputeState: postState.dispute } : {}),
    seller: reference.seller,
    exchangeToken: reference.exchangeToken,
    price: reference.price,
  };
  const verifyResult = await verifyExchange(ctx.exchangeReader, input.exchangeId, expected);
  if (!verifyResult.ok) {
    return handlerErr(
      502,
      `STATE_VERIFY_${verifyResult.code}`,
      "post-action state verification failed",
      {
        action,
        exchangeId: input.exchangeId,
        txHash: result.txHash,
        field: verifyResult.field,
        expected: verifyResult.expected,
        got: verifyResult.got,
      },
    );
  }

  const nextActions =
    postState.exchange === ExchangeState.DISPUTED && postState.dispute !== undefined
      ? emitNextActions(
          {
            exchangeId: input.exchangeId,
            exchangeState: ExchangeState.DISPUTED,
            disputeState: postState.dispute,
          },
          ctx.config.channelRegistry,
          ctx.config.facilitator.url,
        )
      : emitNextActions(
          {
            exchangeId: input.exchangeId,
            exchangeState: postState.exchange as Exclude<
              ExchangeState,
              typeof ExchangeState.DISPUTED
            >,
          },
          ctx.config.channelRegistry,
          ctx.config.facilitator.url,
        );

  return handlerOk({ txHash: result.txHash, nextActions });
}

/** Per-action sugar — preserves the action id at the type level. */
export const handleRedeem = (input: PerformActionInput, ctx: PerformActionContext) =>
  handlePerformAction("boson-redeem", input, ctx);
export const handleComplete = (input: PerformActionInput, ctx: PerformActionContext) =>
  handlePerformAction("boson-completeExchange", input, ctx);
export const handleDisputeRaise = (input: PerformActionInput, ctx: PerformActionContext) =>
  handlePerformAction("boson-raiseDispute", input, ctx);
export const handleDisputeResolve = (input: PerformActionInput, ctx: PerformActionContext) =>
  handlePerformAction("boson-resolveDispute", input, ctx);
export const handleDisputeRetract = (input: PerformActionInput, ctx: PerformActionContext) =>
  handlePerformAction("boson-retractDispute", input, ctx);
export const handleDisputeEscalate = (input: PerformActionInput, ctx: PerformActionContext) =>
  handlePerformAction("boson-escalateDispute", input, ctx);
