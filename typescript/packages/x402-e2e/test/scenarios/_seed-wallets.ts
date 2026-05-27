// Per-FILE seed-wallet slots for the chain-touching scenario suite.
//
// Vitest runs test FILES in parallel by default. Each chain-touching
// test FILE imports exactly one slot below. Two FILES that can run
// concurrently MUST NOT share a slot — sharing causes:
//
//   1. Funding-tx nonce collisions on the slot account (since each
//      describe's `beforeAll` funds a fresh random buyer EOA), and
//   2. `OfferSoldOut` reverts inside `createOfferAndCommit`: parallel
//      resource servers both sign FullOffer templates with the SAME
//      seller and the protocol rejects the second submission because
//      the predicted offerId has already been minted and bought.
//
// Each slot's account is therefore registered on-chain as a SEPARATE
// Boson seller entity by `globalSetup` (see `test/setup/globalSetup.ts`).
// The seller id is published via `process.env[SELLERS_ENV_KEY]` and
// looked up at test time via `getSellerInfo(slot)`.
//
// Within one file, vitest serialises tests, so describes inside the
// same file share the slot safely (post-commit.test.ts's `@p0` and
// `@p1` both use `postCommit`).
//
// Mirrors `bosonprotocol/core-components/e2e/tests/utils.ts`'s
// hand-maintained `seedWalletN` pool, but with each slot doubling as
// both the buyer-funder and the registered seller.

import type { Address, Hex, LocalAccount } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import {
  ACCOUNT_5,
  ACCOUNT_6,
  ACCOUNT_7,
  ACCOUNT_10,
  ACCOUNT_11,
  ACCOUNT_12,
  ACCOUNT_13,
  ACCOUNT_14,
  ACCOUNT_15,
} from "../../src/config/accounts.js";

export interface SeedWalletSlot {
  /** viem `LocalAccount` — buyer-funder and seller signer for the slot. */
  account: LocalAccount;
  /** Raw private key — passed to the in-process resource server's `sellerPk` arg. */
  privateKey: Hex;
}

const toSlot = (a: { privateKey: `0x${string}` }): SeedWalletSlot => ({
  account: privateKeyToAccount(a.privateKey),
  privateKey: a.privateKey,
});

/**
 * Named per-FILE slots. Each chain-touching test file imports exactly
 * one. NEVER assign the same slot to two test files that can run in
 * parallel — globalSetup registers a separate seller per slot, and
 * sharing a slot defeats the parallel-safety guarantees.
 */
export const SEED_WALLETS = {
  /** `commit.test.ts` */
  commit: toSlot(ACCOUNT_5),
  /** `post-commit.test.ts` — both `@p0` and `@p1` describes share this file's slot. */
  postCommit: toSlot(ACCOUNT_6),
  /** Reserved for `validation-commit.test.ts` once it lands chain-touching tests. */
  validationCommit: toSlot(ACCOUNT_7),
  /** `concurrent.test.ts` — funds the 20 parallel buyers and registers the slot's seller. */
  concurrent: toSlot(ACCOUNT_13),
  /** `operational.test.ts` — F1 / F2 / F4 failure-mode scenarios. */
  operational: toSlot(ACCOUNT_10),
  /** `validation-post-commit.test.ts` — C6 / C9 / C10 validation negatives. */
  validationPostCommit: toSlot(ACCOUNT_11),
  /** `next-actions.test.ts` — D1 / D2 post-commit `nextActions` derivation. */
  nextActions: toSlot(ACCOUNT_14),
  /** `multi-party.test.ts` — E1 (concurrent commit) + E3 (dual-sig resolve). */
  multiParty: toSlot(ACCOUNT_15),
  /** Spare slot for future chain-touching scenario files. */
  spareC: toSlot(ACCOUNT_12),
} as const;

export type SeedWalletName = keyof typeof SEED_WALLETS;

/**
 * Env-var key under which `globalSetup` publishes the JSON map of
 * `{ slotName → { id, address } }` for the seller entity registered
 * against each slot. Tests look this up via `getSellerInfo(slot)`.
 */
export const SELLERS_ENV_KEY = "X402_E2E_SELLERS";

export interface SeedWalletSellerInfo {
  /** Boson seller entity id (decimal string). */
  id: string;
  /** Seller's assistant address — matches `SEED_WALLETS[slot].account.address`. */
  address: Address;
}

type SellerInfoMap = Record<string, SeedWalletSellerInfo>;

/**
 * Read the seller info that `globalSetup` registered for `slot`.
 * Throws when the env map is missing (globalSetup didn't run — likely
 * `E2E_DOCKER=1` was off) or the slot has no entry.
 */
export function getSellerInfo(slot: SeedWalletName): SeedWalletSellerInfo {
  const raw = process.env[SELLERS_ENV_KEY];
  if (raw === undefined || raw.length === 0) {
    throw new Error(
      `[x402-e2e/seed-wallets] ${SELLERS_ENV_KEY} not set — did globalSetup run? (set E2E_DOCKER=1)`,
    );
  }
  const all = JSON.parse(raw) as SellerInfoMap;
  const info = all[slot];
  if (info === undefined) {
    throw new Error(
      `[x402-e2e/seed-wallets] no seller registered for slot "${slot}" in ${SELLERS_ENV_KEY}`,
    );
  }
  return info;
}
