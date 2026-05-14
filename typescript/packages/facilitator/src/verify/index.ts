// `verify` — stateless pre-flight check on an EscrowPaymentPayload +
// EscrowPaymentRequirements pair.
//
// Implements docs/boson-impl-07-facilitator.md's `POST /verify` contract:
//   1. Confirm `scheme === "escrow"` (input + payload).
//   2. Validate the payload + requirements structurally via the Zod
//      schemas in `@bosonprotocol/x402-core/schemes/escrow`.
//   3. Confirm the network is consistent across input, payload, and
//      requirements.
//   4. Confirm `payload.action` is in `requirements.actions.next[].id`.
//   5. Confirm `payload.offerRef` and `payload.metaTx` encode the offer
//      advertised in requirements.
//   6. Confirm `payload.tokenAuthStrategy` is in
//      `requirements.tokenAuthStrategies` (and the cross-field rule:
//      tokenAuth must be present iff strategy != "none").
//   7. Confirm `requirements.escrowAddress` is the Boson Diamond the
//      operator has whitelisted for this network via `config.escrows`.
//      Prevents a malicious seller from directing the facilitator at
//      an arbitrary contract that shares the `executeMetaTransaction`
//      selector.
//   8. Recover the buyer's meta-tx signature against the Diamond domain.
//   9. If `tokenAuthStrategy !== "none"`, recover the token-auth
//      signature against the asset's EIP-712 domain and enforce
//      amount/deadline constraints.
//  10. Simulate `executeMetaTransaction(...)` via `eth_call` to catch
//      protocol-level reverts (duplicate nonce, expired auth, …)
//      without spending gas.
//
// Each step returns a discriminated-union `StepResult`; the orchestrator
// returns on the first failure with the underlying code + reason.

import type {
  FacilitatorConfig,
  FacilitatorVerifyInput,
  FacilitatorVerifyResult,
} from "../types.js";
import { toResult } from "../errors.js";

import { verifyMetaTxSignature } from "./meta-tx-signature.js";
import { simulateExecuteMetaTransaction } from "./simulate.js";
import {
  parseChainId,
  validateActionInRequirements,
  validateMetaTxCalldataMatchesRequirements,
  validateNetworkMatch,
  validateOfferRefMatchesRequirements,
  validatePayloadStructure,
  validateRequirementsStructure,
  validateScheme,
  validateTokenAuthStrategyInRequirements,
  type StepResult,
} from "./structural.js";
import { verifyTokenAuthSignature } from "./token-auth-signature.js";

export async function verify(
  input: FacilitatorVerifyInput,
  config: FacilitatorConfig,
): Promise<FacilitatorVerifyResult> {
  try {
    // Pre-flight: the network must be one the relayer is configured for.
    if (!config.supportedNetworks.includes(input.network)) {
      return {
        ok: false,
        code: "NETWORK_MISMATCH",
        reason: `network "${input.network}" is not in supportedNetworks (${config.supportedNetworks.join(", ")})`,
      };
    }

    // 1. Structural validation (payload then requirements).
    const payloadStructural = validatePayloadStructure(input.payload);
    if (!payloadStructural.ok) return payloadStructural;
    const requirementsStructural = validateRequirementsStructure(input.requirements);
    if (!requirementsStructural.ok) return requirementsStructural;

    // 2. Scheme.
    const scheme = validateScheme({ scheme: input.scheme, payload: input.payload });
    if (!scheme.ok) return scheme;

    // 3. Network consistency.
    const network = validateNetworkMatch({
      network: input.network,
      payload: input.payload,
      requirements: input.requirements,
    });
    if (!network.ok) return network;

    // 4. Action presence.
    const action = validateActionInRequirements({
      payload: input.payload,
      requirements: input.requirements,
    });
    if (!action.ok) return action;

    // 5. Offer echo + signed calldata consistency.
    const offerRef = validateOfferRefMatchesRequirements({
      payload: input.payload,
      requirements: input.requirements,
    });
    if (!offerRef.ok) return offerRef;

    const calldata = await validateMetaTxCalldataMatchesRequirements({
      payload: input.payload,
      requirements: input.requirements,
    });
    if (!calldata.ok) return calldata;

    // 6. Token-auth strategy presence + cross-field shape.
    const strategy = validateTokenAuthStrategyInRequirements({
      payload: input.payload,
      requirements: input.requirements,
    });
    if (!strategy.ok) return strategy;

    // 7. Parse chain id from CAIP-2 network.
    const chain = parseChainId(input.network);
    if (!chain.ok) return chain;

    const relayer = config.walletClient.account?.address;
    if (!relayer) {
      return {
        ok: false,
        code: "INTERNAL_ERROR",
        reason: "config.walletClient has no account; cannot simulate as relayer",
      };
    }

    const inner = input.payload.payload;

    // Resolve the canonical escrow from the operator's allowlist —
    // trusting `input.requirements.escrowAddress` directly would let a
    // malicious seller direct the facilitator at any contract on a
    // supported chain that exposes a compatible
    // `executeMetaTransaction(...)` selector, turning the relayer into
    // a generic gas sponsor for non-Boson calls. Reject if the network
    // has no allowlist entry, or if the requirements advertise a
    // Diamond the operator hasn't whitelisted.
    const allowlistedEscrow = config.escrows[input.network];
    if (!allowlistedEscrow) {
      return {
        ok: false,
        code: "NETWORK_MISMATCH",
        reason: `network "${input.network}" has no escrow configured in config.escrows`,
      };
    }
    if (input.requirements.escrowAddress.toLowerCase() !== allowlistedEscrow.toLowerCase()) {
      return {
        ok: false,
        code: "INVALID_PAYLOAD",
        reason: `requirements.escrowAddress "${input.requirements.escrowAddress}" is not the configured Diamond for network "${input.network}" ("${allowlistedEscrow}")`,
      };
    }
    const escrowAddress = allowlistedEscrow as `0x${string}`;

    // 8. Meta-tx signature recovery.
    const metaSig = await verifyMetaTxSignature({
      chainId: chain.chainId,
      escrowAddress,
      metaTx: inner.metaTx,
      buyer: inner.buyer as `0x${string}`,
    });
    if (!metaSig.ok) return metaSig;

    // 9. Token-auth signature recovery (skip for "none").
    if (inner.tokenAuthStrategy !== "none" && inner.tokenAuth) {
      const tokenAuthSig: StepResult = await verifyTokenAuthSignature({
        chainId: chain.chainId,
        asset: input.requirements.asset as `0x${string}`,
        buyer: inner.buyer as `0x${string}`,
        escrowAddress,
        tokenAuth: inner.tokenAuth,
        amount: input.requirements.amount,
        maxTimeoutSeconds: input.requirements.maxTimeoutSeconds,
        publicClient: config.publicClient,
      });
      if (!tokenAuthSig.ok) return tokenAuthSig;
    }

    // 10. On-chain simulation.
    const sim = await simulateExecuteMetaTransaction({
      escrowAddress,
      buyer: inner.buyer as `0x${string}`,
      metaTx: inner.metaTx,
      tokenAuthStrategy: inner.tokenAuthStrategy,
      tokenAuth: inner.tokenAuth,
      publicClient: config.publicClient,
      relayerAddress: relayer,
    });
    if (!sim.ok) return sim;

    return { ok: true };
  } catch (e) {
    return toResult(e);
  }
}
