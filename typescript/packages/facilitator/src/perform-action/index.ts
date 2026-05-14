// `performAction` — relay a post-commit transition (redeem / complete /
// cancel / revoke / raise / retract / escalate / resolve dispute) on
// behalf of the signer.
//
// Pipeline:
//   1. Decode signedPayload (ABI-encoded BosonMetaTx) — INVALID_PAYLOAD
//      on malformed bytes.
//   2. supportedNetworks gate.
//   3. Validate action is a post-commit action and that signed calldata
//      matches `input.action` + `input.exchangeId`.
//   4. Validate tokenAuthStrategy compatibility. Until the BPIP-12
//      envelope encoder ships, performAction supports only `"none"` and
//      rejects all token-auth-related fields on that path.
//   5. Resolve the canonical escrow address from `config.escrows[network]`
//      and reject mismatches against `input.escrowAddress` — prevents
//      the facilitator from being abused as a generic gas sponsor for
//      arbitrary contracts that share the `executeMetaTransaction(...)`
//      selector.
//   6. Parse chain id.
//   7. Recover the meta-tx signer and confirm it matches metaTx.from.
//      The facilitator is signer-agnostic: it doesn't care if the role
//      is buyer or seller — the protocol enforces that on-chain.
//   8. Simulate `executeMetaTransaction(...)` via `eth_call` (same
//      pre-flight settle uses).
//   9. Build the outer envelope (currently the `"none"` strategy only).
//  10. Submit + wait for receipt; an on-chain revert surfaces as
//      ONCHAIN_REVERT.
//  11. Look up the predicted post-state from ACTION_POST_STATE and
//      return it so callers can update local state without a subgraph
//      round-trip.
//
// Signed by buyer for redeem / raise / retract / escalate, by seller
// for revoke, by either for cancel / complete / resolve-dispute (the
// last needs both signatures pre-aggregated in the metaTx.functionSignature).

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

import { decodeSignedPayload } from "@bosonprotocol/x402-evm/codec";

import { validatePerformActionMetaTx } from "./action-calldata.js";
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

    // 3. Action/calldata validation. The request body is only metadata; the
    //    signed payload decides what the relayer will actually submit.
    const validation = validatePerformActionMetaTx({
      action: input.action,
      exchangeId: input.exchangeId,
      metaTx,
    });
    if (!validation.ok) return validation;

    // 4. Resolve and validate token-auth strategy. BPIP-12 post-commit
    //    token-auth envelopes are not wired yet, so non-"none" fails
    //    before signature recovery or RPC work.
    const tokenAuthStrategy = input.tokenAuthStrategy ?? "none";
    if (tokenAuthStrategy !== "none") {
      return {
        ok: false,
        code: "UNSUPPORTED_TOKEN_AUTH_STRATEGY",
        reason: `tokenAuthStrategy "${tokenAuthStrategy}" requires the BPIP-12 token-auth envelope, which is not yet wired in performAction()`,
      };
    }
    if (
      input.tokenAuth !== undefined ||
      input.asset !== undefined ||
      input.amount !== undefined ||
      input.maxTimeoutSeconds !== undefined
    ) {
      return {
        ok: false,
        code: "INVALID_PAYLOAD",
        reason:
          'tokenAuth, asset, amount, and maxTimeoutSeconds must be omitted when tokenAuthStrategy is "none"',
      };
    }

    // 5. Resolve the canonical escrow address from the operator's
    //    allowlist. Trusting `input.escrowAddress` directly would turn
    //    the facilitator into a generic gas sponsor for any contract
    //    on a supported chain that exposes a compatible
    //    `executeMetaTransaction(...)` selector. Look up the configured
    //    Diamond for `input.network` and reject mismatches.
    const allowlistedEscrow = config.escrows[input.network];
    if (!allowlistedEscrow) {
      return {
        ok: false,
        code: "NETWORK_MISMATCH",
        reason: `network "${input.network}" has no escrow configured in config.escrows`,
      };
    }
    if (input.escrowAddress.toLowerCase() !== allowlistedEscrow.toLowerCase()) {
      return {
        ok: false,
        code: "INVALID_PAYLOAD",
        reason: `escrowAddress "${input.escrowAddress}" is not the configured Diamond for network "${input.network}" ("${allowlistedEscrow}")`,
      };
    }

    // 6. Parse chain id.
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

    const escrowAddress = allowlistedEscrow as `0x${string}`;

    // 7. Signature recovery — for performAction we just confirm the sig
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

    // 8. Simulate. The `none` path goes through `executeMetaTransaction`.
    const sim = await simulateExecuteMetaTransaction({
      escrowAddress,
      buyer: metaTx.from as `0x${string}`,
      metaTx,
      tokenAuthStrategy,
      publicClient: config.publicClient,
      relayerAddress: relayer,
    });
    if (!sim.ok) return sim;

    // 9. Build outer envelope.
    const envelope = buildSettleEnvelope({
      escrowAddress,
      buyer: metaTx.from as `0x${string}`,
      metaTx,
      strategy: tokenAuthStrategy,
    });
    if (!envelope.ok) return envelope;

    // 10. Submit + wait.
    const submitted = await submit({
      tx: envelope.tx,
      walletClient: config.walletClient,
      publicClient: config.publicClient,
    });
    if (!submitted.ok) return submitted;

    // 11. New state lookup.
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
