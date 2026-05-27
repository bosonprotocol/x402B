// Multi-party scenarios — section E of the e2e plan.
//
//   - E1  two buyers commit concurrently to one seller → distinct
//         exchangeIds, both escrowed                               @p1
//   - E3  mutual resolveDispute requires BOTH parties' signatures
//         (coordinated dual-sig regression)                        @p0
//
// E2 (buyer commits, then seller `revokeVoucher` → buyer refunded)
// stays parked in `_skeletons.test.ts`: it needs seller-side
// `revokeVoucher` meta-tx signing wired through `SellerActor`, the same
// harness gap that defers B8. Both land together in a follow-up.
//
// Note on "the same offer" (E1): the plan's wording mirrors the
// x402-foundation model where an offer is a reusable listing. In Boson's
// `createOfferAndCommit` flow every commit mints its OWN offer from a
// freshly-signed FullOffer (unique meta-tx nonce → unique predicted
// offerId), so two buyers can't literally commit to one offer id. The
// meaningful assertion the plan is after — two buyers transacting the
// same seller's resource concurrently each get a distinct exchange and
// both are escrowed — holds, and that's what E1 checks.
//
// Gated behind `E2E_DOCKER=1`.

import { DisputeState, ExchangeState } from "@bosonprotocol/x402-actions";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { LOCAL_31337_0 } from "../../src/config/local-31337-0.js";
import {
  buildPublicClient,
  buildWalletClient,
  createBuyerActor,
  createSellerActor,
  performBuyerPostCommitAction,
  PostCommitActionError,
  type BuyerActor,
} from "../../src/harness/index.js";

import { EXPECTED_PRICE } from "./_assertion-constants.js";
import { createFundedBuyer, ensureBuyerCanPay } from "./_buyer-setup.js";
import { ENABLED } from "./_flags.js";
import { SEED_WALLETS } from "./_seed-wallets.js";
import { createScenarioContext, NONE_TOKEN_AUTH_SCENARIO, type ScenarioContext } from "./_setup.js";

const COMMIT_AMOUNT = 1_000_000n;

interface CommitResponseBody {
  ok?: boolean;
  x402b?: { exchangeId?: string };
}

/** Drive a `/resource` 402 retry → commit through `buyer` and return the `exchangeId`. */
async function commitFreshExchange(buyer: BuyerActor, resourceServerUrl: string): Promise<string> {
  const res = await buyer.fetch(`${resourceServerUrl}/resource`);
  if (res.status !== 200) {
    throw new Error(
      `[multi-party.test] failed to commit a fresh exchange: HTTP ${res.status} ${await res.text()}`,
    );
  }
  const body = (await res.json()) as CommitResponseBody;
  const exchangeId = body.x402b?.exchangeId;
  if (typeof exchangeId !== "string" || exchangeId.length === 0) {
    throw new Error(
      `[multi-party.test] commit response missing exchangeId: ${JSON.stringify(body)}`,
    );
  }
  return exchangeId;
}

describe.skipIf(!ENABLED)("@p1 multi-party — concurrent commit to one seller", () => {
  let ctx: ScenarioContext;
  let buyerB: BuyerActor;

  beforeAll(async () => {
    const publicClient = buildPublicClient();
    const funder = buildWalletClient(SEED_WALLETS.multiParty.account);
    // Two independent buyer EOAs, each on its own nonce stream so their
    // concurrent commits don't race. Fund sequentially (the funder has a
    // single nonce stream); mint + approve in parallel below.
    const buyerAccountA = await createFundedBuyer({ funder, publicClient });
    const buyerAccountB = await createFundedBuyer({ funder, publicClient });
    ctx = await createScenarioContext({
      slot: "multiParty",
      buyerAccount: buyerAccountA,
      ...NONE_TOKEN_AUTH_SCENARIO,
    });
    buyerB = createBuyerActor({
      account: buyerAccountB,
      publicClient,
      policy: NONE_TOKEN_AUTH_SCENARIO.buyerPolicy,
    });
    await Promise.all(
      [buyerAccountA, buyerAccountB].map((account) =>
        ensureBuyerCanPay({
          walletClient: buildWalletClient(account),
          publicClient,
          buyerAddress: account.address,
          assetAddress: LOCAL_31337_0.contracts.testErc20,
          spenderAddress: LOCAL_31337_0.contracts.protocolDiamond,
          amount: COMMIT_AMOUNT,
        }),
      ),
    );
  });

  afterAll(async () => {
    await ctx?.teardown();
  });

  it("E1 — two buyers commit concurrently → distinct exchangeIds, both escrowed", async () => {
    // Fire both commits in the same microtask so neither waits on the
    // other (interval mining is on, set by globalSetup, so both meta-txs
    // can queue in the mempool).
    const [resA, resB] = await Promise.all([
      ctx.buyer.fetch(`${ctx.resourceServerUrl}/resource`),
      buyerB.fetch(`${ctx.resourceServerUrl}/resource`),
    ]);
    expect(resA.status, await resA.clone().text()).toBe(200);
    expect(resB.status, await resB.clone().text()).toBe(200);

    const [bodyA, bodyB] = (await Promise.all([resA.json(), resB.json()])) as CommitResponseBody[];
    const idA = bodyA?.x402b?.exchangeId;
    const idB = bodyB?.x402b?.exchangeId;
    expect(typeof idA, JSON.stringify(bodyA)).toBe("string");
    expect(typeof idB, JSON.stringify(bodyB)).toBe("string");
    expect(idA).not.toBe(idB);

    // Both land in COMMITTED against the same seller, each escrowing the
    // price — i.e. the escrow accounts for both buyers independently.
    await Promise.all(
      [idA!, idB!].map((id) =>
        ctx.asserter.expect(id, {
          state: ExchangeState.COMMITTED,
          seller: ctx.seller.address,
          exchangeToken: LOCAL_31337_0.contracts.testErc20,
          price: EXPECTED_PRICE,
        }),
      ),
    );
  });
});

describe.skipIf(!ENABLED)("@p0 multi-party — coordinated dual-sig resolveDispute", () => {
  let ctx: ScenarioContext;

  beforeAll(async () => {
    const publicClient = buildPublicClient();
    const funder = buildWalletClient(SEED_WALLETS.multiParty.account);
    // commit → redeem → raiseDispute → (2× resolve attempts) is a long
    // chain of buyer-signed txs; over-provision native ETH.
    const buyerAccount = await createFundedBuyer({ funder, publicClient, fundEth: "2" });
    ctx = await createScenarioContext({
      slot: "multiParty",
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

  it("E3 — resolveDispute requires the counterparty's signature", async () => {
    // Bring a fresh exchange to DISPUTED/RESOLVING, the state from which
    // mutual resolveDispute is legal.
    const exchangeId = await commitFreshExchange(ctx.buyer, ctx.resourceServerUrl);
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
    expect(disputed.newDisputeState).toBe(DisputeState.RESOLVING);

    const buyerPercentBasisPoints = 5000n;

    // Negative — the buyer submits resolveDispute with a resolution
    // proposal signed by a STRANGER (a throwaway key, not the seller).
    // The protocol recovers the counterparty signer and requires it to
    // be the seller, so the on-chain submit reverts → the harness throws
    // `PostCommitActionError`. A `SellerActor` is just an EIP-712 signer
    // over an account, so wrapping a random account yields a structurally
    // valid signature from the wrong address.
    const stranger = createSellerActor({ account: privateKeyToAccount(generatePrivateKey()) });
    const strangerSig = await stranger.signResolutionProposal({
      exchangeId,
      buyerPercentBasisPoints,
    });
    const rejected = await performBuyerPostCommitAction({
      actionId: "boson-resolveDispute",
      buyer: ctx.buyer,
      resourceServerUrl: ctx.resourceServerUrl,
      exchangeId,
      escrowAddress: ctx.escrowAddress,
      network: ctx.network,
      buyerPercent: buyerPercentBasisPoints,
      counterpartySig: { r: strangerSig.r, s: strangerSig.s, v: strangerSig.v },
    }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(
      rejected,
      "resolveDispute with a non-seller counterparty sig should reject",
    ).toBeInstanceOf(PostCommitActionError);
    expect((rejected as PostCommitActionError).status).toBe(502);

    // The failed attempt reverted on-chain, so the dispute is untouched.
    await ctx.asserter.expect(exchangeId, {
      state: ExchangeState.DISPUTED,
      disputeState: DisputeState.RESOLVING,
      seller: ctx.seller.address,
      exchangeToken: LOCAL_31337_0.contracts.testErc20,
      price: EXPECTED_PRICE,
    });

    // Positive — the SELLER's signature over the SAME proposal (same
    // buyerPercent) resolves the dispute. Only the signer differs from
    // the rejected attempt, so this isolates "both signatures required".
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
