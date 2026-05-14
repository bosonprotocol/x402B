// 402 challenge builder — assembles an `EscrowPaymentRequirements`
// from per-offer inputs (asset, amount, fulfillment, etc.) plus the
// signed `BosonOfferRef` and the server's channel registry. The
// initial `nextActions` envelope is filled via
// `deriveInitialNextActions(registry)` so the legal transitions out
// of `PRE_COMMIT` are always populated consistently.
//
// Source of truth: docs/boson-impl-01-escrow-scheme.md §2.

import { deriveInitialNextActions, type ChannelRegistry } from "@bosonprotocol/x402-actions";
import {
  escrowPaymentRequirementsSchema,
  type Address,
  type BosonOfferRef,
  type EscrowPaymentRequirements,
  type EvmNetwork,
  type FulfillmentRequirements,
  type TokenAuthStrategy,
} from "@bosonprotocol/x402-core/schemes/escrow";

export interface BuildPaymentRequirementsArgs {
  /** Signed offer reference — usually from `signFullOffer`. */
  offer: BosonOfferRef;
  /** ERC-20 token address the buyer pays in. */
  asset: Address;
  /** Atomic amount as a decimal string (e.g. wei). */
  amount: string;
  /** Token-auth strategies the server is willing to accept. */
  tokenAuthStrategies: readonly TokenAuthStrategy[];
  /** Routing-only seller identifier — numeric sellerId, `did:boson:seller:N`, or wallet address. */
  recipientId: string;
  /** Upper bound for `validBefore` / `deadline` in token-auth payloads. */
  maxTimeoutSeconds: number;
  /** Optional fulfillment channel options. Absent or `{required: false}` means the server treats payment as fully atomic. */
  fulfillment?: FulfillmentRequirements;
  /** CAIP-2 network identifier (e.g. `eip155:8453`). */
  network: EvmNetwork;
  /** Boson Diamond address — same as `config.escrow`. */
  escrow: Address;
  /** Per-seller channel registry consumed by `deriveInitialNextActions`. */
  channelRegistry: ChannelRegistry;
}

/**
 * Build an `EscrowPaymentRequirements` body (the entry that lives
 * inside the 402 response's `accepts[]` array). The result is
 * round-tripped through `escrowPaymentRequirementsSchema` to fail
 * loudly if any caller-provided field violates the wire format.
 */
export function buildPaymentRequirements(
  args: BuildPaymentRequirementsArgs,
): EscrowPaymentRequirements {
  const {
    offer,
    asset,
    amount,
    tokenAuthStrategies,
    recipientId,
    maxTimeoutSeconds,
    fulfillment,
    network,
    escrow,
    channelRegistry,
  } = args;

  const actions = deriveInitialNextActions(channelRegistry);

  const requirements: EscrowPaymentRequirements = {
    scheme: "escrow",
    network,
    asset,
    amount,
    escrowAddress: escrow,
    recipientId,
    maxTimeoutSeconds,
    offer,
    tokenAuthStrategies: [...tokenAuthStrategies],
    ...(fulfillment !== undefined ? { fulfillment } : {}),
    actions,
  };

  return escrowPaymentRequirementsSchema.parse(requirements) as EscrowPaymentRequirements;
}
