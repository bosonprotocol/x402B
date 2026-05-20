// Per-describe seed wallets for the chain-touching scenario suite.
//
// Vitest runs test FILES in parallel by default. Each chain-touching
// describe in each file is wired up against a freshly-generated random
// buyer EOA that the slot below funds with native ETH for gas. Two
// slots that run in parallel must never reuse the same account —
// concurrent funding transactions on a shared EOA collide on tx nonce
// and cascade into `NonceTooLow` / `BAD_META_TX_SIGNATURE` /
// `OfferSoldOut` failures.
//
// Mirrors `bosonprotocol/core-components/e2e/tests/utils.ts`'s
// hand-maintained `seedWalletN` pool. Pick the slot at module scope
// in each chain-touching test file; two parallel files must never
// declare the same slot.

import type { LocalAccount } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import {
  ACCOUNT_5,
  ACCOUNT_6,
  ACCOUNT_7,
  ACCOUNT_10,
  ACCOUNT_11,
  ACCOUNT_12,
} from "../../src/config/accounts.js";

const toAccount = (a: { privateKey: `0x${string}` }) => privateKeyToAccount(a.privateKey);

/**
 * Named seed wallets. Each chain-touching test describe imports
 * exactly one. NEVER assign the same slot to two describes that can
 * run in parallel — Vitest runs files in parallel by default, so two
 * parallel files on the same EOA will race the chain nonce.
 */
export const SEED_WALLETS = {
  /** `commit.test.ts` — `@p0 commit-time scenarios` describe. */
  commit: toAccount(ACCOUNT_5),
  /** `post-commit.test.ts` — `@p0 post-commit lifecycle scenarios` describe. */
  postCommitP0: toAccount(ACCOUNT_6),
  /** `post-commit.test.ts` — `@p1 post-commit lifecycle scenarios` describe. */
  postCommitP1: toAccount(ACCOUNT_7),
  /** Reserved for `validation-commit.test.ts` once it lands chain-touching tests. */
  validationCommit: toAccount(ACCOUNT_10),
  /** Spare slots for future chain-touching scenario files (D, E, F sections). */
  spareA: toAccount(ACCOUNT_11),
  spareB: toAccount(ACCOUNT_12),
} as const satisfies Record<string, LocalAccount>;

export type SeedWalletName = keyof typeof SEED_WALLETS;
