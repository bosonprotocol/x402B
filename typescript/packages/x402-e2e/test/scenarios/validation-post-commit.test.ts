// Remaining validation negatives — section C of the e2e plan, the
// half that needs live on-chain state rather than a tampered payload:
//
//   - C6  insufficient escrow balance  → facilitator SIMULATION_REVERT  @p1
//   - C9  sellerSig mismatch           → server SELLER_SIG_MISMATCH      @p1
//   - C10 action on the wrong state    → facilitator-rejected redeem     @p1
//
// Where the codes diverge from the original plan text, production wins
// (the deployed validator / facilitator are ground truth):
//   - C9 → `SELLER_SIG_MISMATCH` (validator rule 4), not the plan's
//     "BAD_SELLER_SIG" (there is no such code in the server's
//     `ValidationErrorCode` union).
//   - C10 → the server forwards every post-commit action to the
//     facilitator and only verifies the resulting state afterwards; it
//     does NOT pre-screen the action against the `ACTION_POST_STATE`
//     table. So a redeem on a CANCELLED exchange is caught by the
//     facilitator's on-chain simulation (`502 FACILITATOR_REJECTED`),
//     not by a server-side state pre-check.
//
// C6 and C9 share one buyer: C9 is rejected by the server validator
// *before* settle, so its balance is irrelevant, and C6 needs exactly
// the allowance-set-but-balance-short buyer C9 tolerates. C6 grants a
// standing allowance via `ensureBuyerAllowance` but never mints, so the
// `transferFrom` reverts on balance (not allowance) at simulation.

import { ExchangeState } from "@bosonprotocol/x402-actions";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { LOCAL_31337_0 } from "../../src/config/local-31337-0.js";
import {
  buildPublicClient,
  buildWalletClient,
  buildValidCommitHeader,
  performBuyerPostCommitAction,
  performCancelVoucher,
  PostCommitActionError,
  submitMutatedCommit,
  submitPaymentHeader,
} from "../../src/harness/index.js";

import { createFundedBuyer, ensureBuyerAllowance, ensureBuyerCanPay } from "./_buyer-setup.js";
import { ENABLED } from "./_flags.js";
import { SEED_WALLETS } from "./_seed-wallets.js";
import { createScenarioContext, NONE_TOKEN_AUTH_SCENARIO, type ScenarioContext } from "./_setup.js";

/** Drive a fresh `/resource` 402 retry → commit and return the resulting `exchangeId`. */
async function commitFreshExchange(ctx: ScenarioContext): Promise<string> {
  const res = await ctx.buyer.fetch(`${ctx.resourceServerUrl}/resource`);
  if (res.status !== 200) {
    throw new Error(
      `[validation-post-commit.test] failed to commit a fresh exchange: HTTP ${res.status} ${await res.text()}`,
    );
  }
  const body = (await res.json()) as { x402b?: { exchangeId?: string } };
  const exchangeId = body.x402b?.exchangeId;
  if (typeof exchangeId !== "string" || exchangeId.length === 0) {
    throw new Error(
      `[validation-post-commit.test] commit response missing exchangeId: ${JSON.stringify(body)}`,
    );
  }
  return exchangeId;
}

describe.skipIf(!ENABLED)("@p1 commit-time validation negatives (none strategy)", () => {
  let ctx: ScenarioContext;

  beforeAll(async () => {
    const publicClient = buildPublicClient();
    const funder = buildWalletClient(SEED_WALLETS.validationPostCommit.account);
    const buyerAccount = await createFundedBuyer({ funder, publicClient });
    ctx = await createScenarioContext({
      slot: "validationPostCommit",
      buyerAccount,
      ...NONE_TOKEN_AUTH_SCENARIO,
    });
    // Grant a standing escrow allowance but deliberately DO NOT mint any
    // payment tokens. C6's commit then reaches the facilitator (the
    // server doesn't pre-flight balance) and the on-chain `transferFrom`
    // reverts because balance < amount, not because allowance is short —
    // the facilitator classifies that as `SIMULATION_REVERT`. C9 is
    // rejected by the server validator before settle, so the empty
    // balance is a harmless no-op for it.
    await ensureBuyerAllowance({
      walletClient: buildWalletClient(buyerAccount),
      publicClient,
      buyerAddress: buyerAccount.address,
      assetAddress: LOCAL_31337_0.contracts.testErc20,
      spenderAddress: LOCAL_31337_0.contracts.protocolDiamond,
      amount: 1_000_000n,
    });
  });

  afterAll(async () => {
    await ctx?.teardown();
  });

  it("C9 — sellerSig mismatch in FullOffer → 400 SELLER_SIG_MISMATCH", async () => {
    const result = await submitMutatedCommit({
      resourceServerUrl: ctx.resourceServerUrl,
      client: ctx.buyer.client,
      mutate: (payload) => {
        // Flip the final nibble of the seller's offer signature — still
        // schema-valid hex, but no longer byte-equal to the sellerSig
        // the resource server advertised in `requirements.offer.sellerSig`,
        // which trips validator rule 4 (sellerSig equality). Rule 4 runs
        // before the rule-7 calldata check that also consumes sellerSig,
        // so the rejection is unambiguously the signature mismatch.
        const sig = payload.payload.offerRef.sellerSig;
        const last = sig.slice(-1);
        payload.payload.offerRef.sellerSig = (sig.slice(0, -1) +
          (last === "0" ? "1" : "0")) as `0x${string}`;
      },
    });

    expect(result.status, JSON.stringify(result.body)).toBe(400);
    expect(result.body?.code).toBe("SELLER_SIG_MISMATCH");
    expect(result.body?.details?.rule).toBe(4);
  });

  it("C6 — insufficient escrow balance → 502 facilitator SIMULATION_REVERT", async () => {
    // A fully-valid, correctly-signed commit: nothing is tampered. The
    // buyer has the standing allowance the `none` strategy needs but a
    // zero token balance, so the payload passes every server-side rule
    // and only reverts when the facilitator simulates the on-chain
    // `transferFrom` of the escrowed price.
    const { sessionId, headerValue } = await buildValidCommitHeader(
      ctx.resourceServerUrl,
      ctx.buyer.client,
    );
    const result = await submitPaymentHeader(ctx.resourceServerUrl, sessionId, headerValue);

    expect(result.status, JSON.stringify(result.body)).toBe(502);
    expect(result.body?.code).toBe("FACILITATOR_REJECTED");
    expect(result.body?.details?.facilitatorCode).toBe("SIMULATION_REVERT");
  });
});

describe.skipIf(!ENABLED)("@p1 post-commit validation — illegal state transition", () => {
  let ctx: ScenarioContext;

  beforeAll(async () => {
    const publicClient = buildPublicClient();
    const funder = buildWalletClient(SEED_WALLETS.validationPostCommit.account);
    // C10 needs a buyer that can actually commit AND cancel, so fund it
    // for real (balance + allowance) — unlike the C6/C9 describe above.
    const buyerAccount = await createFundedBuyer({ funder, publicClient });
    ctx = await createScenarioContext({
      slot: "validationPostCommit",
      buyerAccount,
      ...NONE_TOKEN_AUTH_SCENARIO,
    });
    await ensureBuyerCanPay({
      walletClient: buildWalletClient(buyerAccount),
      publicClient,
      buyerAddress: buyerAccount.address,
      assetAddress: LOCAL_31337_0.contracts.testErc20,
      spenderAddress: LOCAL_31337_0.contracts.protocolDiamond,
      amount: 10_000_000n,
    });
  });

  afterAll(async () => {
    await ctx?.teardown();
  });

  it("C10 — redeem after cancelVoucher (wrong state) → 502 FACILITATOR_REJECTED", async () => {
    // Commit → cancelVoucher leaves the exchange in CANCELLED. A redeem
    // is illegal from there; the server forwards it to the facilitator,
    // whose on-chain simulation reverts, surfacing as a
    // `PostCommitActionError` with a `502 FACILITATOR_REJECTED` body.
    const exchangeId = await commitFreshExchange(ctx);
    const cancelled = await performCancelVoucher({
      buyer: ctx.buyer,
      facilitatorUrl: ctx.facilitatorUrl,
      exchangeId,
      escrowAddress: ctx.escrowAddress,
      network: ctx.network,
    });
    expect(cancelled.newExchangeState).toBe(ExchangeState.CANCELLED);

    const error = await performBuyerPostCommitAction({
      actionId: "boson-redeem",
      buyer: ctx.buyer,
      resourceServerUrl: ctx.resourceServerUrl,
      exchangeId,
      escrowAddress: ctx.escrowAddress,
      network: ctx.network,
    }).then(
      () => null,
      (e: unknown) => e,
    );

    expect(error, "expected redeem on a CANCELLED exchange to reject").toBeInstanceOf(
      PostCommitActionError,
    );
    const rejected = error as PostCommitActionError;
    expect(rejected.status).toBe(502);
    const body = rejected.body as {
      code?: string;
      details?: { facilitatorCode?: string };
    };
    expect(body.code).toBe("FACILITATOR_REJECTED");
    expect(typeof body.details?.facilitatorCode).toBe("string");
  });
});
