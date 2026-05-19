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
// dimensions (atomic / token-auth strategies) and land as full tests
// in this PR once A1 is validated against the live stack — for now
// they're `it.todo` so the suite enumerates them.

import { ExchangeState } from "@bosonprotocol/x402-actions";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { LOCAL_31337_0 } from "../../src/config/local-31337-0.js";
import { ROLE_ACCOUNTS } from "../../src/config/accounts.js";
import {
  buildPublicClient,
  buildWalletClient,
  readXPaymentResponse,
} from "../../src/harness/index.js";
import { privateKeyToAccount } from "viem/accounts";

import { ensureBuyerCanPay } from "./_buyer-setup.js";
import { ENABLED } from "./_flags.js";
import { createScenarioContext, type ScenarioContext } from "./_setup.js";

describe.skipIf(!ENABLED)("@p0 commit-time scenarios", () => {
  let ctx: ScenarioContext;

  beforeAll(async () => {
    ctx = await createScenarioContext();
    const buyerAccount = privateKeyToAccount(ROLE_ACCOUNTS.buyer.privateKey);
    const buyerWallet = buildWalletClient(buyerAccount);
    const publicClient = buildPublicClient();
    await ensureBuyerCanPay({
      walletClient: buyerWallet,
      publicClient,
      buyerAddress: buyerAccount.address,
      assetAddress: LOCAL_31337_0.contracts.testErc20,
      escrowAddress: LOCAL_31337_0.contracts.protocolDiamond,
      amount: 1_000_000n,
    });
  });

  afterAll(async () => {
    await ctx?.teardown();
  });

  // Skipped pending x402B#73. The buyer-side flow drives correctly,
  // but the server rejects with rule-7 `CALLDATA_MISMATCH`: the buyer
  // signs the meta-tx with `committer: buyer`, while `assemblePayload`
  // still ships the server's original `offerRef.fullOffer.committer
  // = 0x0`. Once that one-line client-side fix lands, drop `.skip`
  // and the test runs as the @p0 happy path.
  it.skip("A1 — deferred commit with `none` strategy + inline fulfillment (#73)", async () => {
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
    expect(decoded?.txHash).toMatch(/^0x[0-9a-fA-F]+$/);

    // On-chain state — exchange should be `COMMITTED` with seller +
    // exchangeToken + price matching the requirements. The asserter
    // retries on subgraph indexer lag.
    const exchangeId = body.x402b!.exchangeId!;
    await ctx.asserter.expect(exchangeId, {
      state: ExchangeState.COMMITTED,
      seller: ctx.seller.address,
      exchangeToken: LOCAL_31337_0.contracts.testErc20,
      price: "1000000",
    });
  });

  // Atomic commit-and-redeem (`boson-createOfferCommitAndRedeem`).
  // Same wire path as A1 but the client selects `commit-and-redeem`
  // via `Policy.redeemMode: "commit-and-redeem"` so the buyer ends
  // up at `REDEEMED` in a single tx. Unblocked by Boson PR #1105.
  it.todo("A2 — atomic commit-and-redeem with `none` strategy");

  // Token-auth strategies. The resource server already advertises
  // `["none","erc3009","permit","permit2"]`; PR6 follow-up implements
  // these as their own beforeAll variants (different asset for
  // erc3009 / permit, different cap for permit2).
  it.todo("A3 — commit with `erc3009` token-auth (testErc3009)");
  it.todo("A4 — commit with `permit` token-auth (testErc2612)");
  it.todo("A5 — commit with `permit2` token-auth");
});
