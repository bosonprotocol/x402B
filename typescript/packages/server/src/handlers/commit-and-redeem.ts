// Commit-time handlers — `handleCommit` (Flow A, post-state
// COMMITTED) and `handleCommitAndRedeem` (Flow B, post-state
// REDEEMED). Both decode `X-PAYMENT`, run the 13-rule validator,
// forward the signed payload to the facilitator's `/settle`, verify
// the resulting exchange snapshot, and emit a fresh `nextActions`
// envelope.

import { ExchangeState } from "@bosonprotocol/x402-actions";
import type { Address, EscrowPaymentRequirements } from "@bosonprotocol/x402-core/schemes/escrow";
import type { ActionId } from "@bosonprotocol/x402-core/state-machine";

import { emitNextActions } from "./next-actions.js";
import { handlerErr, handlerOk, type HandlerResult } from "./types.js";
import { decodeXPaymentHeader } from "../validate/decode.js";
import { validatePaymentPayload } from "../validate/payment-payload.js";
import {
  verifyExchange,
  type ExchangeReader,
  type VerifyExchangeExpected,
} from "../onchain/verify-exchange.js";
import type { FacilitatorClient } from "../facilitator/client.js";
import { FacilitatorHttpError } from "../facilitator/errors.js";
import type { X402bServerConfig } from "../config.js";

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
  /**
   * Committer-wallet store. Flow A writes the buyer address keyed by
   * the new `exchangeId` so the redeem handler can detect
   * voucher-transfer mid-flight. Flow B (atomic commit+redeem) skips
   * the write — the redeem step has already happened on-chain.
   */
  exchangeBuyerStore: Map<string, Address>;
  /**
   * Per-exchange fulfillment option policy. Flow A writes the ids
   * advertised by the original requirements so redeem-time updates are
   * constrained to the offer's own channel set.
   */
  exchangeFulfillmentOptionStore: Map<string, readonly string[]>;
}

export interface CommitOk {
  exchangeId: string;
  txHash: string;
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

  const validation = await validatePaymentPayload({
    payload: decoded.payload,
    requirements: input.requirements,
    chainId: ctx.config.chainId,
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

  // Flow A only: persist the committer wallet so the redeem handler
  // can detect a voucher transfer between commit and redeem. Flow B
  // is already in REDEEMED — there is no later redeem step to gate.
  if (expected.expectedState === ExchangeState.COMMITTED) {
    ctx.exchangeBuyerStore.set(settleResult.exchangeId, decoded.payload.payload.buyer);
    // Tracks the *advertised* option ids from the original 402, not the
    // buyer's chosen option — the redeem handler uses this to constrain
    // any redeem-time fulfillment update to the offer's advertised set.
    ctx.exchangeFulfillmentOptionStore.set(
      settleResult.exchangeId,
      input.requirements.fulfillment?.options.map((option) => option.id) ?? [],
    );
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
