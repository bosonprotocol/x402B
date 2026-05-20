// Vitest `globalSetup` for the e2e scenario suite. Runs once per test
// run (before any worker executes a test file) and tears down once
// after the run completes — gated behind `E2E_DOCKER=1` so default
// `pnpm test` invocations stay fast.
//
// Responsibilities:
//   1. `startStack({ waitForReady: true })` — bring up the canonical
//      Boson stack + x402B services and block until the contracts +
//      subgraph `deploy.done` markers exist.
//   2. Register one Boson seller entity per slot in `SEED_WALLETS`.
//      Each chain-touching test FILE picks a slot — sharing a seller
//      across parallel files causes `OfferSoldOut` races on FullOffer
//      signature reuse, so we provision a distinct seller for every
//      slot the suite knows about. `seedSuite` is idempotent so
//      re-running on an existing chain state is a no-op.
//   3. Export per-slot seller info (`{id, address}`) as a JSON map
//      via `process.env[SELLERS_ENV_KEY]`, plus the protocol-global
//      dispute resolver id, so each test file's `beforeAll` can read
//      its slot's seller without re-querying the subgraph.

import type { Address } from "viem";

import {
  buildCreateSellerCallback,
  buildPublicClient,
  buildWalletClient,
  seedSuite,
} from "../../src/harness/index.js";
import { startStack, stopStack } from "../../src/stack/index.js";

import {
  SEED_WALLETS,
  SELLERS_ENV_KEY,
  type SeedWalletSellerInfo,
} from "../scenarios/_seed-wallets.js";

/** Env-var keys the scenario tests read from `process.env`. */
export const SUITE_STATE_ENV = {
  /** JSON map `{ slotName → { id, address } }` — populated by this setup. */
  sellers: SELLERS_ENV_KEY,
  /** Protocol-global dispute resolver id (shared across all sellers). */
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

  // Defensive `down -v` before `up`: a previous run aborted before its
  // teardown (Ctrl+C, vitest crash, OS shutdown) leaves containers up
  // but with stale in-process state — most notably the facilitator's
  // viem `nonceManager`, which caches the relayer's next-nonce in
  // memory. Once the chain is redeployed (deploy.done re-runs on
  // volume reset), the chain expects nonce 0 while the lingering
  // facilitator process still thinks it's at N+1 → "Nonce too high"
  // on every meta-tx submit. Tearing the stack down here guarantees
  // every test run starts from genesis: fresh containers, fresh
  // in-memory state, fresh chain. The cost is a few extra seconds at
  // suite startup; the win is determinism.
  console.log("[x402-e2e/globalSetup] resetting any leftover stack…");
  try {
    await stopStack();
  } catch (e) {
    console.warn("[x402-e2e/globalSetup] stopStack() before startStack failed — continuing:", e);
  }

  console.log("[x402-e2e/globalSetup] starting stack…");
  await startStack({ waitForReady: true });

  try {
    const publicClient = buildPublicClient();
    const sellersBySlot: Record<string, SeedWalletSellerInfo> = {};
    let disputeResolverId: string | undefined;

    for (const [slotName, slot] of Object.entries(SEED_WALLETS)) {
      const walletClient = buildWalletClient(slot.account);
      console.log(
        `[x402-e2e/globalSetup] seeding seller for slot "${slotName}" (${slot.account.address})…`,
      );
      const suite = await seedSuite({
        sellerAddress: slot.account.address,
        createSeller: buildCreateSellerCallback({ walletClient, publicClient }),
      });
      sellersBySlot[slotName] = {
        id: suite.seller.id,
        address: suite.seller.assistant as Address,
      };
      // The dispute resolver is a protocol-global entity (`id: 1` on the
      // local stack); every slot's `seedSuite` returns the same value.
      disputeResolverId = suite.disputeResolverId;
    }

    if (disputeResolverId === undefined) {
      throw new Error("[x402-e2e/globalSetup] no slots registered — SEED_WALLETS is empty?");
    }

    process.env[SUITE_STATE_ENV.sellers] = JSON.stringify(sellersBySlot);
    process.env[SUITE_STATE_ENV.disputeResolverId] = disputeResolverId;

    console.log(
      `[x402-e2e/globalSetup] suite ready — sellers=${JSON.stringify(sellersBySlot)}, disputeResolverId=${disputeResolverId}`,
    );
  } catch (setupErr) {
    console.error("[x402-e2e/globalSetup] post-start setup failed, tearing down stack…");
    try {
      await stopStack();
    } catch (teardownErr) {
      console.error(
        "[x402-e2e/globalSetup] stopStack() failed during teardown after setup error — original setup error will be rethrown:",
        teardownErr,
      );
    }
    throw setupErr;
  }

  return async () => {
    console.log("[x402-e2e/globalSetup] tearing down stack…");
    await stopStack();
  };
}
