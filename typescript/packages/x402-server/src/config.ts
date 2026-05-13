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

/**
 * zod validator for `X402bServerConfig`. Shallow on the signer +
 * signer (viem account types bring their own structural validators);
 * strict on the scalar fields we own here and on the channel registry
 * via `@bosonprotocol/x402-actions`.
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
