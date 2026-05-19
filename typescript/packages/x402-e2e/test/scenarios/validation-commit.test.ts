// Commit-time validation negatives — section C of the e2e plan.
//
// Each scenario builds a valid `X-PAYMENT` payload then mutates a
// single field to trip a specific server- or facilitator-side check.
// Asserts both the HTTP status and the wire-level `code` so a future
// rename of the error code surfaces here as a regression.
//
// PR 6 ships the file with `it.todo` markers so the suite enumerates
// the planned coverage; PR 7 lands the implementations alongside the
// post-commit lifecycle tests.

import { describe, it } from "vitest";

const ENABLED = process.env.E2E_DOCKER === "1";

describe.skipIf(!ENABLED)("@p0 commit-time validations", () => {
  it.todo("C1 — tampered `functionSignature` → 400 OFFER_MISMATCH");
  it.todo("C2 — wrong meta-tx signature → BAD_META_TX_SIGNATURE, no on-chain submit");
  it.todo("C3 — nonce replay → second submit fails (nonce consumed on chain)");
  it.todo("C4 — expired offer (`validBefore < now`) → SIMULATION_REVERT or pre-flight reject");
  it.todo(
    "C5 — `maxTimeoutSeconds` exceeded (`validBefore > now + maxTimeoutSeconds`) → server reject pre-facilitator",
  );
  it.todo("C8 — wrong `escrowAddress` (not on facilitator allowlist) → ESCROW_NOT_ALLOWED");
});
