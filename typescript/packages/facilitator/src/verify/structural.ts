// Synchronous, cheap pre-flight checks for `verify()`. Anything that
// doesn't require an RPC round-trip or a signature recovery lives here.

import {
  escrowPaymentPayloadSchema,
  escrowPaymentRequirementsSchema,
  type EscrowPaymentPayload,
  type EscrowPaymentRequirements,
  type EvmNetwork,
} from "@bosonprotocol/x402-core/schemes/escrow";
import {
  buildCreateOfferAndCommitCalldata,
  buildCreateOfferCommitAndRedeemCalldata,
  NotYetSupportedError,
} from "@bosonprotocol/x402-evm/actions";

import type { FacilitatorErrorCode } from "../types.js";

/**
 * Structured result form used by every verify-step helper. Lets callers
 * chain steps with early returns without throwing.
 */
export type StepResult = { ok: true } | { ok: false; code: FacilitatorErrorCode; reason: string };

/** Parse the payload against the canonical Zod schema. */
export function validatePayloadStructure(payload: unknown): StepResult {
  const parsed = escrowPaymentPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    return {
      ok: false,
      code: "INVALID_PAYLOAD",
      reason: `payload failed schema validation: ${parsed.error.message}`,
    };
  }
  return { ok: true };
}

/** Parse the requirements against the canonical Zod schema. */
export function validateRequirementsStructure(requirements: unknown): StepResult {
  const parsed = escrowPaymentRequirementsSchema.safeParse(requirements);
  if (!parsed.success) {
    return {
      ok: false,
      code: "INVALID_PAYLOAD",
      reason: `requirements failed schema validation: ${parsed.error.message}`,
    };
  }
  return { ok: true };
}

/** Confirm the outer scheme is `"escrow"` and matches the payload's scheme. */
export function validateScheme(input: {
  scheme: string;
  payload: EscrowPaymentPayload;
}): StepResult {
  if (input.scheme !== "escrow") {
    return {
      ok: false,
      code: "SCHEME_MISMATCH",
      reason: `outer scheme must be "escrow", got "${input.scheme}"`,
    };
  }
  if (input.payload.scheme !== "escrow") {
    return {
      ok: false,
      code: "SCHEME_MISMATCH",
      reason: `payload.scheme must be "escrow", got "${input.payload.scheme}"`,
    };
  }
  return { ok: true };
}

/** Confirm the network is consistent across input, payload, and requirements. */
export function validateNetworkMatch(input: {
  network: EvmNetwork;
  payload: EscrowPaymentPayload;
  requirements: EscrowPaymentRequirements;
}): StepResult {
  if (input.network !== input.payload.network) {
    return {
      ok: false,
      code: "NETWORK_MISMATCH",
      reason: `input.network "${input.network}" != payload.network "${input.payload.network}"`,
    };
  }
  if (input.network !== input.requirements.network) {
    return {
      ok: false,
      code: "NETWORK_MISMATCH",
      reason: `input.network "${input.network}" != requirements.network "${input.requirements.network}"`,
    };
  }
  return { ok: true };
}

/** Confirm the payload's action id is one the requirements advertised. */
export function validateActionInRequirements(input: {
  payload: EscrowPaymentPayload;
  requirements: EscrowPaymentRequirements;
}): StepResult {
  const supported = new Set(input.requirements.actions.next.map((n) => n.id));
  const action = input.payload.payload.action;
  if (!supported.has(action)) {
    return {
      ok: false,
      code: "ACTION_NOT_IN_REQUIREMENTS",
      reason: `payload.action "${action}" is not in requirements.actions.next[].id (${[...supported].join(", ")})`,
    };
  }
  return { ok: true };
}

/** Confirm the payload's echoed offer reference matches the requirements. */
export function validateOfferRefMatchesRequirements(input: {
  payload: EscrowPaymentPayload;
  requirements: EscrowPaymentRequirements;
}): StepResult {
  const payloadOffer = input.payload.payload.offerRef;
  const requirementsOffer = input.requirements.offer;

  if (canonicalJson(payloadOffer.fullOffer) !== canonicalJson(requirementsOffer.fullOffer)) {
    return {
      ok: false,
      code: "INVALID_PAYLOAD",
      reason: "payload.offerRef.fullOffer does not match requirements.offer.fullOffer",
    };
  }
  if (payloadOffer.sellerSig.toLowerCase() !== requirementsOffer.sellerSig.toLowerCase()) {
    return {
      ok: false,
      code: "INVALID_PAYLOAD",
      reason: "payload.offerRef.sellerSig does not match requirements.offer.sellerSig",
    };
  }
  return { ok: true };
}

/** Confirm the signed inner calldata matches the action + offer requirements. */
export function validateMetaTxCalldataMatchesRequirements(input: {
  payload: EscrowPaymentPayload;
  requirements: EscrowPaymentRequirements;
}): StepResult {
  const inner = input.payload.payload;
  const fullOffer = withSellerSignature(input.requirements.offer.fullOffer, input.requirements.offer.sellerSig);

  try {
    const expected =
      inner.action === "boson-createOfferAndCommit"
        ? buildCreateOfferAndCommitCalldata({ fullOffer })
        : inner.action === "boson-createOfferCommitAndRedeem"
          ? buildCreateOfferCommitAndRedeemCalldata({ fullOffer })
          : undefined;

    if (!expected) {
      return {
        ok: false,
        code: "UNSUPPORTED_ACTION",
        reason: `verify() only supports commit-time payment actions, got "${inner.action}"`,
      };
    }

    if (inner.metaTx.functionName !== expected.functionName) {
      return {
        ok: false,
        code: "INVALID_PAYLOAD",
        reason: "payload.metaTx.functionName does not match the expected action selector",
      };
    }
    if (inner.metaTx.functionSignature.toLowerCase() !== expected.functionSignature.toLowerCase()) {
      return {
        ok: false,
        code: "INVALID_PAYLOAD",
        reason: "payload.metaTx.functionSignature does not encode the required offer",
      };
    }
    return { ok: true };
  } catch (e) {
    if (e instanceof NotYetSupportedError) {
      return {
        ok: false,
        code: "UNSUPPORTED_ACTION",
        reason: e.message,
      };
    }
    return {
      ok: false,
      code: "INVALID_PAYLOAD",
      reason: e instanceof Error ? `failed to validate meta-tx calldata: ${e.message}` : "failed to validate meta-tx calldata",
    };
  }
}

/** Confirm the payload's token-auth strategy is one the requirements advertised. */
export function validateTokenAuthStrategyInRequirements(input: {
  payload: EscrowPaymentPayload;
  requirements: EscrowPaymentRequirements;
}): StepResult {
  const strategy = input.payload.payload.tokenAuthStrategy;
  if (!input.requirements.tokenAuthStrategies.includes(strategy)) {
    return {
      ok: false,
      code: "TOKEN_AUTH_NOT_IN_REQUIREMENTS",
      reason: `payload.tokenAuthStrategy "${strategy}" is not in requirements.tokenAuthStrategies (${input.requirements.tokenAuthStrategies.join(", ")})`,
    };
  }
  // Cross-field rule from docs/boson-impl-01-escrow-scheme.md §5: `tokenAuth`
  // must be present iff strategy !== "none".
  const hasTokenAuth = input.payload.payload.tokenAuth !== undefined;
  if (strategy === "none" && hasTokenAuth) {
    return {
      ok: false,
      code: "INVALID_PAYLOAD",
      reason: 'tokenAuth must be omitted when tokenAuthStrategy is "none"',
    };
  }
  if (strategy !== "none" && !hasTokenAuth) {
    return {
      ok: false,
      code: "INVALID_PAYLOAD",
      reason: `tokenAuth is required when tokenAuthStrategy is "${strategy}"`,
    };
  }
  // When present, the discriminator must match the strategy.
  if (hasTokenAuth && strategy !== input.payload.payload.tokenAuth?.kind) {
    return {
      ok: false,
      code: "INVALID_PAYLOAD",
      reason: `tokenAuth.kind "${input.payload.payload.tokenAuth?.kind}" does not match tokenAuthStrategy "${strategy}"`,
    };
  }
  return { ok: true };
}

/**
 * Parse the CAIP-2 EVM network identifier (`eip155:<chainId>`) into a
 * numeric chain id. Returns `NETWORK_MISMATCH` for malformed values.
 */
export function parseChainId(
  network: EvmNetwork,
): { ok: true; chainId: number } | { ok: false; code: FacilitatorErrorCode; reason: string } {
  const m = network.match(/^eip155:(\d+)$/);
  if (!m) {
    return {
      ok: false,
      code: "NETWORK_MISMATCH",
      reason: `network must be CAIP-2 eip155:<chainId>, got "${network}"`,
    };
  }
  return { ok: true, chainId: Number(m[1]) };
}

function withSellerSignature(fullOffer: Record<string, unknown>, sellerSig: string): Record<string, unknown> {
  return { ...fullOffer, signature: sellerSig };
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, sortJson(entry)]),
    );
  }
  return value;
}
