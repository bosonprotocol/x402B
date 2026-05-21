// Commit-time scenarios — section A of the e2e plan.
//
// Gated behind `E2E_DOCKER=1` because every test boots the buyer
// through the in-process resource server, the facilitator service,
// and the local Boson chain. Run with:
//
//   E2E_DOCKER=1 pnpm --filter @bosonprotocol/x402-e2e test
//
// A1 is the primary @p0 happy path: buyer pre-approves the escrow,
// fetches the resource, the middleware emits a 402, the buyer's
// `wrapFetchWithPayment` signs and retries with X-PAYMENT, settle
// commits on-chain, and the response carries `X-PAYMENT-RESPONSE`
// with the new `exchangeId`. A2–A5 cover the other commit-time
// dimensions (atomic / token-auth strategies); they're `it.todo`
// in this PR and land in PR 7.

import { ExchangeState } from "@bosonprotocol/x402-actions";
import type { LocalAccount } from "viem";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { LOCAL_31337_0 } from "../../src/config/local-31337-0.js";
import {
  buildPublicClient,
  buildWalletClient,
  createBuyerActor,
  readXPaymentResponse,
} from "../../src/harness/index.js";

import { EXPECTED_PRICE, TX_HASH_REGEX } from "./_assertion-constants.js";
import { createFundedBuyer, ensureBuyerCanPay } from "./_buyer-setup.js";
import { ENABLED } from "./_flags.js";
import { SEED_WALLETS } from "./_seed-wallets.js";
import { createScenarioContext, type ScenarioContext } from "./_setup.js";

describe.skipIf(!ENABLED)("@p0 commit-time scenarios", () => {
  let ctx: ScenarioContext;
  let buyerAccount: LocalAccount;

  beforeAll(async () => {
    const publicClient = buildPublicClient();
    const funder = buildWalletClient(SEED_WALLETS.commit.account);
    buyerAccount = await createFundedBuyer({ funder, publicClient });
    ctx = await createScenarioContext({ slot: "commit", buyerAccount });
    // Over-provision the buyer for the whole describe — A1 spends 1
    // USDC, A2's atomic flow spends another, and the to-be-unskipped
    // A3–A5 each commit one more. Funding the deficit ~10x up-front
    // keeps each test from re-minting (and matches the post-commit
    // describe's pattern).
    await ensureBuyerCanPay({
      walletClient: buildWalletClient(buyerAccount),
      publicClient,
      buyerAddress: buyerAccount.address,
      assetAddress: LOCAL_31337_0.contracts.testErc20,
      escrowAddress: LOCAL_31337_0.contracts.protocolDiamond,
      amount: 10_000_000n,
    });
  });

  afterAll(async () => {
    await ctx?.teardown();
  });

  it("A1 — deferred commit with `none` strategy + inline fulfillment", async () => {
    // Drive the full happy path through `wrapFetchWithPayment`. The
    // first call sees a 402, the buyer signs, the retry settles
    // on-chain, and we assert against both the HTTP response and the
    // on-chain state via the subgraph asserter.
    const res = await ctx.buyer.fetch(`${ctx.resourceServerUrl}/resource`);
    expect(res.status, await res.clone().text()).toBe(200);

    const body = (await res.json()) as {
      ok?: boolean;
      x402b?: { exchangeId?: string; txHash?: `0x${string}` };
    };
    expect(body.ok).toBe(true);
    expect(typeof body.x402b?.exchangeId).toBe("string");

    const decoded = readXPaymentResponse(res.headers);
    expect(decoded, "X-PAYMENT-RESPONSE header should decode to a JSON payload").not.toBeNull();
    expect(decoded?.exchangeId).toBe(body.x402b?.exchangeId);
    expect(decoded?.txHash).toMatch(TX_HASH_REGEX);

    // On-chain state — exchange should be `COMMITTED` with seller +
    // exchangeToken + price matching the requirements. The asserter
    // retries on subgraph indexer lag.
    const exchangeId = body.x402b!.exchangeId!;
    await ctx.asserter.expect(exchangeId, {
      state: ExchangeState.COMMITTED,
      seller: ctx.seller.address,
      exchangeToken: LOCAL_31337_0.contracts.testErc20,
      price: EXPECTED_PRICE,
    });
  });

  // Atomic commit-and-redeem (`boson-createOfferCommitAndRedeem`).
  // Same wire path as A1 but the client selects `commit-and-redeem`
  // via `Policy.redeemMode: "commit-and-redeem"` so the buyer ends
  // up at `REDEEMED` in a single tx.
  it("A2 — atomic commit-and-redeem with `none` strategy", async () => {
    // A2 needs its own buyer with a non-default `Policy.redeemMode` so
    // the client picks `boson-createOfferCommitAndRedeem` instead of
    // the deferred flow A1 used. Reuse the describe-scoped funded
    // buyer (the allowance from `beforeAll` is still in place).
    const atomicBuyer = createBuyerActor({
      account: buyerAccount,
      publicClient: ctx.buyer.publicClient,
      policy: { redeemMode: "commit-and-redeem" },
    });

    const res = await atomicBuyer.fetch(`${ctx.resourceServerUrl}/resource`);
    expect(res.status, await res.clone().text()).toBe(200);

    const body = (await res.json()) as {
      ok?: boolean;
      x402b?: { exchangeId?: string; txHash?: `0x${string}` };
    };
    expect(body.ok).toBe(true);
    expect(typeof body.x402b?.exchangeId).toBe("string");

    const decoded = readXPaymentResponse(res.headers);
    expect(decoded?.exchangeId).toBe(body.x402b?.exchangeId);
    expect(decoded?.txHash).toMatch(TX_HASH_REGEX);

    // Atomic flow → exchange should land directly in REDEEMED, not
    // COMMITTED. Same seller / exchangeToken / price as A1.
    const exchangeId = body.x402b!.exchangeId!;
    await ctx.asserter.expect(exchangeId, {
      state: ExchangeState.REDEEMED,
      seller: ctx.seller.address,
      exchangeToken: LOCAL_31337_0.contracts.testErc20,
      price: EXPECTED_PRICE,
    });
  });

  // Token-auth strategies. The resource server already advertises
  // `["none","erc3009","permit","permit2"]`; PR6 follow-up implements
  // these as their own beforeAll variants (different asset for
  // erc3009 / permit, different cap for permit2).
  it.todo("A3 — commit with `erc3009` token-auth (testErc3009)");
  it.todo("A4 — commit with `permit` token-auth (testErc2612)");
  it.todo("A5 — commit with `permit2` token-auth");
});
