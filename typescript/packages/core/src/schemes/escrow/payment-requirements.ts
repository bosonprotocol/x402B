// `escrow` scheme PaymentRequirements (server -> client, in 402 body).
// Source of truth: docs/boson-impl-01-escrow-scheme.md §2.

import { z } from "zod";

import { actionEntrySchema, actionsFallbackSchema } from "./shared-schemas.js";
import {
  TOKEN_AUTH_STRATEGIES,
  type ActionsEnvelope,
  type Address,
  type BosonOfferRef,
  type EvmNetwork,
  type FulfillmentRequirements,
  type TokenAuthStrategy,
} from "./types.js";
import { addressSchema, decimalUintSchema, evmNetworkSchema, hexSchema } from "./validators.js";

const offerRefSchema = z
  .object({
    fullOffer: z.record(z.unknown()),
    sellerSig: hexSchema,
    creator: addressSchema,
  })
  .strict();

const tokenAuthStrategySchema = z.enum(
  TOKEN_AUTH_STRATEGIES as readonly [TokenAuthStrategy, ...TokenAuthStrategy[]],
);

const fulfillmentSchema = z
  .object({
    required: z.boolean(),
    options: z.array(
      z
        .object({
          id: z.string().min(1),
          schema: z.union([z.record(z.unknown()), z.null()]),
          metadata: z.unknown().optional(),
        })
        .strict(),
    ),
  })
  .strict();

// Pre-commit (initial 402) `actions` envelope: `next[]` must be
// non-empty (the buyer needs at least one path to commit) and the
// `fallback` block is optional.
const actionsSchema = z
  .object({
    next: z.array(actionEntrySchema).min(1),
    fallback: actionsFallbackSchema.optional(),
  })
  .strict();

/**
 * Wire-format type for the `escrow` PaymentRequirements that a server emits
 * inside a 402 `accepts[]` entry. See docs/boson-impl-01-escrow-scheme.md §2
 * for field semantics.
 */
export interface EscrowPaymentRequirements {
  scheme: "escrow";
  network: EvmNetwork;
  asset: Address;
  /** Atomic units, decimal string. */
  amount: string;
  /** Address of the Boson escrow contract — the custodian. */
  escrowAddress: Address;
  /** Routing-only seller identifier. May be a numeric `sellerId`, a `did:boson:seller:N`, or a wallet address. */
  recipientId: string;
  maxTimeoutSeconds: number;
  offer: BosonOfferRef;
  tokenAuthStrategies: TokenAuthStrategy[];
  fulfillment?: FulfillmentRequirements;
  actions: ActionsEnvelope;
}

/** Zod validator paired with `payment_requirements.schema.json`. */
export const escrowPaymentRequirementsSchema = z
  .object({
    scheme: z.literal("escrow"),
    network: evmNetworkSchema,
    asset: addressSchema,
    amount: decimalUintSchema,
    escrowAddress: addressSchema,
    recipientId: z.string().min(1),
    maxTimeoutSeconds: z.number().int().positive(),
    offer: offerRefSchema,
    tokenAuthStrategies: z
      .array(tokenAuthStrategySchema)
      .min(1)
      .refine((strategies) => new Set(strategies).size === strategies.length, {
        message: "tokenAuthStrategies must not contain duplicates",
      }),
    fulfillment: fulfillmentSchema.optional(),
    actions: actionsSchema,
  })
  .strict();

/** Type-guard form. Returns the parsed value on success, throws on failure (with a `ZodError` carrying the field path). */
export function parseEscrowPaymentRequirements(value: unknown): EscrowPaymentRequirements {
  return escrowPaymentRequirementsSchema.parse(value);
}
