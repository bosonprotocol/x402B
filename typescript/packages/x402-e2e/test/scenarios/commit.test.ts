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
  createChainTokenDomainResolver,
  readXPaymentResponse,
} from "../../src/harness/index.js";

import { EXPECTED_PRICE, TX_HASH_REGEX } from "./_assertion-constants.js";
import { createFundedBuyer, ensureBuyerCanPay, ensureBuyerHasBalance } from "./_buyer-setup.js";
import { ENABLED } from "./_flags.js";
import { SEED_WALLETS } from "./_seed-wallets.js";
import { createScenarioContext, type ScenarioContext } from "./_setup.js";

describe.skipIf(!ENABLED)("@p0 commit-time scenarios", () => {
  let ctx: ScenarioContext;
  let buyerAccount: LocalAccount;

  beforeAll(async () => {
    // A1/A2 explicitly exercise the `none` token-auth path: server
    // advertises only `"none"` and the BuyerActor pins
    // `policy.tokenAuthStrategy: "none"`. Without the pin, the client
    // dispatcher would pick the highest-ranked strategy the server
    // advertises (it never picks `"none"` on its own) — and `none`
    // would silently slip into a different strategy's queue path,
    // masking the protocol's behaviour under the test name.
    const publicClient = buildPublicClient();
    const funder = buildWalletClient(SEED_WALLETS.commit.account);
    buyerAccount = await createFundedBuyer({ funder, publicClient });
    ctx = await createScenarioContext({
      slot: "commit",
      buyerAccount,
      tokenAuthStrategies: ["none"],
      buyerPolicy: { tokenAuthStrategy: "none" },
    });
    // `none` strategy requires the buyer to have pre-approved the
    // escrow — settle just calls `safeTransferFrom`. Top up by ~10x
    // the per-commit amount so successive tests in the describe don't
    // need re-approvals.
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
      policy: { redeemMode: "commit-and-redeem", tokenAuthStrategy: "none" },
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

  // Token-auth strategies. Each describe below pins
  // `tokenAuthStrategies` to a single value so the client dispatcher
  // can't fall back to a different strategy.
  it.todo("A4 — commit with `permit` token-auth (testErc2612)");
  it.todo("A5 — commit with `permit2` token-auth");
});

describe.skipIf(!ENABLED)("@p0 commit-time scenarios (ERC-3009)", () => {
  let ctx: ScenarioContext;

  beforeAll(async () => {
    // Distinct buyer + describe-scoped context so the resource server
    // advertises ONLY `erc3009` and the BuyerActor signs against the
    // testErc3009 token's domain. Shares the file's `commit` seed slot
    // with the @p0 describe above — vitest serialises describes within
    // a file, so the slot's seller can handle both back-to-back.
    const publicClient = buildPublicClient();
    const funder = buildWalletClient(SEED_WALLETS.commit.account);
    const buyerAccount = await createFundedBuyer({ funder, publicClient });
    ctx = await createScenarioContext({
      slot: "commit",
      buyerAccount,
      assetAddress: LOCAL_31337_0.contracts.testErc3009,
      tokenAuthStrategies: ["erc3009"],
      tokenDomainResolver: createChainTokenDomainResolver(publicClient),
      // The local Boson stack mines at 50 ms intervals with `+1 s`
      // per block → chain time runs ~20× wall-clock and drifts
      // hours ahead after a few test cycles. The ERC-3009
      // `validBefore` field is enforced against `block.timestamp`,
      // so the default 1-hour wall-clock window can already be in
      // the past by the time settle simulates. Stretch the window
      // to the protocol's max (24 h wall-clock = up to ~75 min of
      // useful chain-time validity at 20× drift).
      maxTimeoutSeconds: 24 * 60 * 60,
    });
    // ERC-3009's `ReceiveWithAuthorization` carries the transfer
    // approval inline — the buyer only needs a balance, no allowance.
    await ensureBuyerHasBalance({
      walletClient: buildWalletClient(buyerAccount),
      publicClient,
      buyerAddress: buyerAccount.address,
      assetAddress: LOCAL_31337_0.contracts.testErc3009,
      amount: 10_000_000n,
    });
  });

  afterAll(async () => {
    await ctx?.teardown();
  });

  it("A3 — commit with `erc3009` token-auth (testErc3009)", async () => {
    const res = await ctx.buyer.fetch(`${ctx.resourceServerUrl}/resource`);
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

    // Same COMMITTED outcome as A1 — the strategy change is invisible
    // post-settle, so we assert against the same on-chain shape but
    // with `testErc3009` as the exchangeToken.
    const exchangeId = body.x402b!.exchangeId!;
    await ctx.asserter.expect(exchangeId, {
      state: ExchangeState.COMMITTED,
      seller: ctx.seller.address,
      exchangeToken: LOCAL_31337_0.contracts.testErc3009,
      price: EXPECTED_PRICE,
    });
  });
});
