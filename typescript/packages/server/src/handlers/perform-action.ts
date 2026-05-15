// Convenience handlers for the post-commit actions — `redeem`,
// `complete`, and the four dispute transitions. Each is a thin
// wrapper over the facilitator's `/perform-action` endpoint:
// forward the buyer- or seller-signed payload, verify the resulting
// exchange snapshot reaches the action's `ACTION_POST_STATE`, emit
// fresh `nextActions`.

import { ExchangeState } from "@bosonprotocol/x402-actions";
import type { Address } from "@bosonprotocol/x402-core/schemes/escrow";
import { ACTION_POST_STATE, type ActionId } from "@bosonprotocol/x402-core/state-machine";
import { decodeSignedPayload } from "@bosonprotocol/x402-evm";
import type { Hex } from "viem";

import { emitNextActions } from "./next-actions.js";
import { handlerErr, handlerOk, type HandlerResult, type HandlerWarning } from "./types.js";
import type { FacilitatorClient } from "../facilitator/client.js";
import { FacilitatorHttpError } from "../facilitator/errors.js";
import type {
  RedeemFulfillmentChannel,
  RedeemFulfillmentUpdate,
  X402bServerConfig,
} from "../config.js";
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
 * Redeem-time variant of `PerformActionInput`. Carries an optional
 * `fulfillment` update so a redeemer can revise the delivery target
 * between Flow A commit and redeem. Required when the redeeming
 * wallet differs from the committing wallet (voucher transfer);
 * optional when they match.
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
  exchangeBuyerStore: Map<string, Address>;
  exchangeFulfillmentOptionStore: Map<string, readonly string[]>;
  redeemFulfillmentUpdateStore: Map<string, RedeemFulfillmentUpdate>;
}

export interface PerformActionOk {
  txHash: string;
  warnings?: HandlerWarning[];
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

/**
 * Redeem handler. Before forwarding to the facilitator, runs a
 * wallet-rebinding check against `exchangeBuyerStore`:
 *
 * - If a committer wallet is on file and differs from the recovered
 *   redeemer wallet, the client MUST supply `fulfillment` (so the
 *   new holder's delivery target replaces the original committer's).
 * - If a committer wallet is on file and matches the redeemer, the
 *   client MAY omit `fulfillment` — existing data stays in place.
 * - If no committer record exists (legacy exchange / atomic flow
 *   that never wrote one), the wallet check is skipped.
 *
 * When `fulfillment` is supplied (either branch), the matching
 * channel's `validate` runs up-front; the corresponding
 * `onCommit(exchangeId, data)` upsert is deferred until *after* the
 * facilitator + state verification confirm the exchange reached
 * `REDEEMED`, so a failed redeem leaves the stored delivery target
 * unchanged. On success the committer-wallet entry is also dropped
 * from `exchangeBuyerStore` — the rebinding check is moot once the
 * voucher is burned.
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

  const committer = ctx.exchangeBuyerStore.get(input.exchangeId);
  const walletChanged = committer !== undefined && !addressesEqual(committer, redeemer);

  if (walletChanged && input.fulfillment === undefined) {
    return handlerErr(
      400,
      "FULFILLMENT_REQUIRED_ON_WALLET_CHANGE",
      "redeemer wallet differs from committer — new fulfillment data is required",
      { exchangeId: input.exchangeId, committer, redeemer },
    );
  }

  let resolvedChannel: RedeemFulfillmentChannel | undefined;
  if (input.fulfillment !== undefined) {
    const advertisedOptions = ctx.exchangeFulfillmentOptionStore.get(input.exchangeId);
    if (committer !== undefined && advertisedOptions === undefined) {
      return handlerErr(
        500,
        "FULFILLMENT_OPTIONS_NOT_TRACKED",
        "server has a committer record for this exchange but no fulfillment option policy",
        { exchangeId: input.exchangeId },
      );
    }
    if (
      advertisedOptions !== undefined &&
      !advertisedOptions.includes(input.fulfillment.option)
    ) {
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
    const validation = channel.validate(input.fulfillment.data);
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
  // explicit recovery item instead of losing the buyer's new target.
  let warning: HandlerWarning | undefined;
  if (resolvedChannel !== undefined && input.fulfillment !== undefined) {
    const pending: RedeemFulfillmentUpdate = {
      exchangeId: input.exchangeId,
      option: input.fulfillment.option,
      data: input.fulfillment.data,
      redeemer,
      recordedAt: Date.now(),
    };
    ctx.redeemFulfillmentUpdateStore.set(input.exchangeId, pending);
    try {
      await resolvedChannel.onCommit(input.exchangeId, input.fulfillment.data);
      ctx.redeemFulfillmentUpdateStore.delete(input.exchangeId);
    } catch (e) {
      const reason = errorMessage(e);
      ctx.redeemFulfillmentUpdateStore.set(input.exchangeId, { ...pending, error: reason });
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

  // The exchange is REDEEMED even if the fulfillment write is deferred,
  // so the wallet-rebinding gate no longer applies to this exchange.
  ctx.exchangeBuyerStore.delete(input.exchangeId);
  ctx.exchangeFulfillmentOptionStore.delete(input.exchangeId);

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

function addressesEqual(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
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
