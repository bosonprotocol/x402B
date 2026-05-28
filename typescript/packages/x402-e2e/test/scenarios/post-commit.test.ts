// Post-commit lifecycle scenarios — section B of the e2e plan.
//
// Each test starts from a fresh committed exchange (driven through
// the same `/resource` 402 retry A1 uses) and exercises one of the
// post-commit transitions the protocol supports.
//
// Coverage in this file:
//
//   - B1  redeem after deferred commit                        @p0
//   - B2  completeExchange after redeem                       @p0
//   - B3  raiseDispute after redeem                           @p0
//   - B4  mutual resolveDispute (50/50, dual-sig)             @p0
//   - B6  retractDispute by buyer                             @p1
//   - B7  cancelVoucher before redeem (via facilitator)       @p1
//
// Deferred to a follow-up PR:
//   - B5 escalateDispute  — needs dispute-resolver-deposit handling
//   - B8 revokeVoucher    — needs SellerActor meta-tx signing
//   - B9 decideDispute    — needs ResolverActor wallet signing
//
// All scenarios gated behind `E2E_DOCKER=1` because they hit the live
// local stack (Diamond, subgraph, facilitator).

import { ExchangeState, DisputeState } from "@bosonprotocol/x402-actions";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { LOCAL_31337_0 } from "../../src/config/local-31337-0.js";
import {
  buildPublicClient,
  buildWalletClient,
  performBuyerPostCommitAction,
  performCancelVoucher,
} from "../../src/harness/index.js";

import { EXPECTED_PRICE, TX_HASH_REGEX } from "./_assertion-constants.js";
import { createFundedBuyer, ensureBuyerCanPay } from "./_buyer-setup.js";
import { ENABLED } from "./_flags.js";
import { SEED_WALLETS } from "./_seed-wallets.js";
import { createScenarioContext, NONE_TOKEN_AUTH_SCENARIO, type ScenarioContext } from "./_setup.js";

/**
 * Drive a fresh `/resource` 402 retry → commit and return the
 * resulting `exchangeId`. The shared buyer's allowance is topped up
 * once in `beforeAll`; every commit produces a brand-new on-chain
 * offer (the seller's signed FullOffer carries a fresh meta-tx nonce
 * each time), so successive commits don't race the `quantityAvailable: "1"`
 * cap on a single offer.
 */
async function commitFreshExchange(ctx: ScenarioContext): Promise<string> {
  const res = await ctx.buyer.fetch(`${ctx.resourceServerUrl}/resource`);
  if (res.status !== 200) {
    throw new Error(
      `[post-commit.test] failed to commit a fresh exchange: HTTP ${res.status} ${await res.text()}`,
    );
  }
  const body = (await res.json()) as {
    x402b?: { exchangeId?: string };
  };
  const exchangeId = body.x402b?.exchangeId;
  if (typeof exchangeId !== "string" || exchangeId.length === 0) {
    throw new Error(
      `[post-commit.test] commit response missing exchangeId: ${JSON.stringify(body)}`,
    );
  }
  return exchangeId;
}

describe.skipIf(!ENABLED)("@p0 post-commit lifecycle scenarios", () => {
  let ctx: ScenarioContext;

  beforeAll(async () => {
    const publicClient = buildPublicClient();
    const funder = buildWalletClient(SEED_WALLETS.postCommit.account);
    // Each test in this describe commits multiple fresh exchanges, so
    // give the random buyer enough native ETH to cover all the local
    // mint + approve + transfer fees.
    const buyerAccount = await createFundedBuyer({ funder, publicClient, fundEth: "2" });
    // Pin the `none` token-auth strategy on both the in-process resource
    // server and the buyer policy. Without this pin, the buyer client
    // picks `permit2` (its default preference for clients without a
    // `tokenDomainResolver`) and the on-chain `transferFrom` reverts
    // with "ERC20: insufficient allowance" because the buyer has only
    // approved the protocol Diamond — not the canonical Permit2
    // contract that the Permit2 path transfers through. Post-commit
    // scenarios just need a committed exchange as a starting state, so
    // any working strategy is fine; `none` matches the allowance
    // `ensureBuyerCanPay` sets up below.
    ctx = await createScenarioContext({
      slot: "postCommit",
      buyerAccount,
      ...NONE_TOKEN_AUTH_SCENARIO,
    });
    // Over-provision the buyer's allowance by ~10x the per-commit cap
    // so successive commits inside the describe don't need re-approval.
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

  it("B1 — redeem after deferred commit → REDEEMED", async () => {
    const exchangeId = await commitFreshExchange(ctx);
    const result = await performBuyerPostCommitAction({
      actionId: "boson-redeem",
      buyer: ctx.buyer,
      resourceServerUrl: ctx.resourceServerUrl,
      exchangeId,
      escrowAddress: ctx.escrowAddress,
      network: ctx.network,
    });
    expect(result.txHash).toMatch(TX_HASH_REGEX);
    expect(result.newExchangeState).toBe(ExchangeState.REDEEMED);

    await ctx.asserter.expect(exchangeId, {
      state: ExchangeState.REDEEMED,
      seller: ctx.seller.address,
      exchangeToken: LOCAL_31337_0.contracts.testErc20,
      price: EXPECTED_PRICE,
    });
  });

  it("B2 — completeExchange after redeem → COMPLETED, escrow released", async () => {
    const exchangeId = await commitFreshExchange(ctx);
    await performBuyerPostCommitAction({
      actionId: "boson-redeem",
      buyer: ctx.buyer,
      resourceServerUrl: ctx.resourceServerUrl,
      exchangeId,
      escrowAddress: ctx.escrowAddress,
      network: ctx.network,
    });
    const completed = await performBuyerPostCommitAction({
      actionId: "boson-completeExchange",
      buyer: ctx.buyer,
      resourceServerUrl: ctx.resourceServerUrl,
      exchangeId,
      escrowAddress: ctx.escrowAddress,
      network: ctx.network,
    });
    expect(completed.newExchangeState).toBe(ExchangeState.COMPLETED);

    await ctx.asserter.expect(exchangeId, {
      state: ExchangeState.COMPLETED,
      seller: ctx.seller.address,
      exchangeToken: LOCAL_31337_0.contracts.testErc20,
      price: EXPECTED_PRICE,
    });
  });

  it("B3 — raiseDispute after redeem → DISPUTED + RESOLVING", async () => {
    const exchangeId = await commitFreshExchange(ctx);
    await performBuyerPostCommitAction({
      actionId: "boson-redeem",
      buyer: ctx.buyer,
      resourceServerUrl: ctx.resourceServerUrl,
      exchangeId,
      escrowAddress: ctx.escrowAddress,
      network: ctx.network,
    });
    const disputed = await performBuyerPostCommitAction({
      actionId: "boson-raiseDispute",
      buyer: ctx.buyer,
      resourceServerUrl: ctx.resourceServerUrl,
      exchangeId,
      escrowAddress: ctx.escrowAddress,
      network: ctx.network,
    });
    expect(disputed.newExchangeState).toBe(ExchangeState.DISPUTED);
    expect(disputed.newDisputeState).toBe(DisputeState.RESOLVING);

    await ctx.asserter.expect(exchangeId, {
      state: ExchangeState.DISPUTED,
      disputeState: DisputeState.RESOLVING,
      seller: ctx.seller.address,
      exchangeToken: LOCAL_31337_0.contracts.testErc20,
      price: EXPECTED_PRICE,
    });
  });

  it("B4 — mutual resolveDispute (50/50 dual-sig) → RESOLVED", async () => {
    // Commit → redeem → raiseDispute brings us to the state where
    // mutual resolveDispute is legal. From here the buyer needs the
    // seller's signature over `Resolution(exchangeId, buyerPercentBasisPoints)`
    // — produced by `SellerActor.signResolutionProposal` — as the
    // `counterpartySig` argument to `client.signAction`.
    const exchangeId = await commitFreshExchange(ctx);
    await performBuyerPostCommitAction({
      actionId: "boson-redeem",
      buyer: ctx.buyer,
      resourceServerUrl: ctx.resourceServerUrl,
      exchangeId,
      escrowAddress: ctx.escrowAddress,
      network: ctx.network,
    });
    await performBuyerPostCommitAction({
      actionId: "boson-raiseDispute",
      buyer: ctx.buyer,
      resourceServerUrl: ctx.resourceServerUrl,
      exchangeId,
      escrowAddress: ctx.escrowAddress,
      network: ctx.network,
    });

    // 50/50 split. `buyerPercentBasisPoints` is the canonical wire
    // unit (10000 = 100 %); the buyer's `signAction` accepts
    // `buyerPercent` as a `BigNumberish` and forwards the same value
    // to core-sdk's `signMetaTxResolveDispute`.
    const buyerPercentBasisPoints = 5000n;
    const sellerSig = await ctx.seller.signResolutionProposal({
      exchangeId,
      buyerPercentBasisPoints,
    });

    const resolved = await performBuyerPostCommitAction({
      actionId: "boson-resolveDispute",
      buyer: ctx.buyer,
      resourceServerUrl: ctx.resourceServerUrl,
      exchangeId,
      escrowAddress: ctx.escrowAddress,
      network: ctx.network,
      buyerPercent: buyerPercentBasisPoints,
      counterpartySig: { r: sellerSig.r, s: sellerSig.s, v: sellerSig.v },
    });
    expect(resolved.newDisputeState).toBe(DisputeState.RESOLVED);

    await ctx.asserter.expect(exchangeId, {
      state: ExchangeState.DISPUTED,
      disputeState: DisputeState.RESOLVED,
      seller: ctx.seller.address,
      exchangeToken: LOCAL_31337_0.contracts.testErc20,
      price: EXPECTED_PRICE,
    });
  });
});

describe.skipIf(!ENABLED)("@p1 post-commit lifecycle scenarios", () => {
  let ctx: ScenarioContext;

  beforeAll(async () => {
    const publicClient = buildPublicClient();
    // @p0 and @p1 live in the same file and run sequentially, so they
    // share the file's slot — `vitest` serialises within-file tests
    // and the slot's seller / funder can handle both describes' load.
    const funder = buildWalletClient(SEED_WALLETS.postCommit.account);
    const buyerAccount = await createFundedBuyer({ funder, publicClient, fundEth: "2" });
    ctx = await createScenarioContext({
      slot: "postCommit",
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

  it("B6 — retractDispute by buyer → RETRACTED (seller wins)", async () => {
    const exchangeId = await commitFreshExchange(ctx);
    await performBuyerPostCommitAction({
      actionId: "boson-redeem",
      buyer: ctx.buyer,
      resourceServerUrl: ctx.resourceServerUrl,
      exchangeId,
      escrowAddress: ctx.escrowAddress,
      network: ctx.network,
    });
    await performBuyerPostCommitAction({
      actionId: "boson-raiseDispute",
      buyer: ctx.buyer,
      resourceServerUrl: ctx.resourceServerUrl,
      exchangeId,
      escrowAddress: ctx.escrowAddress,
      network: ctx.network,
    });

    const retracted = await performBuyerPostCommitAction({
      actionId: "boson-retractDispute",
      buyer: ctx.buyer,
      resourceServerUrl: ctx.resourceServerUrl,
      exchangeId,
      escrowAddress: ctx.escrowAddress,
      network: ctx.network,
    });
    expect(retracted.newDisputeState).toBe(DisputeState.RETRACTED);

    await ctx.asserter.expect(exchangeId, {
      state: ExchangeState.DISPUTED,
      disputeState: DisputeState.RETRACTED,
      seller: ctx.seller.address,
      exchangeToken: LOCAL_31337_0.contracts.testErc20,
      price: EXPECTED_PRICE,
    });
  });

  it("B7 — cancelVoucher before redeem → CANCELLED (via facilitator)", async () => {
    // `cancelVoucher` is buyer-initiated but the example resource
    // server doesn't mount a `/x402B/cancel` route (it's outside the
    // happy-path "buy a resource" flow). The facilitator's generic
    // `POST /perform-action` route still accepts it, so the harness
    // submits there directly.
    const exchangeId = await commitFreshExchange(ctx);

    const cancelled = await performCancelVoucher({
      buyer: ctx.buyer,
      facilitatorUrl: ctx.facilitatorUrl,
      exchangeId,
      escrowAddress: ctx.escrowAddress,
      network: ctx.network,
    });
    expect(cancelled.newExchangeState).toBe(ExchangeState.CANCELLED);

    await ctx.asserter.expect(exchangeId, {
      state: ExchangeState.CANCELLED,
      seller: ctx.seller.address,
      exchangeToken: LOCAL_31337_0.contracts.testErc20,
      price: EXPECTED_PRICE,
    });
  });
});
