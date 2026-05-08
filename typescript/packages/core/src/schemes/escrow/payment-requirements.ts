// `escrow` scheme PaymentRequirements (server -> client, in 402 body).
// Source of truth: docs/boson-impl-01-escrow-scheme.md §2.

import { z } from "zod";

import {
  ACTION_CHANNELS,
  TOKEN_AUTH_STRATEGIES,
  type ActionChannel,
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
        })
        .strict(),
    ),
  })
  .strict();

const actionsSchema = z
  .object({
    next: z
      .array(
        z
          .object({
            id: z.string().min(1),
            channels: z
              .array(z.enum(ACTION_CHANNELS as readonly [ActionChannel, ...ActionChannel[]]))
              .min(1),
            endpoints: z.record(z.string()).optional(),
          })
          .strict(),
      )
      .min(1),
    fallback: z
      .object({
        xmtp: z.string().optional(),
        mcp: z.string().optional(),
        onchainHints: z
          .object({
            escrow: addressSchema,
            metaTxFacet: z.string().min(1),
            metaTxEntrypoint: z.string().min(1),
            actionFacets: z.record(z.string()),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
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
    tokenAuthStrategies: z.array(tokenAuthStrategySchema).min(1),
    fulfillment: fulfillmentSchema.optional(),
    actions: actionsSchema,
  })
  .strict();

/** Type-guard form. Returns the parsed value on success, throws on failure (with a `ZodError` carrying the field path). */
export function parseEscrowPaymentRequirements(value: unknown): EscrowPaymentRequirements {
  return escrowPaymentRequirementsSchema.parse(value);
}
