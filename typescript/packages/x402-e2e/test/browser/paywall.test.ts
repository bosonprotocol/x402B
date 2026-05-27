// Browser-mode E2E scenarios driving @bosonprotocol/x402-client-browser
// and @bosonprotocol/x402-paywall end-to-end through headless chromium.
//
// All three scenarios live in one file (one describe → one seed-wallet
// slot → sequential `it` blocks within the file) so they share the
// resource-server's `FALLBACK_KEY` session slot safely. The paywall
// doesn't stamp `X-Session-Id` today; sequencing avoids the race that
// concurrent browser flows would otherwise trigger.
//
// Tag: `@p0`. Runs on every PR alongside the node scenarios; the
// `describe.skipIf` keeps it a no-op when `E2E_DOCKER` isn't set.

import { ExchangeState } from "@bosonprotocol/x402-actions";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
import { parseEther, type Hex, type PublicClient } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import { LOCAL_31337_0 } from "../../src/config/local-31337-0.js";
import {
  buildPublicClient,
  buildWalletClient,
  readXPaymentResponse,
} from "../../src/harness/index.js";
import { ensureBuyerCanPay } from "../scenarios/_buyer-setup.js";
import { SEED_WALLETS } from "../scenarios/_seed-wallets.js";
import { createScenarioContext, type ScenarioContext } from "../scenarios/_setup.js";

import { installMockWallet } from "./_mock-wallet.js";

const ENABLED = process.env.E2E_DOCKER === "1";
const SLOT = "browser" as const;
const EXPECTED_PRICE = "1000000";
const EXPECTED_PRICE_BIGINT = BigInt(EXPECTED_PRICE);
const NO_COMMIT_POLL_MS = 2_000;

let browser: Browser;
let scenarioCtx: ScenarioContext;
let buyerPk: Hex;
let buyerAddress: `0x${string}`;
let resourceUrl: string;

describe.skipIf(!ENABLED)("@p0 browser-paywall scenarios", () => {
  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });

    // Per-file buyer EOA — generated locally rather than via
    // `createFundedBuyer` so we keep the private key (the existing
    // harness helper drops it on the floor since node scenarios don't
    // need it).
    buyerPk = generatePrivateKey();
    const buyerAccount = privateKeyToAccount(buyerPk);
    buyerAddress = buyerAccount.address;

    const publicClient = buildPublicClient();
    const funder = buildWalletClient(SEED_WALLETS[SLOT].account);
    if (funder.account === undefined || funder.chain === undefined) {
      throw new Error("[browser/paywall] funder WalletClient missing account/chain");
    }
    const fundHash = await funder.sendTransaction({
      account: funder.account,
      chain: funder.chain,
      to: buyerAccount.address,
      value: parseEther("0.5"),
    });
    await publicClient.waitForTransactionReceipt({ hash: fundHash });
    // The browser paywall builds its own x402b client without a buyer
    // policy, so it falls through to its default `permit2` strategy.
    // Permit2 pulls funds through the canonical Permit2 contract, so the
    // buyer approves THAT (not the protocol Diamond) on the ERC-20 — the
    // signed SignatureTransfer names the escrow as recipient at settle
    // time. Pin `permit2` server-side too so the advertised strategy and
    // the buyer's allowance can't drift apart.
    await ensureBuyerCanPay({
      walletClient: buildWalletClient(buyerAccount),
      publicClient,
      buyerAddress,
      assetAddress: LOCAL_31337_0.contracts.testErc20,
      spenderAddress: LOCAL_31337_0.contracts.permit2,
      amount: EXPECTED_PRICE_BIGINT * 10n,
    });

    scenarioCtx = await createScenarioContext({
      slot: SLOT,
      buyerAccount,
      tokenAuthStrategies: ["permit2"],
      // Permit2's SignatureTransfer `deadline` is checked against
      // `block.timestamp`; stretch the window to the protocol max so a
      // long parallel run's chain-time drift can't expire it (same
      // reason as the node permit2 scenario A5).
      maxTimeoutSeconds: 24 * 60 * 60,
    });
    resourceUrl = `${scenarioCtx.resourceServerUrl}/resource`;
  }, 180_000);

  afterAll(async () => {
    if (scenarioCtx !== undefined) await scenarioCtx.teardown();
    if (browser !== undefined) await browser.close();
  });

  it("BR1 — @p0 paywall HTML 402 → connect → sign → on-chain commit", async () => {
    const context = await browser.newContext();
    try {
      await installMockWallet(context, {
        privateKey: buyerPk,
        chainId: LOCAL_31337_0.chainId,
        mode: "normal",
      });

      const page = await context.newPage();

      // `waitForResponse` captures the paywall's X-PAYMENT retry —
      // distinct from the initial navigation by the presence of the
      // `x-payment` request header. Registered BEFORE `goto` so we
      // never miss the response if the paywall fires the retry
      // before the test reaches the `await` below.
      const paymentResponse = page.waitForResponse(
        (response) => {
          if (response.url() !== resourceUrl) return false;
          const headers = response.request().headers();
          return headers["x-payment"] !== undefined;
        },
        { timeout: 90_000 },
      );

      await page.goto(resourceUrl);
      await page.getByTestId("paywall-root").waitFor({ state: "visible" });

      // Mock advertises `isMetaMask: true`, so wagmi's injected
      // connector picks it up as `id: "injected"`.
      await page.getByTestId("paywall-connector-injected").click();
      await page.getByTestId("paywall-wallet-connected").waitFor({ state: "visible" });

      await page.getByTestId("paywall-pay").click();

      const response = await paymentResponse;
      expect(response.status()).toBe(200);

      const decoded = readXPaymentResponse(await response.allHeaders());
      expect(decoded).not.toBeNull();
      expect(decoded!.exchangeId).toBeTruthy();

      await scenarioCtx.asserter.expect(decoded!.exchangeId!, {
        state: ExchangeState.COMMITTED,
        seller: scenarioCtx.suite.sellerAddress,
        exchangeToken: LOCAL_31337_0.contracts.testErc20,
        price: EXPECTED_PRICE,
      });
    } finally {
      await context.close();
    }
  }, 120_000);

  it("BR2 — @p0 user rejects signature → paywall error, no on-chain commit", async () => {
    const context = await browser.newContext();
    try {
      await installMockWallet(context, {
        privateKey: buyerPk,
        chainId: LOCAL_31337_0.chainId,
        mode: "reject-sign",
      });

      const page = await context.newPage();
      await page.goto(resourceUrl);
      await page.getByTestId("paywall-root").waitFor({ state: "visible" });

      await page.getByTestId("paywall-connector-injected").click();
      await page.getByTestId("paywall-wallet-connected").waitFor({ state: "visible" });

      // Snapshot before the pay attempt: this file's scenarios share one
      // buyer, and BR1 legitimately spends, so assert this test caused no
      // spend rather than checking an absolute balance floor.
      const publicClient = buildPublicClient();
      const balanceBefore = await readErc20Balance(publicClient, buyerAddress);

      await page.getByTestId("paywall-pay").click();

      // Paywall surfaces the wallet's rejection in the error panel.
      const errorLocator = page.getByTestId("paywall-error");
      await errorLocator.waitFor({ state: "visible" });
      const errorText = await errorLocator.textContent();
      expect(errorText ?? "").toMatch(/reject/i);

      // A rejected signature must not commit — the protocol never
      // received an X-PAYMENT to settle. Give the subgraph a couple of
      // seconds in case a commit slipped in (it shouldn't), then confirm
      // the buyer's balance is unchanged.
      await sleep(NO_COMMIT_POLL_MS);
      const balanceAfter = await readErc20Balance(publicClient, buyerAddress);
      expect(balanceAfter).toBe(balanceBefore);
    } finally {
      await context.close();
    }
  }, 120_000);

  it("BR3 — @p0 wrong network → paywall surfaces switch-chain warning, no commit", async () => {
    const context = await browser.newContext();
    try {
      await installMockWallet(context, {
        privateKey: buyerPk,
        chainId: 1, // mainnet — deliberately wrong
        mode: "wrong-chain",
      });

      const page = await context.newPage();
      await page.goto(resourceUrl);
      await page.getByTestId("paywall-root").waitFor({ state: "visible" });

      await page.getByTestId("paywall-connector-injected").click();

      // Wagmi surfaces the connected (wrong) chain id; the paywall
      // renders the `paywall-wrong-network` warning.
      await page
        .getByTestId("paywall-wrong-network")
        .waitFor({ state: "visible", timeout: 30_000 });

      const publicClient = buildPublicClient();
      const balanceBefore = await readErc20Balance(publicClient, buyerAddress);

      // Clicking Pay triggers `switchChain`, which the mock rejects;
      // the paywall transitions to the error state.
      await page.getByTestId("paywall-pay").click();
      const errorLocator = page.getByTestId("paywall-error");
      await errorLocator.waitFor({ state: "visible" });
      const errorText = await errorLocator.textContent();
      expect(errorText ?? "").toMatch(/chain|switch|network/i);

      // The rejected network switch must not commit anything.
      await sleep(NO_COMMIT_POLL_MS);
      const balanceAfter = await readErc20Balance(publicClient, buyerAddress);
      expect(balanceAfter).toBe(balanceBefore);
    } finally {
      await context.close();
    }
  }, 120_000);
});

/** Read the buyer's payment-token balance (atomic units). */
async function readErc20Balance(publicClient: PublicClient, owner: `0x${string}`): Promise<bigint> {
  return (await publicClient.readContract({
    address: LOCAL_31337_0.contracts.testErc20,
    abi: ERC20_BALANCE_ABI,
    functionName: "balanceOf",
    args: [owner],
  })) as bigint;
}

const ERC20_BALANCE_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
