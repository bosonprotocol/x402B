// Operational failure-mode scenarios — section F of the e2e plan.
//
// Each scenario starts the suite in a healthy state (globalSetup
// brought every service up) and then injects targeted chaos —
// killing a container mid-flight, pausing the subgraph, or rotating
// the buyer's signing key — to prove the system either recovers
// gracefully or rejects the invalid request with a clear error.
//
// Coverage in this file:
//
//   - F1 — facilitator restart mid-flight                @p1
//   - F2 — subgraph indexer lag                          @p2
//   - F4 — buyer key rotation, redeem rejected           @p2
//
// Deferred to a follow-up PR:
//   - D3 — server/facilitator/onchain channel fallback (feature work
//          on the client; tracked in `_skeletons.test.ts`).
//   - F3 — meta-tx-gateway down during seed (gateway is not on the
//          e2e payment hot path; removed from the suite).
//
// All scenarios gated behind `E2E_DOCKER=1` because they exercise
// the live local stack (containers, subgraph, Diamond, facilitator).
//
// PARALLELISM WARNING: F1 kills the facilitator container and F2
// pauses the subgraph container — both for a few seconds — to
// inject failure. While that chaos is in flight, ANY other test
// FILE that races against this one and tries to use the facilitator
// or the subgraph WILL fail with transient errors. Vitest runs
// test files in parallel by default; the suite-level escape hatch
// is `E2E_SEQUENTIAL=1` (see `vitest.config.ts`), which the
// nightly workflow sets. Local full-suite runs that omit
// `E2E_SEQUENTIAL=1` will see sporadic failures in `commit.test.ts`
// / `post-commit.test.ts` / `concurrent.test.ts` for the same
// reason — that's a config issue, not a test bug.

import { ExchangeState } from "@bosonprotocol/x402-actions";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { LOCAL_31337_0 } from "../../src/config/local-31337-0.js";
import {
  buildPublicClient,
  buildWalletClient,
  createBuyerActor,
  performBuyerPostCommitAction,
  PostCommitActionError,
} from "../../src/harness/index.js";
import { killService, pauseService, startService, unpauseService } from "../../src/stack/index.js";

import { EXPECTED_PRICE } from "./_assertion-constants.js";
import { createFundedBuyer, ensureBuyerCanPay, rotateBuyer } from "./_buyer-setup.js";
import { ENABLED } from "./_flags.js";
import { SEED_WALLETS } from "./_seed-wallets.js";
import { createScenarioContext, type ScenarioContext } from "./_setup.js";

const FACILITATOR_SERVICE = "x402b-facilitator-http";
const SUBGRAPH_SERVICE = "boson-subgraph";

/** Drive a fresh commit through the in-process resource server and return the new `exchangeId`. */
async function commitFreshExchange(ctx: ScenarioContext): Promise<string> {
  const res = await ctx.buyer.fetch(`${ctx.resourceServerUrl}/resource`);
  if (res.status !== 200) {
    throw new Error(
      `[operational.test] failed to commit a fresh exchange: HTTP ${res.status} ${await res.text()}`,
    );
  }
  const body = (await res.json()) as { x402b?: { exchangeId?: string } };
  const exchangeId = body.x402b?.exchangeId;
  if (typeof exchangeId !== "string" || exchangeId.length === 0) {
    throw new Error(
      `[operational.test] commit response missing exchangeId: ${JSON.stringify(body)}`,
    );
  }
  return exchangeId;
}

/**
 * Poll `<facilitatorUrl>/health` until it returns 200 or `budgetMs` elapses.
 * Used after `startService` because docker reports the container started
 * as soon as PID 1 forks — the HTTP listener inside the container only
 * binds a moment later.
 */
async function waitForFacilitatorReady(facilitatorUrl: string, budgetMs = 30_000): Promise<void> {
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${facilitatorUrl}/health`);
      if (res.ok) return;
    } catch {
      // ECONNREFUSED while the listener spins up — fall through to retry.
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(
    `[operational.test] facilitator at ${facilitatorUrl} did not become ready within ${budgetMs} ms`,
  );
}

describe.skipIf(!ENABLED)("@p1 operational scenarios", () => {
  let ctx: ScenarioContext;

  beforeAll(async () => {
    const publicClient = buildPublicClient();
    const funder = buildWalletClient(SEED_WALLETS.operational.account);
    const buyerAccount = await createFundedBuyer({ funder, publicClient, fundEth: "2" });
    ctx = await createScenarioContext({ slot: "operational", buyerAccount });
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
    // Belt-and-braces: if the test bailed before its own restart step,
    // bring the facilitator back so the next test file isn't left
    // staring at a dead container.
    try {
      await startService(FACILITATOR_SERVICE);
      await waitForFacilitatorReady(ctx.facilitatorUrl);
    } catch {
      // Container may already be running — `start` on a healthy
      // service is a no-op, but on Docker for Windows it occasionally
      // errors with "container already started". Swallow.
    }
    await ctx?.teardown();
  });

  it("F1 — facilitator restart mid-flight → system recovers", async () => {
    // Strategy:
    //   1. Fire a commit fetch without awaiting.
    //   2. After 150 ms (long enough for the request to reach the
    //      facilitator but short enough that settle hasn't returned),
    //      SIGKILL the facilitator container.
    //   3. Start it back up and wait for /health to be reachable.
    //   4. Resolve the original commit promise. Accept EITHER outcome:
    //      the request returned 200 (settle landed before the kill, or
    //      after restart on the client's retry) OR it threw / 5xx'd.
    //   5. Issue a SECOND commit AFTER the restart and assert it
    //      commits cleanly — this is the real proof that the facilitator
    //      recovered (in-memory state, nonce manager, viem connection
    //      pool, …).
    //
    // Limitation: the x402-client-fetch wrapper retries 402 once but
    // does not iterate channels on facilitator-side failures (D3 is the
    // feature work that would add that). So the "exactly one commit"
    // invariant only holds if the original fetch fails; if it
    // succeeds, the on-chain commit either landed before the kill or
    // not at all. The follow-up commit is the load-bearing assertion.
    const commitPromise = ctx.buyer.fetch(`${ctx.resourceServerUrl}/resource`);
    await new Promise((r) => setTimeout(r, 150));
    await killService(FACILITATOR_SERVICE, { signal: "SIGKILL" });
    await startService(FACILITATOR_SERVICE);
    await waitForFacilitatorReady(ctx.facilitatorUrl);

    // Drain the original commit — its outcome is best-effort.
    let originalExchangeId: string | null = null;
    try {
      const res = await commitPromise;
      if (res.ok) {
        const body = (await res.json()) as { x402b?: { exchangeId?: string } };
        originalExchangeId =
          typeof body.x402b?.exchangeId === "string" ? body.x402b.exchangeId : null;
      }
    } catch {
      // Expected when the kill aborted the in-flight request.
    }

    // Follow-up commit — proves the facilitator recovered.
    const followUpExchangeId = await commitFreshExchange(ctx);
    expect(followUpExchangeId).toMatch(/^\d+$/);
    await ctx.asserter.expect(followUpExchangeId, {
      state: ExchangeState.COMMITTED,
      seller: ctx.seller.address,
      exchangeToken: LOCAL_31337_0.contracts.testErc20,
      price: EXPECTED_PRICE,
    });

    // If the original commit DID return success, the resulting exchange
    // must also be a real on-chain COMMITTED state — not a stale
    // pre-kill cached response. The two ids must be distinct (each
    // commit signs a fresh FullOffer template, so they're different
    // offers / exchanges).
    if (originalExchangeId !== null) {
      expect(originalExchangeId).not.toBe(followUpExchangeId);
      await ctx.asserter.expect(originalExchangeId, {
        state: ExchangeState.COMMITTED,
        seller: ctx.seller.address,
        exchangeToken: LOCAL_31337_0.contracts.testErc20,
        price: EXPECTED_PRICE,
      });
    }
  });
});

describe.skipIf(!ENABLED)("@p2 operational scenarios", () => {
  let ctx: ScenarioContext;

  beforeAll(async () => {
    const publicClient = buildPublicClient();
    const funder = buildWalletClient(SEED_WALLETS.operational.account);
    const buyerAccount = await createFundedBuyer({ funder, publicClient, fundEth: "2" });
    ctx = await createScenarioContext({ slot: "operational", buyerAccount });
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

  // F2 pauses the subgraph mid-test. If the test fails before its own
  // `unpauseService`, the subgraph stays frozen for the rest of the
  // suite. This belt-and-braces hook keeps the rest of the test file
  // (and subsequent files) honest.
  afterEach(async () => {
    try {
      await unpauseService(SUBGRAPH_SERVICE);
    } catch {
      // Already running / not paused — no-op.
    }
  });

  it("F2 — subgraph indexer lag → reader recovers via waitForGraphNodeIndexing", async () => {
    // Strategy:
    //   1. Pause `boson-subgraph` so its indexer stops ingesting blocks.
    //   2. Schedule an unpause after ~3 s.
    //   3. Fire a commit. The chain mines on the 50 ms interval-mining
    //      schedule globalSetup configured, so the commit tx lands
    //      on-chain quickly. The server's exchange reader then calls
    //      `coreSdk.waitForGraphNodeIndexing(chainHead)` which blocks
    //      until the subgraph catches up — which won't happen until
    //      we unpause.
    //   4. Once the subgraph unpauses and catches up, the read
    //      resolves, the resource server returns 200, and we assert
    //      the on-chain state via the asserter.
    //
    // What this proves: the indexer-aware reader (`exchange-reader.ts`)
    // does not collapse to `STATE_VERIFY_EXCHANGE_NOT_FOUND` when the
    // subgraph happens to be behind the chain head at read time.
    await pauseService(SUBGRAPH_SERVICE);
    const unpauseAt = setTimeout(() => {
      unpauseService(SUBGRAPH_SERVICE).catch(() => {
        // Logged-but-ignored: a unit-test framework can't gracefully
        // handle a background timer failure; the afterEach hook above
        // will retry the unpause as a safety net.
      });
    }, 3_000);
    try {
      const exchangeId = await commitFreshExchange(ctx);
      expect(exchangeId).toMatch(/^\d+$/);
      await ctx.asserter.expect(exchangeId, {
        state: ExchangeState.COMMITTED,
        seller: ctx.seller.address,
        exchangeToken: LOCAL_31337_0.contracts.testErc20,
        price: EXPECTED_PRICE,
      });
    } finally {
      clearTimeout(unpauseAt);
      await unpauseService(SUBGRAPH_SERVICE).catch(() => {
        /* afterEach will retry */
      });
    }
  });

  it("F4 — buyer key rotation → redeem rejected", async () => {
    // Strategy:
    //   1. Commit a fresh exchange from the describe's ctx.buyer
    //      (signed by buyer-key A).
    //   2. Mint + fund + approve a fresh EOA — buyer-key B — via
    //      `rotateBuyer`.
    //   3. Build a BuyerActor on key B and attempt `boson-redeem`
    //      against the exchange owned by key A.
    //   4. Expect a `PostCommitActionError` with a body that names
    //      the rejection. The voucher is an ERC-721 minted to buyer
    //      A; the protocol's `redeemVoucher` checks the on-chain
    //      voucher owner against the meta-tx signer, so the
    //      facilitator's pre-flight `simulate` step reverts with
    //      "NOT_VOUCHER_HOLDER" (or equivalent), surfacing as
    //      `FACILITATOR_REJECTED` with `facilitatorCode:
    //      "SIMULATION_REVERT"` on the server side.
    //
    // Important: the facilitator's signature recovery itself passes
    // (recovered signer = key B = metaTx.from). The rejection layer
    // is the ON-CHAIN simulation, NOT a meta-tx signature mismatch.
    // The test stays loose on the exact code so future tightening
    // of the simulate step (e.g. structured revert classification)
    // doesn't break this assertion — the proof of correctness is
    // that the redeem is rejected and the on-chain voucher state
    // stays COMMITTED.
    const exchangeId = await commitFreshExchange(ctx);
    await ctx.asserter.expect(exchangeId, {
      state: ExchangeState.COMMITTED,
      seller: ctx.seller.address,
      exchangeToken: LOCAL_31337_0.contracts.testErc20,
      price: EXPECTED_PRICE,
    });

    const publicClient = buildPublicClient();
    const rotatedAccount = await rotateBuyer({
      funder: buildWalletClient(SEED_WALLETS.operational.account),
      publicClient,
      assetAddress: LOCAL_31337_0.contracts.testErc20,
      escrowAddress: LOCAL_31337_0.contracts.protocolDiamond,
      amount: 10_000_000n,
      fundEth: "0.5",
    });
    const wrongBuyer = createBuyerActor({ account: rotatedAccount, publicClient });

    // Capture the rejection from a single invocation so we can inspect
    // status / body on the same error instance. Avoid the
    // `expect(...).rejects` + replay pattern: it doubles runtime and
    // assumes the call is perfectly deterministic across retries.
    let caught: unknown = null;
    try {
      await performBuyerPostCommitAction({
        actionId: "boson-redeem",
        buyer: wrongBuyer,
        resourceServerUrl: ctx.resourceServerUrl,
        exchangeId,
        escrowAddress: ctx.escrowAddress,
        network: ctx.network,
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(PostCommitActionError);
    const err = caught as PostCommitActionError;
    expect(err.status).toBe(502);
    const body = err.body as { code?: string; reason?: string; details?: unknown } | undefined;
    expect(body?.code).toBe("FACILITATOR_REJECTED");
    // The redeem MUST be rejected — that's the load-bearing assertion.
    // The specific facilitator-side code reflects which classification
    // path the revert took inside `facilitator/src/verify/simulate.ts`:
    //   - `SIMULATION_REVERT` when viem's error chain exposes a
    //     `RawContractError` / `ContractFunctionRevertedError`,
    //   - `ONCHAIN_REVERT` when the tx was submitted and reverted,
    //   - `BAD_META_TX_SIGNATURE` when sig recovery / sig-vs-from
    //     check fails (the meta-tx itself is self-consistent here so
    //     this path shouldn't fire, but we accept it for robustness),
    //   - `INTERNAL_ERROR` when the revert happens but viem returns a
    //     transport-layer wrapper that `isOnChainRevert` doesn't
    //     classify — observed locally on Hardhat 31337 where the
    //     revert reason surface differs from production EVM clients.
    // Future tightening of the simulate step's revert classification
    // would push the local F4 path into `SIMULATION_REVERT`; the test
    // stays loose so that improvement doesn't break this assertion.
    const facilitatorCode = (body?.details as { facilitatorCode?: string })?.facilitatorCode;
    expect(facilitatorCode).toMatch(
      /SIMULATION_REVERT|ONCHAIN_REVERT|BAD_META_TX_SIGNATURE|INTERNAL_ERROR/,
    );

    // On-chain voucher state must NOT have transitioned — exchange
    // stays COMMITTED, since the rejection happened before settle.
    await ctx.asserter.expect(exchangeId, {
      state: ExchangeState.COMMITTED,
      seller: ctx.seller.address,
      exchangeToken: LOCAL_31337_0.contracts.testErc20,
      price: EXPECTED_PRICE,
    });
  });
});
