// Concurrent access scenario — exercises the resource server +
// facilitator pair under simultaneous, multi-buyer load. Every other
// scenario file drives one buyer at a time (vitest serialises tests
// within a file), so regressions in the relayer nonce manager,
// session cache, or seller-side FullOffer signing under contention
// only show up here.
//
// Layout: 20 distinct freshly-funded EOAs each call
// `fetch(/resource)` against the same in-process resource server
// concurrently, all configured with `policy.redeemMode = "commit-and-redeem"`
// (atomic flow, same wire path as scenario A2). Every fetch is
// kicked off via `Promise.all(...)` so each client launches before
// any previous one has resolved.
//
// Gated behind `E2E_DOCKER=1`. Idempotent: each run mints 20 new
// random accounts, so re-running against an already-up stack
// (`E2E_DOCKER_KEEP_STACK=1`, see `test/setup/globalSetup.ts`) is
// safe to repeat indefinitely.

import { ExchangeState } from "@bosonprotocol/x402-actions";
import type { LocalAccount } from "viem";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { LOCAL_31337_0 } from "../../src/config/local-31337-0.js";
import {
  buildPublicClient,
  buildWalletClient,
  createBuyerActor,
  readXPaymentResponse,
  type BuyerActor,
} from "../../src/harness/index.js";

import { createFundedBuyer, ensureBuyerCanPay } from "./_buyer-setup.js";
import { ENABLED } from "./_flags.js";
import { SEED_WALLETS } from "./_seed-wallets.js";
import { createScenarioContext, NONE_TOKEN_AUTH_SCENARIO, type ScenarioContext } from "./_setup.js";

const CONCURRENT_BUYERS = 20;
const PER_COMMIT_AMOUNT = 1_000_000n;

interface CommitResponseBody {
  ok?: boolean;
  x402b?: { exchangeId?: string; txHash?: `0x${string}` };
}

describe.skipIf(!ENABLED)("@p0 concurrent commit-and-redeem scenarios", () => {
  let ctx: ScenarioContext;
  let buyers: BuyerActor[];

  beforeAll(async () => {
    const publicClient = buildPublicClient();
    const funder = buildWalletClient(SEED_WALLETS.concurrent.account);

    // Step 1 — fund 20 fresh EOAs sequentially. The funder has a
    // single nonce stream, so parallel `sendTransaction` calls would
    // race; the loop costs ~1 s total (well inside `hookTimeout`).
    const buyerAccounts: LocalAccount[] = [];
    for (let i = 0; i < CONCURRENT_BUYERS; i++) {
      buyerAccounts.push(await createFundedBuyer({ funder, publicClient }));
    }

    // Step 2 — mint + approve in parallel. Each buyer signs from its
    // own nonce stream, so 20 concurrent `mint` + `approve` pairs are
    // safe and let the chain mine them back-to-back.
    await Promise.all(
      buyerAccounts.map((account) =>
        ensureBuyerCanPay({
          walletClient: buildWalletClient(account),
          publicClient,
          buyerAddress: account.address,
          assetAddress: LOCAL_31337_0.contracts.testErc20,
          escrowAddress: LOCAL_31337_0.contracts.protocolDiamond,
          amount: PER_COMMIT_AMOUNT,
        }),
      ),
    );

    // The describe only needs the context for `resourceServerUrl`,
    // `seller`, `asserter`, and `teardown` — `ctx.buyer` is unused
    // because the test drives its own 20-buyer fleet. The first
    // buyer account is passed in to satisfy the required arg.
    //
    // Pin the `none` token-auth strategy on the in-process resource
    // server (and below on each BuyerActor's policy). Without it the
    // buyer client falls through to `permit2` (no `tokenDomainResolver`
    // is configured) and the on-chain `transferFrom` reverts with
    // "ERC20: insufficient allowance" — the buyers only approved the
    // protocol Diamond, not the canonical Permit2 contract.
    ctx = await createScenarioContext({
      slot: "concurrent",
      buyerAccount: buyerAccounts[0]!,
      tokenAuthStrategies: NONE_TOKEN_AUTH_SCENARIO.tokenAuthStrategies,
    });

    // Step 3 — assemble 20 BuyerActors that all share a single
    // `publicClient` (viem connection reuse) and the single
    // in-process resource server. Each actor signs from its own
    // account, so concurrent meta-tx signing across the fleet is
    // race-free.
    buyers = buyerAccounts.map((account) =>
      createBuyerActor({
        account,
        publicClient,
        policy: { ...NONE_TOKEN_AUTH_SCENARIO.buyerPolicy, redeemMode: "commit-and-redeem" },
      }),
    );
  });

  afterAll(async () => {
    await ctx?.teardown();
  });

  it(`E0 — ${CONCURRENT_BUYERS} concurrent buyers atomic commit-and-redeem`, async () => {
    // Fire every fetch synchronously before awaiting any of them.
    // `Promise.all` over `.map((b) => b.fetch(...))` starts each
    // request in the same microtask, satisfying the "no waiting for
    // the previous client" requirement; `t0` lets the run log
    // confirm the burst behaviour at a glance.
    const t0 = Date.now();
    const responses = await Promise.all(
      buyers.map((b) => b.fetch(`${ctx.resourceServerUrl}/resource`)),
    );
    console.log(
      `[concurrent.test] ${CONCURRENT_BUYERS} fetches completed in ${Date.now() - t0} ms`,
    );

    for (const res of responses) {
      expect(res.status, await res.clone().text()).toBe(200);
    }

    const bodies = (await Promise.all(responses.map((r) => r.json()))) as CommitResponseBody[];
    const exchangeIds: string[] = [];
    for (let i = 0; i < bodies.length; i++) {
      const body = bodies[i]!;
      expect(body.ok, `buyer ${i} body.ok`).toBe(true);
      const exchangeId = body.x402b?.exchangeId;
      expect(typeof exchangeId, `buyer ${i} exchangeId type`).toBe("string");
      exchangeIds.push(exchangeId!);

      const decoded = readXPaymentResponse(responses[i]!.headers);
      expect(decoded, `buyer ${i} X-PAYMENT-RESPONSE`).not.toBeNull();
      expect(decoded?.exchangeId).toBe(exchangeId);
      expect(decoded?.txHash).toMatch(/^0x[0-9a-fA-F]+$/);
    }

    // Each request gets a freshly-signed FullOffer template (random
    // meta-tx nonce → unique predicted offerId), so collisions
    // would surface here as duplicate exchange ids.
    expect(new Set(exchangeIds).size).toBe(CONCURRENT_BUYERS);

    // On-chain state — all 20 should land in REDEEMED (atomic flow).
    // The asserter's `withPollUntilFound` wrapper absorbs the
    // subgraph indexer's 1–5 s lag; 20 parallel polls overlap so the
    // wall-clock is dominated by the slowest, not the sum.
    await Promise.all(
      exchangeIds.map((id) =>
        ctx.asserter.expect(id, {
          state: ExchangeState.REDEEMED,
          seller: ctx.seller.address,
          exchangeToken: LOCAL_31337_0.contracts.testErc20,
          price: PER_COMMIT_AMOUNT.toString(),
        }),
      ),
    );
  });
});
