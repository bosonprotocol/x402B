// Convenience handlers for the post-commit actions — `redeem`,
// `complete`, and the four dispute transitions. Each is a thin
// wrapper over the facilitator's `/perform-action` endpoint:
// forward the buyer- or seller-signed payload, verify the resulting
// exchange snapshot reaches the action's `ACTION_POST_STATE`, emit
// fresh `nextActions`.

import { ExchangeState } from "@bosonprotocol/x402-actions";
import type { Address } from "@bosonprotocol/x402-core/schemes/escrow";
import { ACTION_POST_STATE, type ExchangeActionId } from "@bosonprotocol/x402-core/state-machine";
import { decodeSignedPayload } from "@bosonprotocol/x402-evm";
import type { Hex } from "viem";

import { emitNextActions } from "./next-actions.js";
import { handlerErr, handlerOk, type HandlerResult, type HandlerWarning } from "./types.js";
import type { FacilitatorClient } from "../facilitator/client.js";
import { FacilitatorHttpError } from "../facilitator/errors.js";
import type {
  FulfillmentRecoveryEntry,
  RedeemFulfillmentChannel,
  X402bServerConfig,
} from "../config.js";
import type { Store } from "../store.js";
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

/**
 * Redeem-time variant of `PerformActionInput`. Carries the buyer's
 * `fulfillment` selection for Flow A — `data` is the delivery target
 * the redeem-time channel adapter persists. Required when the
 * original 402 advertised `fulfillment.required = true`; omitted
 * otherwise.
 */
export interface RedeemHandlerInput extends PerformActionInput {
  fulfillment?: { option: string; data: Record<string, unknown> | null };
}

export interface PerformActionContext {
  config: X402bServerConfig;
  facilitator: FacilitatorClient;
  exchangeReader: ExchangeReader;
}

export interface RedeemHandlerContext extends PerformActionContext {
  exchangeFulfillmentOptionStore: Store<readonly string[]>;
  fulfillmentRecoveryStore: Store<FulfillmentRecoveryEntry>;
}

export interface PerformActionOk {
  txHash: string;
  warnings?: HandlerWarning[];
}

/**
 * Generic exchange-keyed post-commit handler — wired from each of the
 * per-action wrappers below. Entity-keyed actions (e.g. `withdrawFunds`)
 * have their own handler in `./withdraw-funds.ts`.
 */
export async function handlePerformAction(
  action: ExchangeActionId,
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

/**
 * Redeem handler. Validates the buyer's `fulfillment` selection (if
 * present) against the offer's advertised option set and the host's
 * channel registry, runs the channel's `validate` up-front, then
 * forwards to the facilitator. The corresponding
 * `onCommit(exchangeId, data)` upsert is deferred until *after* the
 * facilitator + state verification confirm the exchange reached
 * `REDEEMED`, so a failed redeem leaves the stored delivery target
 * unchanged. The voucher NFT is transferable; whichever wallet signs
 * `boson-redeem` supplies the delivery data — it's the redeemer's
 * choice end-to-end.
 */
export async function handleRedeem(
  input: RedeemHandlerInput,
  ctx: RedeemHandlerContext,
): Promise<HandlerResult<PerformActionOk>> {
  let redeemer: Address;
  try {
    redeemer = decodeSignedPayload(input.signedPayload).from as Address;
  } catch (e) {
    return handlerErr(
      400,
      "SIGNED_PAYLOAD_DECODE_FAILED",
      e instanceof Error ? e.message : "signedPayload could not be decoded",
    );
  }

  let resolvedChannel: RedeemFulfillmentChannel | undefined;
  if (input.fulfillment !== undefined) {
    const advertisedOptions = await ctx.exchangeFulfillmentOptionStore.get(input.exchangeId);
    if (advertisedOptions !== undefined && !advertisedOptions.includes(input.fulfillment.option)) {
      return handlerErr(
        400,
        "FULFILLMENT_OPTION_NOT_ADVERTISED",
        `fulfillment.option '${input.fulfillment.option}' was not advertised for this exchange`,
        { option: input.fulfillment.option, advertised: advertisedOptions },
      );
    }

    const channels = ctx.config.fulfillmentChannels;
    if (channels === undefined) {
      return handlerErr(
        400,
        "FULFILLMENT_CHANNELS_NOT_CONFIGURED",
        "server received redeem-time fulfillment data but has no fulfillmentChannels registered",
      );
    }
    const channel = channels.find((c) => c.id === input.fulfillment!.option);
    if (channel === undefined) {
      return handlerErr(
        400,
        "FULFILLMENT_OPTION_UNKNOWN",
        `fulfillment.option '${input.fulfillment.option}' is not registered with the server`,
        { option: input.fulfillment.option, registered: channels.map((c) => c.id) },
      );
    }
    // Host-supplied `validate` callbacks are arbitrary code — treat a
    // thrown error the same as `{ ok: false }` so a buggy / strict
    // adapter surfaces as a 400 the buyer can correct, not a 500.
    let validation: ReturnType<RedeemFulfillmentChannel["validate"]>;
    try {
      validation = channel.validate(input.fulfillment.data);
    } catch (e) {
      return handlerErr(400, "FULFILLMENT_DATA_INVALID", errorMessage(e), {
        option: input.fulfillment.option,
      });
    }
    if (!validation.ok) {
      return handlerErr(400, "FULFILLMENT_DATA_INVALID", validation.reason, {
        option: input.fulfillment.option,
      });
    }
    resolvedChannel = channel;
  }

  const result = await handlePerformAction("boson-redeem", input, ctx);
  if (!result.ok) return result;

  // Redeem confirmed REDEEMED on-chain — only now is it safe to
  // upsert the channel's delivery-target store. Record a pending
  // update first so a failing channel write leaves the host with an
  // explicit recovery item instead of losing the buyer's target.
  let warning: HandlerWarning | undefined;
  if (resolvedChannel !== undefined && input.fulfillment !== undefined) {
    const pending: FulfillmentRecoveryEntry = {
      exchangeId: input.exchangeId,
      option: input.fulfillment.option,
      data: input.fulfillment.data,
      redeemer,
      recordedAt: Date.now(),
    };
    await ctx.fulfillmentRecoveryStore.set(input.exchangeId, pending);
    try {
      await resolvedChannel.onCommit(input.exchangeId, input.fulfillment.data);
      await ctx.fulfillmentRecoveryStore.delete(input.exchangeId);
    } catch (e) {
      const reason = errorMessage(e);
      await ctx.fulfillmentRecoveryStore.set(input.exchangeId, { ...pending, error: reason });
      warning = {
        code: "FULFILLMENT_UPDATE_DEFERRED",
        reason:
          "redeem succeeded on-chain, but the server could not persist the fulfillment update",
        details: {
          exchangeId: input.exchangeId,
          option: input.fulfillment.option,
          error: reason,
        },
      };
    }
  }

  // The exchange is REDEEMED even if the fulfillment write is deferred;
  // the per-exchange option-policy entry is no longer consulted.
  await ctx.exchangeFulfillmentOptionStore.delete(input.exchangeId);

  if (warning !== undefined) {
    return {
      ...result,
      body: {
        ...result.body,
        warnings: [...(result.body.warnings ?? []), warning],
      },
    };
  }

  return result;
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Per-action sugar — preserves the action id at the type level. */
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
