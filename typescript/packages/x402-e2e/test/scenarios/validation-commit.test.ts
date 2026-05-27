// Commit-time validation negatives — section C of the e2e plan.
//
// Each scenario builds a valid `X-PAYMENT` payload via the buyer's
// client, then tampers a single field to trip a specific server- or
// facilitator-side check. Asserts both the HTTP status and the
// wire-level `code` so a future rename of an error code surfaces here
// as a regression.
//
// Where the codes diverge from the original plan text, production wins
// (the deployed validator / facilitator are ground truth):
//   - C1 → `CALLDATA_MISMATCH` (rule 7), not "OFFER_MISMATCH".
//   - C8 → `INVALID_PAYLOAD` from the facilitator allowlist guard, not
//     "ESCROW_NOT_ALLOWED" (there is no such code in the facilitator's
//     `FacilitatorErrorCode` union).
//
// Two submission paths:
//   - C1–C5 go through the resource server's `/resource` paywall (the
//     same path the happy-path A* tests use), so they exercise the
//     server-side validator and, for C3/C4, the facilitator via
//     `/settle`.
//   - C8 POSTs straight to the facilitator's `/verify`: the resource
//     server always forwards its own (allowlisted) `escrowAddress`, so
//     the allowlist guard can only be reached by submitting requirements
//     with a non-allowlisted escrow directly.

import type { LocalAccount } from "viem";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { LOCAL_31337_0 } from "../../src/config/local-31337-0.js";
import {
  buildPublicClient,
  buildWalletClient,
  buildValidCommitHeader,
  createChainTokenDomainResolver,
  fetchEscrowChallenge,
  submitMutatedCommit,
  submitPaymentHeader,
  verifyViaFacilitator,
  decodePaymentHeader,
} from "../../src/harness/index.js";

import { createFundedBuyer, ensureBuyerCanPay, ensureBuyerHasBalance } from "./_buyer-setup.js";
import { ENABLED } from "./_flags.js";
import { SEED_WALLETS } from "./_seed-wallets.js";
import { createScenarioContext, NONE_TOKEN_AUTH_SCENARIO, type ScenarioContext } from "./_setup.js";

/** Structurally valid but never-allowlisted escrow address for C8. */
const NON_ALLOWLISTED_ESCROW = "0x1111111111111111111111111111111111111111";

describe.skipIf(!ENABLED)("@p0 commit-time validations (none strategy)", () => {
  let ctx: ScenarioContext;
  let buyerAccount: LocalAccount;

  beforeAll(async () => {
    const publicClient = buildPublicClient();
    const funder = buildWalletClient(SEED_WALLETS.validationCommit.account);
    buyerAccount = await createFundedBuyer({ funder, publicClient });
    ctx = await createScenarioContext({
      slot: "validationCommit",
      buyerAccount,
      ...NONE_TOKEN_AUTH_SCENARIO,
    });
    // C3's first submit settles a real commit on-chain, so the `none`
    // buyer needs balance + a standing escrow allowance. C1 / C2 reject
    // at the server before settle, so the funding is a harmless no-op
    // for them.
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

  it("C1 — tampered `functionSignature` → 400 CALLDATA_MISMATCH", async () => {
    const result = await submitMutatedCommit({
      resourceServerUrl: ctx.resourceServerUrl,
      client: ctx.buyer.client,
      mutate: (payload) => {
        // Flip the final nibble — keeps the value schema-valid hex but
        // breaks the rule-7 byte comparison against the calldata
        // reconstructed from `offerRef`.
        const fs = payload.payload.metaTx.functionSignature;
        const last = fs.slice(-1);
        payload.payload.metaTx.functionSignature = (fs.slice(0, -1) +
          (last === "0" ? "1" : "0")) as `0x${string}`;
      },
    });

    expect(result.status, JSON.stringify(result.body)).toBe(400);
    expect(result.body?.code).toBe("CALLDATA_MISMATCH");
    expect(result.body?.details?.rule).toBe(7);
  });

  it("C2 — wrong meta-tx signature (mutated nonce) → 400 BAD_META_TX_SIGNATURE", async () => {
    const result = await submitMutatedCommit({
      resourceServerUrl: ctx.resourceServerUrl,
      client: ctx.buyer.client,
      mutate: (payload) => {
        // The meta-tx signature was produced over the original nonce.
        // Bumping the nonce leaves `from === buyer` (rule-8's first
        // check passes) but makes the ECDSA recovery resolve to a
        // different address → BAD_META_TX_SIGNATURE. The server rejects
        // pre-facilitator, so no on-chain submit happens.
        payload.payload.metaTx.nonce = (BigInt(payload.payload.metaTx.nonce) + 1n).toString();
      },
    });

    expect(result.status, JSON.stringify(result.body)).toBe(400);
    expect(result.body?.code).toBe("BAD_META_TX_SIGNATURE");
    expect(result.body?.details?.rule).toBe(8);
  });

  it("C3 — nonce replay → second submit rejected by facilitator (nonce consumed)", async () => {
    // Build ONE signed header and submit it twice under the same
    // session: the meta-tx nonce is fixed at sign time, so the second
    // submit re-presents an already-consumed nonce. The server
    // validator is stateless and passes both times; the facilitator
    // catches the replay (duplicate-nonce revert) on the second.
    const { sessionId, headerValue } = await buildValidCommitHeader(
      ctx.resourceServerUrl,
      ctx.buyer.client,
    );

    const first = await submitPaymentHeader(ctx.resourceServerUrl, sessionId, headerValue);
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body?.ok).toBe(true);

    const second = await submitPaymentHeader(ctx.resourceServerUrl, sessionId, headerValue);
    expect(second.status, JSON.stringify(second.body)).toBe(502);
    expect(second.body?.code).toBe("FACILITATOR_REJECTED");
    // The exact inner code depends on whether the facilitator catches
    // the consumed nonce at simulation or at on-chain submit; assert it
    // surfaced a facilitator code rather than pinning one revert flavour.
    expect(typeof second.body?.details?.facilitatorCode).toBe("string");
  });

  it("C8 — wrong `escrowAddress` (not on facilitator allowlist) → 400 INVALID_PAYLOAD", async () => {
    // Build a valid payload + read back the challenge requirements, then
    // POST to the facilitator's `/verify` with the escrow swapped for a
    // non-allowlisted address. The allowlist guard (verify step 7) fires
    // before signature recovery / simulation.
    const sessionId = globalThis.crypto.randomUUID();
    const requirements = await fetchEscrowChallenge(ctx.resourceServerUrl, sessionId);
    const headerValue = await ctx.buyer.client.handle402(requirements);
    const payload = decodePaymentHeader(headerValue);

    const result = await verifyViaFacilitator({
      facilitatorUrl: ctx.facilitatorUrl,
      network: ctx.network,
      payload,
      requirements: { ...requirements, escrowAddress: NON_ALLOWLISTED_ESCROW },
    });

    expect(result.status, JSON.stringify(result.body)).toBe(400);
    expect(result.body?.code).toBe("INVALID_PAYLOAD");
  });
});

describe.skipIf(!ENABLED)("@p0 commit-time validations (erc3009 deadline)", () => {
  let ctx: ScenarioContext;

  beforeAll(async () => {
    // Mirrors A3's ERC-3009 setup: the payload carries an `erc3009`
    // token-auth whose `validBefore` the deadline scenarios tamper. See
    // A3 for the 24h `maxTimeoutSeconds` chain-drift rationale.
    const publicClient = buildPublicClient();
    const funder = buildWalletClient(SEED_WALLETS.validationCommit.account);
    const buyerAccount = await createFundedBuyer({ funder, publicClient });
    ctx = await createScenarioContext({
      slot: "validationCommit",
      buyerAccount,
      assetAddress: LOCAL_31337_0.contracts.testErc3009,
      tokenAuthStrategies: ["erc3009"],
      tokenDomainResolver: createChainTokenDomainResolver(publicClient),
      maxTimeoutSeconds: 24 * 60 * 60,
    });
    await ensureBuyerHasBalance({
      walletClient: buildWalletClient(buyerAccount),
      publicClient,
      buyerAddress: buyerAccount.address,
      assetAddress: LOCAL_31337_0.contracts.testErc3009,
      amount: 10_000_000n,
    });
  });

  afterAll(async () => {
    await ctx?.teardown();
  });

  it("C4 — expired authorization (`validBefore` in the past) → 502 facilitator reject", async () => {
    // A past `validBefore` is below the server's `now + maxTimeoutSeconds`
    // horizon, so rule 9 passes and the payload reaches the facilitator.
    // Tampering the signed field breaks the ERC-3009 signature recovery
    // (and would also revert on-chain), so the facilitator rejects with
    // a 502 `FACILITATOR_REJECTED` envelope rather than the server 400.
    const result = await submitMutatedCommit({
      resourceServerUrl: ctx.resourceServerUrl,
      client: ctx.buyer.client,
      mutate: (payload) => {
        const tokenAuth = payload.payload.tokenAuth;
        if (tokenAuth?.kind !== "erc3009") {
          throw new Error(`expected erc3009 tokenAuth, got ${tokenAuth?.kind ?? "none"}`);
        }
        // 1 second after the epoch — unambiguously expired.
        tokenAuth.data.validBefore = 1;
      },
    });

    expect(result.status, JSON.stringify(result.body)).toBe(502);
    expect(result.body?.code).toBe("FACILITATOR_REJECTED");
    expect(typeof result.body?.details?.facilitatorCode).toBe("string");
  });

  it("C5 — `maxTimeoutSeconds` exceeded → 400 TOKEN_AUTH_DEADLINE_EXCEEDED", async () => {
    // A `validBefore` far beyond `now + maxTimeoutSeconds` trips the
    // server's rule-9 horizon check, which reads the declared value
    // directly — so it rejects pre-facilitator, before any signature or
    // simulation step.
    const farFuture = Math.floor(Date.now() / 1000) + 100 * 365 * 24 * 60 * 60;
    const result = await submitMutatedCommit({
      resourceServerUrl: ctx.resourceServerUrl,
      client: ctx.buyer.client,
      mutate: (payload) => {
        const tokenAuth = payload.payload.tokenAuth;
        if (tokenAuth?.kind !== "erc3009") {
          throw new Error(`expected erc3009 tokenAuth, got ${tokenAuth?.kind ?? "none"}`);
        }
        tokenAuth.data.validBefore = farFuture;
      },
    });

    expect(result.status, JSON.stringify(result.body)).toBe(400);
    expect(result.body?.code).toBe("TOKEN_AUTH_DEADLINE_EXCEEDED");
  });
});
