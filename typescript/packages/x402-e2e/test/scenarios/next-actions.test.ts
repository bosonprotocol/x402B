// nextActions / channel routing — section D of the e2e plan.
//
//   - D1  after commit, `nextActions[]` lists exactly the legal
//         post-COMMITTED client transitions                       @p0
//   - D2  after redeem, `nextActions[]` shrinks to the legal
//         post-REDEEMED client transitions                        @p0
//
// Both assert the envelope the buyer receives *on the wire* matches the
// protocol's `clientLegalActions(state)` table (the same source
// `deriveNextActions` reads). The plan phrases this as "tested against
// `ACTION_POST_STATE`", but that table maps an action to its resulting
// state; the set of actions legal *from* a state is `clientLegalActions`
// — production wins, so we assert against the table the server actually
// derives from. The point of doing it end-to-end (rather than as a unit
// test of `deriveNextActions`) is to confirm the live server stamps the
// correct state and emits the matching action set across the HTTP hop —
// the commit envelope rides the `X-PAYMENT-RESPONSE` header, the redeem
// envelope rides the `/x402B/redeem` response body.

import { ExchangeState } from "@bosonprotocol/x402-actions";
import type { EscrowNextActions } from "@bosonprotocol/x402-core/schemes/escrow";
import { clientLegalActions } from "@bosonprotocol/x402-core/state-machine";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { LOCAL_31337_0 } from "../../src/config/local-31337-0.js";
import {
  buildPublicClient,
  buildWalletClient,
  performBuyerPostCommitAction,
  readXPaymentResponse,
} from "../../src/harness/index.js";

import { createFundedBuyer, ensureBuyerCanPay } from "./_buyer-setup.js";
import { ENABLED } from "./_flags.js";
import { SEED_WALLETS } from "./_seed-wallets.js";
import { createScenarioContext, NONE_TOKEN_AUTH_SCENARIO, type ScenarioContext } from "./_setup.js";

/** Stable order for set-equality assertions on action-id lists. */
const sortedIds = (ids: readonly string[]): string[] => [...ids].sort();

describe.skipIf(!ENABLED)("@p0 nextActions derivation", () => {
  let ctx: ScenarioContext;

  beforeAll(async () => {
    const publicClient = buildPublicClient();
    const funder = buildWalletClient(SEED_WALLETS.nextActions.account);
    const buyerAccount = await createFundedBuyer({ funder, publicClient, fundEth: "2" });
    ctx = await createScenarioContext({
      slot: "nextActions",
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

  it("D1 — post-commit nextActions[] == clientLegalActions(COMMITTED)", async () => {
    const res = await ctx.buyer.fetch(`${ctx.resourceServerUrl}/resource`);
    expect(res.status, await res.clone().text()).toBe(200);

    const decoded = readXPaymentResponse(res.headers);
    expect(decoded, "X-PAYMENT-RESPONSE header should decode").not.toBeNull();
    // The commit envelope reports the new exchange state and the legal
    // transitions out of it. `exchangeState` is the string enum value.
    expect(decoded?.nextActions?.exchangeState).toBe(ExchangeState.COMMITTED);

    const emitted =
      decoded?.nextActions?.next?.map((entry) => {
        expect(typeof entry?.id, "next[] entry missing id").toBe("string");
        return entry.id;
      }) ?? [];
    expect(sortedIds(emitted)).toEqual(
      sortedIds(clientLegalActions({ exchange: ExchangeState.COMMITTED })),
    );
  });

  it("D2 — post-redeem nextActions[] shrinks to clientLegalActions(REDEEMED)", async () => {
    // Commit a fresh exchange, then redeem it and assert the response's
    // envelope advertises exactly the post-REDEEMED transitions
    // (`completeExchange`, `raiseDispute`) — i.e. `redeem` /
    // `cancelVoucher` have dropped off now the voucher is redeemed.
    const commitRes = await ctx.buyer.fetch(`${ctx.resourceServerUrl}/resource`);
    expect(commitRes.status, await commitRes.clone().text()).toBe(200);
    const exchangeId = ((await commitRes.json()) as { x402b?: { exchangeId?: string } }).x402b
      ?.exchangeId;
    if (typeof exchangeId !== "string") {
      throw new Error(
        `Expected commit response x402b.exchangeId to be a string, got ${typeof exchangeId}`,
      );
    }

    const redeemed = await performBuyerPostCommitAction({
      actionId: "boson-redeem",
      buyer: ctx.buyer,
      resourceServerUrl: ctx.resourceServerUrl,
      exchangeId,
      escrowAddress: ctx.escrowAddress,
      network: ctx.network,
    });
    expect(redeemed.newExchangeState).toBe(ExchangeState.REDEEMED);

    expect(sortedIds(redeemed.nextActionIds)).toEqual(
      sortedIds(clientLegalActions({ exchange: ExchangeState.REDEEMED })),
    );
  });

  it("D3 — submitAction falls back from server to facilitator on a dead server endpoint", async () => {
    // Doubles as the canonical example of `client.submitAction` usage:
    // commit, read the post-commit envelope, hand the
    // `boson-redeem` entry back to `submitAction` for a transparent
    // channel walk. We patch `endpoints.server` to a closed port
    // (`http://127.0.0.1:1` → connect-refused → `ChannelFailureReason
    // "network"`) while leaving the server-stamped
    // `endpoints.facilitator` URL intact — so the walk fails on
    // server, then succeeds on facilitator.
    const commitRes = await ctx.buyer.fetch(`${ctx.resourceServerUrl}/resource`);
    expect(commitRes.status, await commitRes.clone().text()).toBe(200);
    const exchangeId = ((await commitRes.json()) as { x402b?: { exchangeId?: string } }).x402b
      ?.exchangeId;
    if (typeof exchangeId !== "string") {
      throw new Error(
        `Expected commit response x402b.exchangeId to be a string, got ${typeof exchangeId}`,
      );
    }

    const decoded = readXPaymentResponse(commitRes.headers);
    const original = decoded?.nextActions?.next?.find((entry) => entry.id === "boson-redeem");
    expect(original, "post-COMMITTED envelope must advertise boson-redeem").toBeDefined();

    const priorNextActions = {
      ...decoded!.nextActions!,
      next: decoded!.nextActions!.next!.map((entry) =>
        entry.id === "boson-redeem"
          ? {
              ...entry,
              endpoints: { ...(entry.endpoints ?? {}), server: "http://127.0.0.1:1" },
            }
          : entry,
      ),
    } as unknown as EscrowNextActions;

    const result = await ctx.buyer.client.submitAction({
      actionId: "boson-redeem",
      exchangeId,
      network: ctx.network,
      escrowAddress: ctx.escrowAddress,
      priorNextActions,
    });

    expect(result.channelUsed).toBe("facilitator");
    expect(result.newExchangeState).toBe(ExchangeState.REDEEMED);
    const firstAttempt = result.attempts[0];
    expect(firstAttempt?.channel).toBe("server");
    expect(firstAttempt?.ok).toBe(false);
    if (firstAttempt !== undefined && !firstAttempt.ok) {
      expect(firstAttempt.reason).toBe("network");
    }
  });
});
