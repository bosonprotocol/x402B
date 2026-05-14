// `performAction` — relay a post-commit transition (redeem / complete /
// cancel / revoke / raise / retract / escalate / resolve dispute) on
// behalf of the signer.
//
// Pipeline:
//   1. Decode signedPayload (ABI-encoded BosonMetaTx) — INVALID_PAYLOAD
//      on malformed bytes.
//   2. supportedNetworks gate.
//   3. Validate action is in ACTION_IDS — UNSUPPORTED_ACTION otherwise.
//   4. Recover the meta-tx signer and confirm it matches metaTx.from.
//      The facilitator is signer-agnostic: it doesn't care if the role
//      is buyer or seller — the protocol enforces that on-chain.
//   5. Simulate `executeMetaTransaction(...)` via `eth_call` (same
//      pre-flight settle uses).
//   6. Build the outer envelope (always `none` strategy — post-commit
//      transitions don't carry a token-auth queue).
//   7. Submit + wait for receipt; an on-chain revert surfaces as
//      ONCHAIN_REVERT.
//   8. Look up the predicted post-state from ACTION_POST_STATE and
//      return it so callers can update local state without a subgraph
//      round-trip.
//
// Signed by buyer for redeem / raise / retract / escalate, by seller
// for revoke, by either for cancel / complete / resolve-dispute (the
// last needs both signatures pre-aggregated in the metaTx.functionSignature).

import { ACTION_IDS } from "@bosonprotocol/x402-core/state-machine";

import { toResult } from "../errors.js";
import { buildSettleEnvelope } from "../settle/build-envelope.js";
import { submit } from "../settle/submit.js";
import type {
  FacilitatorConfig,
  FacilitatorPerformActionInput,
  FacilitatorPerformActionResult,
} from "../types.js";
import { recoverMetaTxSigner } from "../verify/meta-tx-signature.js";
import { simulateExecuteMetaTransaction } from "../verify/simulate.js";
import { parseChainId } from "../verify/structural.js";

import { decodeSignedPayload } from "./codec.js";
import { deriveNewState } from "./new-state.js";

export async function performAction(
  input: FacilitatorPerformActionInput,
  config: FacilitatorConfig,
): Promise<FacilitatorPerformActionResult> {
  try {
    // 1. Decode signedPayload.
    let metaTx;
    try {
      metaTx = decodeSignedPayload(input.signedPayload);
    } catch (e) {
      return {
        ok: false,
        code: "INVALID_PAYLOAD",
        reason:
          e instanceof Error
            ? `signedPayload decode failed: ${e.message}`
            : "signedPayload decode failed",
      };
    }

    // 2. supportedNetworks gate.
    if (!config.supportedNetworks.includes(input.network)) {
      return {
        ok: false,
        code: "NETWORK_MISMATCH",
        reason: `network "${input.network}" is not in supportedNetworks (${config.supportedNetworks.join(", ")})`,
      };
    }

    // 3. Action validation.
    if (!(ACTION_IDS as readonly string[]).includes(input.action)) {
      return {
        ok: false,
        code: "UNSUPPORTED_ACTION",
        reason: `action "${input.action}" is not a known Boson action id`,
      };
    }

    // 4. Parse chain id.
    const chain = parseChainId(input.network);
    if (!chain.ok) return chain;

    const relayer = config.walletClient.account?.address;
    if (!relayer) {
      return {
        ok: false,
        code: "INTERNAL_ERROR",
        reason: "config.walletClient has no account; cannot send transaction",
      };
    }

    const escrowAddress = input.escrowAddress as `0x${string}`;

    // 5. Signature recovery — for performAction we just confirm the sig
    //    is self-consistent (recovered === metaTx.from). The role check
    //    (buyer vs seller vs assistant) is the protocol's job.
    const recovery = await recoverMetaTxSigner({
      chainId: chain.chainId,
      escrowAddress,
      metaTx,
    });
    if (!recovery.ok) return recovery;
    if (recovery.recovered.toLowerCase() !== metaTx.from.toLowerCase()) {
      return {
        ok: false,
        code: "BAD_META_TX_SIGNATURE",
        reason: `recovered signer ${recovery.recovered} != metaTx.from ${metaTx.from}`,
      };
    }

    // 6. Simulate. Post-commit transitions never carry a token-auth
    //    queue — the relayer is just wrapping a buyer/seller-signed
    //    meta-tx, so the "none" envelope path applies.
    const sim = await simulateExecuteMetaTransaction({
      escrowAddress,
      buyer: metaTx.from as `0x${string}`,
      metaTx,
      tokenAuthStrategy: "none",
      publicClient: config.publicClient,
      relayerAddress: relayer,
    });
    if (!sim.ok) return sim;

    // 7. Build outer envelope (post-commit always "none" strategy).
    const envelope = buildSettleEnvelope({
      escrowAddress,
      buyer: metaTx.from as `0x${string}`,
      metaTx,
      strategy: "none",
    });
    if (!envelope.ok) return envelope;

    // 8. Submit + wait.
    const submitted = await submit({
      tx: envelope.tx,
      walletClient: config.walletClient,
      publicClient: config.publicClient,
    });
    if (!submitted.ok) return submitted;

    // 9. New state lookup.
    const newState = deriveNewState(input.action);

    return {
      ok: true,
      txHash: submitted.txHash,
      newExchangeState: newState.newExchangeState,
      newDisputeState: newState.newDisputeState,
    };
  } catch (e) {
    return toResult(e);
  }
}
