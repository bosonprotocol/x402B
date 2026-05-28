// Commit-time fulfillment scenarios — section A (delivery channels) of
// the e2e plan.
//
//   - A6  commit with `webhook` fulfillment → the buyer's webhook
//         endpoint receives the delivery with the right exchangeId   @p1
//
// A7 (`ipfs-pointer`) lands in a follow-up; A8 (`mcp`) stays skipped
// until `@bosonprotocol/x402-agent` exists.
//
// Wiring under test (end-to-end across the real HTTP hops):
//   1. The in-process resource server advertises the `webhook` option
//      in its 402 (`createResourceServerApp({ fulfillmentChannels })`,
//      added in the example-server fulfillment-channels change).
//   2. The buyer commits (Flow A, deferred) then redeems with
//      `fulfillment: { option: "webhook", data: { url } }`.
//   3. After the on-chain redeem confirms REDEEMED, the server invokes
//      the channel's `onFulfill` (the delivery-trigger added to
//      `@bosonprotocol/x402-server`), whose `send` hook POSTs to the
//      buyer's `url`, and surfaces `{ kind: "async", pointer: url }` on
//      the redeem response.
//
// The `webhook` channel requires an `https://` callback URL, so the
// buyer points at a self-signed TLS webhook-sink started in-process via
// `startWebhookSink({ tls: true })`. The server-side `send` hook opts
// out of cert verification (`rejectUnauthorized: false`) — fine for a
// local self-signed test sink.
//
// Gated behind `E2E_DOCKER=1`.

import https from "node:https";

import { ExchangeState } from "@bosonprotocol/x402-actions";
import {
  startWebhookSink,
  type RunningWebhookSink,
} from "@bosonprotocol/x402-example-webhook-sink";
import { createWebhookChannel } from "@bosonprotocol/x402-fulfillment/channels/webhook";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { LOCAL_31337_0 } from "../../src/config/local-31337-0.js";
import {
  buildPublicClient,
  buildWalletClient,
  performBuyerPostCommitAction,
} from "../../src/harness/index.js";

import { EXPECTED_PRICE, TX_HASH_REGEX } from "./_assertion-constants.js";
import { createFundedBuyer, ensureBuyerCanPay } from "./_buyer-setup.js";
import { ENABLED } from "./_flags.js";
import { SEED_WALLETS } from "./_seed-wallets.js";
import { createScenarioContext, NONE_TOKEN_AUTH_SCENARIO, type ScenarioContext } from "./_setup.js";

/**
 * POST JSON to a self-signed HTTPS endpoint, skipping cert verification.
 * Used as the `webhook` channel's `send` hook so delivery can reach the
 * local TLS sink. Resolves once the sink has responded.
 */
function postJsonOverSelfSignedTls(url: string, body: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const target = new URL(url);
    const requestOptions: https.RequestOptions = {
      hostname: target.hostname,
      path: `${target.pathname}${target.search}`,
      method: "POST",
      rejectUnauthorized: false,
      headers: {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(payload),
      },
    };

    if (target.port !== "") {
      requestOptions.port = target.port;
    }

    const req = https.request(requestOptions, (res) => {
      res.resume();
      res.once("error", reject);
      res.once("end", () => {
        const status = res.statusCode ?? 0;
        if (status >= 200 && status < 300) {
          resolve();
        } else {
          reject(new Error(`webhook sink responded with status ${status}`));
        }
      });
    });
    req.once("error", reject);
    req.write(payload);
    req.end();
  });
}

describe.skipIf(!ENABLED)("@p1 commit-time fulfillment — webhook (A6)", () => {
  let ctx: ScenarioContext;
  let sink: RunningWebhookSink;
  let hookUrl: string;

  beforeAll(async () => {
    const publicClient = buildPublicClient();
    const funder = buildWalletClient(SEED_WALLETS.fulfillment.account);
    const buyerAccount = await createFundedBuyer({ funder, publicClient, fundEth: "2" });

    // The buyer's webhook endpoint: a self-signed TLS sink in-process so
    // the channel's `https://`-only URL check is satisfied.
    sink = await startWebhookSink({ tls: true });
    hookUrl = `${sink.url}/hook`;

    // The channel's `send` hook is what actually delivers — POST a small
    // envelope carrying the exchangeId to the buyer's `data.url`.
    const webhook = createWebhookChannel({
      send: async (exchangeId, data) => {
        await postJsonOverSelfSignedTls(data.url, { exchangeId });
      },
    });

    ctx = await createScenarioContext({
      slot: "fulfillment",
      buyerAccount,
      ...NONE_TOKEN_AUTH_SCENARIO,
      fulfillmentChannels: [webhook],
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
    await sink?.close();
  });

  it("A6 — redeem with `webhook` fulfillment delivers the exchangeId to the buyer's endpoint", async () => {
    // Commit (Flow A, deferred). The 402 advertised the webhook option,
    // so the server stored it as the redeem-time allowed set.
    const commitRes = await ctx.buyer.fetch(`${ctx.resourceServerUrl}/resource`);
    expect(commitRes.status, await commitRes.clone().text()).toBe(200);
    const exchangeId = ((await commitRes.json()) as { x402b?: { exchangeId?: string } }).x402b
      ?.exchangeId;
    expect(typeof exchangeId).toBe("string");

    // Redeem carrying the webhook delivery target. The server persists
    // it, dispatches `onFulfill` (→ our `send` hook POSTs to the sink),
    // and echoes the async pointer.
    const redeemed = await performBuyerPostCommitAction({
      actionId: "boson-redeem",
      buyer: ctx.buyer,
      resourceServerUrl: ctx.resourceServerUrl,
      exchangeId: exchangeId!,
      escrowAddress: ctx.escrowAddress,
      network: ctx.network,
      fulfillment: { option: "webhook", data: { url: hookUrl } },
    });
    expect(redeemed.txHash).toMatch(TX_HASH_REGEX);
    expect(redeemed.newExchangeState).toBe(ExchangeState.REDEEMED);
    expect(redeemed.fulfillment).toEqual({ kind: "async", pointer: hookUrl });

    // The delivery POST is awaited inside the redeem handler, so by the
    // time the redeem returns the sink has already recorded it.
    const { sink: webhookSink } = sink;
    expect(webhookSink.snapshot()).toContainEqual({ exchangeId });

    await ctx.asserter.expect(exchangeId!, {
      state: ExchangeState.REDEEMED,
      seller: ctx.seller.address,
      exchangeToken: LOCAL_31337_0.contracts.testErc20,
      price: EXPECTED_PRICE,
    });
  });
});
