// Vitest `globalSetup` for the e2e scenario suite. Runs once per test
// run (before any worker executes a test file) and tears down once
// after the run completes — gated behind `E2E_DOCKER=1` so default
// `pnpm test` invocations stay fast.
//
// Responsibilities:
//   1. `startStack({ waitForReady: true })` — bring up the canonical
//      Boson stack + x402B services and block until the contracts +
//      subgraph `deploy.done` markers exist.
//   2. `seedSuite({ createSeller: buildCreateSellerCallback(...) })` —
//      register the seller entity tied to `ROLE_ACCOUNTS.seller`.
//      Idempotent: re-runs are no-ops because the subgraph already
//      reports an existing seller for that assistant.
//   3. Export the seeded state (seller id, dispute resolver id) via
//      `process.env` so each test file's `beforeAll` can read it
//      without re-querying the subgraph.
//
// Test files MUST also call `describe.skipIf(!process.env.E2E_DOCKER)`
// or equivalent so they skip cleanly when the gate is off.

import { privateKeyToAccount } from "viem/accounts";

import { ROLE_ACCOUNTS } from "../../src/config/accounts.js";
import {
  buildCreateSellerCallback,
  buildPublicClient,
  buildWalletClient,
  seedSuite,
} from "../../src/harness/index.js";
import { startStack, stopStack } from "../../src/stack/index.js";

/** Env-var keys the scenario tests read from `process.env`. */
export const SUITE_STATE_ENV = {
  sellerId: "X402_E2E_SELLER_ID",
  sellerAddress: "X402_E2E_SELLER_ADDRESS",
  disputeResolverId: "X402_E2E_DISPUTE_RESOLVER_ID",
} as const;

const ENABLED = process.env.E2E_DOCKER === "1";

export default async function globalSetup(): Promise<() => Promise<void>> {
  if (!ENABLED) {
    // Gate off — return a no-op teardown so vitest is happy.
    return async () => {
      /* no-op */
    };
  }

  console.log("[x402-e2e/globalSetup] starting stack…");
  await startStack({ waitForReady: true });

  try {
    const sellerAccount = privateKeyToAccount(ROLE_ACCOUNTS.seller.privateKey);
    const publicClient = buildPublicClient();
    const walletClient = buildWalletClient(sellerAccount);

    console.log(`[x402-e2e/globalSetup] seeding seller ${sellerAccount.address}…`);
    const suite = await seedSuite({
      sellerAddress: sellerAccount.address,
      createSeller: buildCreateSellerCallback({ walletClient, publicClient }),
    });

    process.env[SUITE_STATE_ENV.sellerId] = suite.seller.id;
    process.env[SUITE_STATE_ENV.sellerAddress] = suite.seller.assistant;
    process.env[SUITE_STATE_ENV.disputeResolverId] = suite.disputeResolverId;

    console.log(
      `[x402-e2e/globalSetup] suite ready — sellerId=${suite.seller.id}, disputeResolverId=${suite.disputeResolverId}`,
    );
  } catch (err) {
    console.error("[x402-e2e/globalSetup] post-start setup failed, tearing down stack…");
    await stopStack();
    throw err;
  }

  return async () => {
    console.log("[x402-e2e/globalSetup] tearing down stack…");
    await stopStack();
  };
}
