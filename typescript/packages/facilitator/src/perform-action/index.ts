// `performAction` — relay a post-commit transition (redeem / complete /
// cancel / revoke / raise / retract / escalate / resolve dispute, or the
// entity-keyed `boson-withdrawFunds`) on behalf of the signer.
//
// Pipeline:
//   1. Decode signedPayload (ABI-encoded BosonMetaTx) — INVALID_PAYLOAD
//      on malformed bytes.
//   2. supportedNetworks gate.
//   3. Validate action is a post-commit action and that signed calldata
//      matches `input.action` + (`input.exchangeId` for exchange-keyed
//      actions, `input.entityId` for entity-keyed actions).
//   4. Validate tokenAuthStrategy + cross-field shape: for `"none"`,
//      every token-auth field must be absent; for any other strategy,
//      `tokenAuth`, `asset`, `amount`, and `maxTimeoutSeconds` are all
//      required. The signer also signed an EIP-712 token-auth payload
//      that we recover and cross-check (mirrors the verify/settle path).
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
//      pre-flight settle uses); the simulator routes through the BPIP-12
//      token-auth envelope automatically when a `tokenAuth` is provided.
//   9. Submit via `coreSdk.executeMetaTransaction(...)` — the unified
//      core-sdk entrypoint that routes between `executeMetaTransaction`
//      and `executeMetaTransactionWithTokenTransferAuthorization` based
//      on whether `transferAuthorizations` is supplied. An on-chain
//      revert surfaces as ONCHAIN_REVERT.
//  10. For exchange-keyed actions, look up the predicted post-state
//      from ACTION_POST_STATE and return it. Entity-keyed actions
//      (`boson-withdrawFunds`) return just `{ ok: true, txHash }` —
//      they don't transition the exchange state machine.
//
// Signed by buyer for redeem / raise / retract / escalate, by seller
// for revoke, by either for cancel / complete / resolve-dispute (the
// last needs both signatures pre-aggregated in the metaTx.functionSignature),
// and by the funds entity's authorised signer for withdrawFunds.

import { isEntityKeyedAction } from "@bosonprotocol/x402-core/state-machine";
import { decodeSignedPayload } from "@bosonprotocol/x402-evm/codec";

import { toResult } from "../errors.js";
import { createFacilitatorCoreSdk } from "../internal/core-sdk-factory.js";
import {
  bosonTokenAuthToTransferAuthorization,
  type TransferAuthorization,
} from "../internal/token-auth-lift.js";
import { mapSubmitError } from "../settle/index.js";
import type {
  FacilitatorConfig,
  FacilitatorPerformActionInput,
  FacilitatorPerformActionResult,
} from "../types.js";
import { recoverMetaTxSigner } from "../verify/meta-tx-signature.js";
import { simulateExecuteMetaTransaction } from "../verify/simulate.js";
import { parseChainId } from "../verify/structural.js";
import { verifyTokenAuthSignature } from "../verify/token-auth-signature.js";

import {
  validatePerformEntityActionMetaTx,
  validatePerformExchangeActionMetaTx,
} from "./action-calldata.js";
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
    //    Dispatch on action kind so each variant validates the right key.
    const isEntityKeyed = isEntityKeyedAction(input.action);
    const validation = isEntityKeyed
      ? validatePerformEntityActionMetaTx({
          action: input.action,
          entityId: (input as { entityId: string }).entityId,
          metaTx,
        })
      : validatePerformExchangeActionMetaTx({
          action: input.action,
          exchangeId: (input as { exchangeId: string }).exchangeId,
          metaTx,
        });
    if (!validation.ok) return validation;

    // 4. Token-auth strategy + cross-field shape. core-sdk's
    //    `executeMetaTransaction` handles both the bare envelope and the
    //    BPIP-12 token-transfer-authorization variant, so any strategy
    //    is now wireable — we just need a coherent `tokenAuth` /
    //    `asset` / `amount` / `maxTimeoutSeconds` tuple when one is
    //    declared.
    const tokenAuthStrategy = input.tokenAuthStrategy ?? "none";
    if (tokenAuthStrategy === "none") {
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
    } else {
      const missing: string[] = [];
      if (input.tokenAuth === undefined) missing.push("tokenAuth");
      if (input.asset === undefined) missing.push("asset");
      if (input.amount === undefined) missing.push("amount");
      if (input.maxTimeoutSeconds === undefined) missing.push("maxTimeoutSeconds");
      if (missing.length > 0) {
        return {
          ok: false,
          code: "INVALID_PAYLOAD",
          reason: `tokenAuthStrategy "${tokenAuthStrategy}" requires ${missing.join(", ")}`,
        };
      }
      if (input.tokenAuth!.kind !== tokenAuthStrategy) {
        return {
          ok: false,
          code: "INVALID_PAYLOAD",
          reason: `tokenAuth.kind "${input.tokenAuth!.kind}" must match tokenAuthStrategy "${tokenAuthStrategy}"`,
        };
      }
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

    // 7b. Token-auth signature recovery (skip for "none"). Same checks
    //     verify() runs on the settle path: recovered signer must match
    //     metaTx.from, asset/spender/amount/deadline must agree with the
    //     declared metadata.
    if (tokenAuthStrategy !== "none") {
      const tokenAuthSig = await verifyTokenAuthSignature({
        chainId: chain.chainId,
        asset: input.asset! as `0x${string}`,
        buyer: metaTx.from as `0x${string}`,
        escrowAddress,
        tokenAuth: input.tokenAuth!,
        amount: input.amount!,
        maxTimeoutSeconds: input.maxTimeoutSeconds!,
        publicClient: config.publicClient,
      });
      if (!tokenAuthSig.ok) return tokenAuthSig;
    }

    // 8. Simulate. The simulator routes through the BPIP-12 token-auth
    //    envelope when a tokenAuth is provided.
    const sim = await simulateExecuteMetaTransaction({
      escrowAddress,
      buyer: metaTx.from as `0x${string}`,
      metaTx,
      tokenAuthStrategy,
      tokenAuth: input.tokenAuth,
      publicClient: config.publicClient,
      relayerAddress: relayer,
    });
    if (!sim.ok) return sim;

    // 9. Submit via coreSdk.executeMetaTransaction. The mixin dispatches
    //    on `transferAuthorizations` length; the relayer wallet pays gas
    //    through the viem-backed Web3LibAdapter. Same submit path for
    //    exchange-keyed and entity-keyed actions — only the inner
    //    `metaTx.functionSignature` differs.
    const coreSdk = createFacilitatorCoreSdk({
      walletClient: config.walletClient,
      publicClient: config.publicClient,
      chainId: chain.chainId,
      escrowAddress,
    });

    const transferAuthorizations: TransferAuthorization[] | undefined =
      tokenAuthStrategy === "none"
        ? undefined
        : [bosonTokenAuthToTransferAuthorization(input.tokenAuth!)];

    let txHash: `0x${string}`;
    let receipt;
    try {
      const response = await coreSdk.executeMetaTransaction(
        {
          functionName: metaTx.functionName,
          functionSignature: metaTx.functionSignature,
          nonce: metaTx.nonce,
          sigR: metaTx.sig.r,
          sigS: metaTx.sig.s,
          sigV: metaTx.sig.v,
          transferAuthorizations,
        },
        { userAddress: metaTx.from as `0x${string}`, contractAddress: escrowAddress },
      );
      txHash = response.hash as `0x${string}`;
    } catch (e) {
      return mapSubmitError(e);
    }
    try {
      receipt = await config.publicClient.waitForTransactionReceipt({ hash: txHash });
    } catch (e) {
      return {
        ok: false,
        code: "INTERNAL_ERROR",
        reason:
          e instanceof Error
            ? `waitForTransactionReceipt failed: ${e.message}`
            : "waitForTransactionReceipt failed",
      };
    }
    if (receipt.status !== "success") {
      return {
        ok: false,
        code: "ONCHAIN_REVERT",
        reason: `transaction ${txHash} reverted on-chain`,
      };
    }

    // 10. New state lookup — only exchange-keyed actions transition the
    //     state machine. Entity-keyed actions return just txHash.
    if (isEntityKeyed) {
      return { ok: true, txHash };
    }
    const newState = deriveNewState(
      (input as { action: Parameters<typeof deriveNewState>[0] }).action,
    );
    return {
      ok: true,
      txHash,
      newExchangeState: newState.newExchangeState,
      newDisputeState: newState.newDisputeState,
    };
  } catch (e) {
    return toResult(e);
  }
}
