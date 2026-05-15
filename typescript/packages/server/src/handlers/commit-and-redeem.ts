// Commit-time handlers — `handleCommit` (Flow A, post-state
// COMMITTED) and `handleCommitAndRedeem` (Flow B, post-state
// REDEEMED). Both decode `X-PAYMENT`, run the 13-rule validator,
// forward the signed payload to the facilitator's `/settle`, verify
// the resulting exchange snapshot, and emit a fresh `nextActions`
// envelope.

import { ExchangeState } from "@bosonprotocol/x402-actions";
import type { EscrowPaymentRequirements } from "@bosonprotocol/x402-core/schemes/escrow";
import type { ActionId } from "@bosonprotocol/x402-core/state-machine";

import { emitNextActions } from "./next-actions.js";
import { handlerErr, handlerOk, type HandlerResult, type HandlerWarning } from "./types.js";
import { decodeXPaymentHeader } from "../validate/decode.js";
import { validatePaymentPayload } from "../validate/payment-payload.js";
import {
  verifyExchange,
  type ExchangeReader,
  type VerifyExchangeExpected,
} from "../onchain/verify-exchange.js";
import type { FacilitatorClient } from "../facilitator/client.js";
import { FacilitatorHttpError } from "../facilitator/errors.js";
import type { FulfillmentRecoveryEntry, X402bServerConfig } from "../config.js";
import type { Store } from "../store.js";
import { noopLogger, type Logger } from "../logger.js";

export interface CommitHandlerInput {
  /** Raw `X-PAYMENT` header value (base64'd JSON). */
  paymentHeader: string | undefined | null;
  /** The 402 `PaymentRequirements` the buyer is responding to. */
  requirements: EscrowPaymentRequirements;
}

export interface CommitHandlerContext {
  config: X402bServerConfig;
  facilitator: FacilitatorClient;
  exchangeReader: ExchangeReader;
  fulfillmentRecoveryStore: Store<FulfillmentRecoveryEntry>;
  /**
   * Per-exchange fulfillment option policy. Flow A writes the ids
   * advertised by the original requirements so the redeem-time choice
   * is constrained to the offer's own channel set.
   */
  exchangeFulfillmentOptionStore: Store<readonly string[]>;
  /** Optional structured logger. Defaults to no-op when absent. */
  logger?: Logger;
}

export interface CommitOk {
  exchangeId: string;
  txHash: string;
  /**
   * Non-fatal post-settle conditions. Today only Flow B uses this slot —
   * the on-chain redeem may have succeeded while the configured channel
   * adapter's `onCommit(...)` failed (the buyer's funds and voucher are
   * already gone; the seller's host needs to recover the delivery target
   * out-of-band). The exchange state is the wire-format source of truth;
   * warnings are advisory.
   */
  warnings?: HandlerWarning[];
}

/**
 * Flow A — `boson-createOfferAndCommit`. Settles via facilitator,
 * expects the resulting exchange in `COMMITTED`, returns 200 with
 * `nextActions` advertising the legal post-COMMITTED transitions.
 */
export async function handleCommit(
  input: CommitHandlerInput,
  ctx: CommitHandlerContext,
): Promise<HandlerResult<CommitOk>> {
  return await handleCommitImpl(input, ctx, {
    expectedAction: "boson-createOfferAndCommit",
    expectedState: ExchangeState.COMMITTED,
  });
}

/**
 * Flow B — `boson-createOfferCommitAndRedeem`. Same pipeline as
 * `handleCommit` but verifies the exchange reached `REDEEMED`.
 */
export async function handleCommitAndRedeem(
  input: CommitHandlerInput,
  ctx: CommitHandlerContext,
): Promise<HandlerResult<CommitOk>> {
  return await handleCommitImpl(input, ctx, {
    expectedAction: "boson-createOfferCommitAndRedeem",
    expectedState: ExchangeState.REDEEMED,
  });
}

async function handleCommitImpl(
  input: CommitHandlerInput,
  ctx: CommitHandlerContext,
  expected: { expectedAction: ActionId; expectedState: ExchangeState },
): Promise<HandlerResult<CommitOk>> {
  const logger = ctx.logger ?? noopLogger;
  const decoded = decodeXPaymentHeader(input.paymentHeader);
  if (!decoded.ok) {
    const status = decoded.code === "MISSING_HEADER" ? 402 : 400;
    return handlerErr(status, decoded.code, decoded.reason);
  }
  if (decoded.payload.payload.action !== expected.expectedAction) {
    return handlerErr(
      400,
      "ACTION_ROUTE_MISMATCH",
      `handler expected action ${expected.expectedAction}, got ${decoded.payload.payload.action}`,
      {
        expected: expected.expectedAction,
        got: decoded.payload.payload.action,
      },
    );
  }

  // For atomic Flow B the validator needs a per-channel data validator
  // so it can reject malformed buyer data before the on-chain redeem
  // happens. Flow A doesn't carry `fulfillment.data` at commit time so
  // the validator never invokes this callback; pass it anyway and let
  // rule 13 dispatch on `payload.action`.
  const channels = ctx.config.fulfillmentChannels ?? [];
  const channelById = new Map(channels.map((c) => [c.id, c]));
  const validation = await validatePaymentPayload({
    payload: decoded.payload,
    requirements: input.requirements,
    chainId: ctx.config.chainId,
    validateFulfillmentData: (option, data) => {
      const channel = channelById.get(option);
      if (channel === undefined) {
        return {
          ok: false,
          reason: `fulfillment.option '${option}' has no registered channel adapter on this server`,
        };
      }
      try {
        return channel.validate(data);
      } catch (e) {
        return { ok: false, reason: e instanceof Error ? e.message : String(e) };
      }
    },
  });
  if (!validation.ok) {
    return handlerErr(400, validation.code, validation.reason ?? `rule ${validation.rule} failed`, {
      rule: validation.rule,
      field: validation.field,
      expected: validation.expected,
      got: validation.got,
    });
  }

  let settleResult: Awaited<ReturnType<FacilitatorClient["settle"]>>;
  try {
    settleResult = await ctx.facilitator.settle({
      scheme: "escrow",
      network: input.requirements.network,
      payload: decoded.payload,
      requirements: input.requirements,
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

  if (!settleResult.ok) {
    return handlerErr(502, "FACILITATOR_REJECTED", settleResult.reason, {
      facilitatorCode: settleResult.code,
    });
  }

  const verifyResult = await verifyExchange(
    ctx.exchangeReader,
    settleResult.exchangeId,
    buildExpectedFromRequirements(input.requirements, expected.expectedState),
  );
  if (!verifyResult.ok) {
    return handlerErr(
      502,
      `STATE_VERIFY_${verifyResult.code}`,
      "post-settle state verification failed",
      {
        exchangeId: settleResult.exchangeId,
        txHash: settleResult.txHash,
        field: verifyResult.field,
        expected: verifyResult.expected,
        got: verifyResult.got,
      },
    );
  }

  // Flow A only: persist the *advertised* option ids from the original
  // 402 so the redeem handler can constrain the buyer's redeem-time
  // fulfillment choice to the offer's own channel set. Flow B is
  // already in REDEEMED — there is no later redeem step to gate.
  if (expected.expectedState === ExchangeState.COMMITTED) {
    await ctx.exchangeFulfillmentOptionStore.set(
      settleResult.exchangeId,
      input.requirements.fulfillment?.options.map((option) => option.id) ?? [],
    );
  }

  // Flow B only: the buyer's delivery data rides along with the
  // commit-time payload because atomic redeem leaves no later round
  // trip for it. The on-chain redeem has already settled at this
  // point; channel persistence is best-effort and surfaces as a
  // warning on failure (the buyer's funds + voucher are irreversibly
  // committed regardless). Record a pending update before the channel
  // write so the host can recover if the write fails after redeem.
  const warnings: HandlerWarning[] = [];
  if (
    expected.expectedState === ExchangeState.REDEEMED &&
    decoded.payload.fulfillment !== undefined &&
    decoded.payload.fulfillment.data !== undefined
  ) {
    const pending: FulfillmentRecoveryEntry = {
      exchangeId: settleResult.exchangeId,
      option: decoded.payload.fulfillment.option,
      data: decoded.payload.fulfillment.data,
      redeemer: decoded.payload.payload.buyer,
      recordedAt: Date.now(),
    };
    await ctx.fulfillmentRecoveryStore.set(settleResult.exchangeId, pending);
    logger.debug("x402-server: fulfillment recovery entry recorded (Flow B)", {
      exchangeId: settleResult.exchangeId,
      option: decoded.payload.fulfillment.option,
    });

    const channel = channelById.get(decoded.payload.fulfillment.option);
    if (channel === undefined) {
      const reason = "no channel adapter is registered";
      await ctx.fulfillmentRecoveryStore.set(settleResult.exchangeId, {
        ...pending,
        error: reason,
      });
      logger.error("x402-server: Flow B channel adapter missing post-settle", {
        exchangeId: settleResult.exchangeId,
        option: decoded.payload.fulfillment.option,
      });
      // Validation should have caught this (rule 13 rejects an option
      // with no registered adapter). Surface a warning rather than
      // silently dropping the data if it slips past.
      warnings.push({
        code: "FULFILLMENT_COMMIT_DEFERRED",
        reason: "atomic redeem succeeded on-chain, but no channel adapter is registered",
        details: {
          exchangeId: settleResult.exchangeId,
          option: decoded.payload.fulfillment.option,
          error: reason,
        },
      });
    } else {
      try {
        await channel.onCommit(settleResult.exchangeId, decoded.payload.fulfillment.data);
        await ctx.fulfillmentRecoveryStore.delete(settleResult.exchangeId);
        logger.debug("x402-server: Flow B channel onCommit succeeded", {
          exchangeId: settleResult.exchangeId,
          option: decoded.payload.fulfillment.option,
        });
      } catch (e) {
        const reason = e instanceof Error ? e.message : String(e);
        await ctx.fulfillmentRecoveryStore.set(settleResult.exchangeId, {
          ...pending,
          error: reason,
        });
        logger.warn("x402-server: Flow B channel onCommit failed; recovery entry retained", {
          exchangeId: settleResult.exchangeId,
          option: decoded.payload.fulfillment.option,
          error: reason,
        });
        warnings.push({
          code: "FULFILLMENT_COMMIT_DEFERRED",
          reason: "atomic redeem succeeded on-chain, but the channel adapter rejected the data",
          details: {
            exchangeId: settleResult.exchangeId,
            option: decoded.payload.fulfillment.option,
            error: reason,
          },
        });
      }
    }
  }

  // Both commit-side actions transition to non-DISPUTED states
  // (COMMITTED for Flow A, REDEEMED for Flow B), so the cast to
  // `Exclude<ExchangeState, DISPUTED>` is sound — the function only
  // narrows `expected.expectedState` itself which is typed loosely as
  // `ExchangeState` for shared use by both wrappers.
  const nextActions = emitNextActions(
    {
      exchangeId: settleResult.exchangeId,
      exchangeState: expected.expectedState as Exclude<
        ExchangeState,
        typeof ExchangeState.DISPUTED
      >,
    },
    ctx.config.channelRegistry,
    ctx.config.facilitator.url,
  );
  return handlerOk({
    exchangeId: settleResult.exchangeId,
    txHash: settleResult.txHash,
    nextActions,
    ...(warnings.length > 0 ? { warnings } : {}),
  });
}

function buildExpectedFromRequirements(
  requirements: EscrowPaymentRequirements,
  state: ExchangeState,
): VerifyExchangeExpected {
  return {
    state,
    seller: requirements.offer.creator,
    exchangeToken: requirements.asset,
    price: requirements.amount,
  };
}
