// X402bServerConfig — the per-server context passed to
// `createX402bServer`. The config holds everything that doesn't vary
// per request: the network + escrow address, the seller's signer, the
// facilitator URL (for both the future HTTP client and the public
// advertisement embedded in `nextActions[].endpoints.facilitator`),
// and the channel registry consumed by `deriveNextActions`.
//
// Per-offer values (price, asset, fulfillment, etc.) come in through
// the per-request `buildPaymentRequirements` call instead — see
// `./challenge/build-requirements.ts`.

import { channelRegistryZodSchema, type ChannelRegistry } from "@bosonprotocol/x402-actions";
import {
  addressSchema,
  evmNetworkSchema,
  hexSchema,
  type Address,
  type EvmNetwork,
} from "@bosonprotocol/x402-core/schemes/escrow";
import type { Hex } from "viem";
import { z } from "zod";

import type { ExchangeReader } from "./onchain/verify-exchange.js";

/**
 * Minimal signing surface needed by `signFullOffer`. Structurally
 * compatible with viem's `Account` (in particular `LocalAccount` from
 * `privateKeyToAccount`), but kept narrow so consumers can plug in
 * HSM- / KMS- / ERC-1271-backed signers without depending on viem's
 * internal account types.
 */
export interface SellerSigner {
  /** Address that the EIP-712 signature must recover to (`creator` in `BosonOfferRef`). */
  readonly address: Address;
  /** EIP-712 typed-data signer. Accepts the same shape viem's `signTypedData` does. */
  signTypedData: (params: {
    domain: Record<string, unknown>;
    types: Record<string, readonly { name: string; type: string }[]>;
    primaryType: string;
    message: Record<string, unknown>;
  }) => Promise<Hex>;
}

/**
 * Per-server configuration. Validated by `x402bServerConfigSchema` at
 * `createX402bServer` time so bad config fails fast at boot rather than
 * later inside a 402 response.
 */
export interface X402bServerConfig {
  /** CAIP-2 EVM network the server advertises (e.g. `eip155:8453`). */
  network: EvmNetwork;
  /** EVM chain id matching `network` — passed straight to the EIP-712 builder's salt. */
  chainId: number;
  /** Address of the Boson Diamond — the EIP-712 `verifyingContract` and the wire-level `escrowAddress`. */
  escrow: Address;
  /** Seller signer (signs the FullOffer EIP-712 typed-data). */
  signer: SellerSigner;
  /** Facilitator service the server forwards meta-tx envelopes to. The URL is also advertised in `nextActions[].endpoints.facilitator`. */
  facilitator: { url: string };
  /** Per-seller channel + endpoint registry consumed by `deriveNextActions`. */
  channelRegistry: ChannelRegistry;
  /**
   * Reader the convenience handlers use to verify the post-settle /
   * post-perform-action exchange state. Required at runtime when any
   * write handler is invoked; the `signOffer` / `buildPaymentRequirements`
   * read-only paths don't touch it. See `./onchain/verify-exchange.ts`
   * for the interface.
   */
  exchangeReader?: ExchangeReader;
  /**
   * Server-side store of the buyer wallet that originally committed
   * each exchange (keyed by `exchangeId`). Populated on Flow A commit
   * acceptance and read at redeem time to detect voucher transfers —
   * a redeemer whose wallet differs from the recorded committer MUST
   * supply fresh `fulfillment` data; same-wallet redeemers MAY.
   *
   * Optional in the config: when omitted, `createX402bServer` wires up
   * an in-memory `Map`. Hosts that need cross-process / persistent
   * tracking supply their own `Map`-shaped backing store.
   */
  exchangeBuyerStore?: Map<string, Address>;
  /**
   * Fulfillment channels the server accepts at redeem time when the
   * client re-submits delivery data. Structurally a subset of
   * `@bosonprotocol/x402-fulfillment`'s `FulfillmentChannel` — only
   * `id`, `validate`, and `onCommit` are read here, so existing
   * channel instances pass through directly. Required iff a host
   * wants to accept redeem-time fulfillment updates; absent means
   * redeem requests carrying `fulfillment` are rejected with
   * `FULFILLMENT_CHANNELS_NOT_CONFIGURED`.
   */
  fulfillmentChannels?: readonly RedeemFulfillmentChannel[];
}

/**
 * Minimal structural slice of `FulfillmentChannel` the redeem
 * handler needs. Kept inline so `@bosonprotocol/x402-server` does
 * not depend on `@bosonprotocol/x402-fulfillment` (avoids a hard
 * coupling between the resource-server SDK and a specific channel
 * package); any real channel implementation is type-compatible.
 */
export interface RedeemFulfillmentChannel {
  readonly id: string;
  validate(data: Record<string, unknown> | null): { ok: true } | { ok: false; reason: string };
  onCommit(exchangeId: string, data: Record<string, unknown> | null): Promise<void>;
}

const httpUrlSchema = z
  .string()
  .url()
  .refine((url) => url.startsWith("http://") || url.startsWith("https://"), {
    message: "must be an http(s) URL",
  });

const sellerSignerSchema = z
  .object({
    address: addressSchema,
    // `SellerSigner.signTypedData` is typed `Promise<Hex>` in the TS
    // interface — tighten the zod return wrapper to match so a signer
    // that resolves to a non-hex string fails loudly at call time
    // rather than silently producing a bad `BosonOfferRef.sellerSig`.
    signTypedData: z.function().args(z.unknown()).returns(z.promise(hexSchema)),
  })
  .passthrough();

const exchangeReaderShallowSchema = z
  .object({
    read: z.function().args(z.string()).returns(z.unknown()),
  })
  .passthrough();

const fulfillmentChannelShallowSchema = z
  .object({
    id: z.string().min(1),
    validate: z.function(),
    onCommit: z.function(),
  })
  .passthrough();

/**
 * zod validator for `X402bServerConfig`. Shallow on the signer +
 * exchange reader (viem account types bring their own structural
 * validators; the user-supplied reader impl is structurally typed);
 * strict on the scalar fields we own here, and on the channel
 * registry via `@bosonprotocol/x402-actions`.
 */
export const x402bServerConfigSchema = z
  .object({
    network: evmNetworkSchema,
    chainId: z.number().int().positive(),
    escrow: addressSchema,
    signer: sellerSignerSchema,
    facilitator: z
      .object({
        url: httpUrlSchema,
      })
      .strict(),
    channelRegistry: channelRegistryZodSchema,
    exchangeReader: exchangeReaderShallowSchema.optional(),
    exchangeBuyerStore: z.instanceof(Map).optional(),
    fulfillmentChannels: z
      .array(fulfillmentChannelShallowSchema)
      .superRefine((channels, ctx) => {
        // Duplicate ids would let one channel silently shadow another
        // (the redeem handler picks via `find(c => c.id === option)`).
        const seen = new Set<string>();
        const duplicates = new Set<string>();
        for (const c of channels) {
          if (seen.has(c.id)) duplicates.add(c.id);
          seen.add(c.id);
        }
        if (duplicates.size > 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `fulfillmentChannels has duplicate id(s): ${[...duplicates].join(", ")}`,
          });
        }
      })
      .optional(),
  })
  .strict()
  .superRefine((cfg, ctx) => {
    // CAIP-2 `eip155:<chainId>` carries the chainId; assert it matches
    // the explicit `chainId` field so the EIP-712 salt and the
    // wire-level network advertisement agree. Catches the easy
    // copy-paste mistake of pairing `eip155:8453` with `chainId: 1`.
    const networkChainId = Number(cfg.network.split(":")[1]);
    if (networkChainId !== cfg.chainId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["chainId"],
        message: `chainId (${cfg.chainId}) must match network (${cfg.network})`,
      });
    }
  });

/**
 * Cross-field invariant: `config.escrow` and
 * `config.channelRegistry.escrow` must agree — the Diamond address is
 * the same on both sides. Run this after `x402bServerConfigSchema.parse`.
 */
export function assertChannelRegistryEscrowMatch(config: X402bServerConfig): void {
  if (config.escrow.toLowerCase() !== config.channelRegistry.escrow.toLowerCase()) {
    throw new Error(
      `x402-server config: escrow (${config.escrow}) does not match channelRegistry.escrow (${config.channelRegistry.escrow})`,
    );
  }
}
