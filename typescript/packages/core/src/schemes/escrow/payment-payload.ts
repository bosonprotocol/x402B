// `escrow` scheme PaymentPayload (client -> server, base64'd in `X-PAYMENT`).
// Source of truth: docs/boson-impl-01-escrow-scheme.md §3.

import { z } from "zod";

import {
  TOKEN_AUTH_STRATEGIES,
  type Address,
  type BosonMetaTx,
  type BosonTokenAuth,
  type EvmNetwork,
  type FullOffer,
  type Hex,
  type TokenAuthStrategy,
} from "./types.js";
import {
  addressSchema,
  decimalUintSchema,
  evmNetworkSchema,
  hex32Schema,
  hexBytesSchema,
  hexSchema,
} from "./validators.js";

const sigSchema = z
  .object({
    v: z.number().int(),
    r: hex32Schema,
    s: hex32Schema,
  })
  .strict();

const metaTxSchema = z
  .object({
    from: addressSchema,
    nonce: decimalUintSchema,
    functionName: z.string().min(1),
    functionSignature: hexBytesSchema,
    sig: sigSchema,
  })
  .strict();

const erc3009DataSchema = z
  .object({
    from: addressSchema,
    to: addressSchema,
    value: decimalUintSchema,
    validAfter: z.number().int().nonnegative(),
    validBefore: z.number().int().nonnegative(),
    nonce: hex32Schema,
    v: z.number().int(),
    r: hex32Schema,
    s: hex32Schema,
  })
  .strict();

const permitDataSchema = z
  .object({
    owner: addressSchema,
    spender: addressSchema,
    value: decimalUintSchema,
    deadline: z.number().int().nonnegative(),
    nonce: decimalUintSchema,
    v: z.number().int(),
    r: hex32Schema,
    s: hex32Schema,
  })
  .strict();

const permit2DataSchema = z
  .object({
    permitted: z
      .object({
        token: addressSchema,
        amount: decimalUintSchema,
      })
      .strict(),
    spender: addressSchema,
    nonce: decimalUintSchema,
    deadline: z.number().int().nonnegative(),
    signature: hexSchema,
  })
  .strict();

const tokenAuthSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("erc3009"), data: erc3009DataSchema }).strict(),
  z.object({ kind: z.literal("permit"), data: permitDataSchema }).strict(),
  z.object({ kind: z.literal("permit2"), data: permit2DataSchema }).strict(),
]);

const tokenAuthStrategySchema = z.enum(
  TOKEN_AUTH_STRATEGIES as readonly [TokenAuthStrategy, ...TokenAuthStrategy[]],
);

/** Inner `payload` field of `EscrowPaymentPayload`. */
export interface EscrowPaymentPayloadInner {
  action: string;
  tokenAuthStrategy: TokenAuthStrategy;
  offerRef: { fullOffer: FullOffer; sellerSig: Hex };
  buyer: Address;
  metaTx: BosonMetaTx;
  /** Required iff `tokenAuthStrategy !== "none"`. */
  tokenAuth?: BosonTokenAuth;
}

/**
 * Wire-format type for the `escrow` PaymentPayload that a client base64's into
 * the `X-PAYMENT` header. See docs/boson-impl-01-escrow-scheme.md §3.
 *
 * `fulfillment.option` is always the buyer's pick from the server-advertised
 * option set (capability negotiation). `fulfillment.data` is action-conditional:
 *
 * - For atomic Flow B (`boson-createOfferCommitAndRedeem`), `data` MUST be
 *   present (or `null` when the option's schema is `null`). Atomic Flow B
 *   completes the redeem on-chain inside the commit transaction, so there's
 *   no later round trip in which the buyer could hand the seller delivery
 *   data — it must travel with `X-PAYMENT`.
 * - For two-step Flow A (`boson-createOfferAndCommit`), `data` MUST be
 *   omitted. The buyer attaches it to the redeem-time POST body that
 *   accompanies `boson-redeem`, after a successful commit. See
 *   `docs/boson-impl-03-fulfillment-channels.md`.
 *
 * The Zod schema parses both shapes structurally; the action-conditional
 * presence/absence rule is enforced by the server-side validator (rule 13).
 */
export interface EscrowPaymentPayload {
  x402Version: number;
  scheme: "escrow";
  network: EvmNetwork;
  payload: EscrowPaymentPayloadInner;
  fulfillment?: { option: string; data?: Record<string, unknown> | null };
}

/**
 * Zod validator paired with `payment_payload.schema.json`. Note: this only
 * validates structural shape; cross-field rules (per docs/boson-impl-01 §5)
 * such as "tokenAuth must be omitted iff tokenAuthStrategy === 'none'" are
 * enforced server-side and are not part of this schema.
 */
export const escrowPaymentPayloadSchema = z
  .object({
    x402Version: z.number().int(),
    scheme: z.literal("escrow"),
    network: evmNetworkSchema,
    payload: z
      .object({
        action: z.string().min(1),
        tokenAuthStrategy: tokenAuthStrategySchema,
        offerRef: z
          .object({
            fullOffer: z.record(z.unknown()),
            sellerSig: hexSchema,
          })
          .strict(),
        buyer: addressSchema,
        metaTx: metaTxSchema,
        tokenAuth: tokenAuthSchema.optional(),
      })
      .strict(),
    fulfillment: z
      .object({
        option: z.string().min(1),
        // `data` is action-conditional (Flow B only). The structural
        // schema accepts both shapes; the server validator enforces
        // presence vs absence based on `payload.action`.
        data: z.union([z.record(z.unknown()), z.null()]).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export function parseEscrowPaymentPayload(value: unknown): EscrowPaymentPayload {
  return escrowPaymentPayloadSchema.parse(value);
}
