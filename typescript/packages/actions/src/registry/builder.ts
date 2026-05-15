// `buildChannelRegistry` — ergonomic constructor + zod validator for
// `ChannelRegistry`. Catches mistakes in seller config at boot time
// rather than letting them silently leak into `nextActions` envelopes
// that fail downstream client validation.
//
// Source of truth: docs/boson-impl-04-state-machine-and-next-actions.md
// §"Channels".

import { addressSchema } from "@bosonprotocol/x402-core/schemes/escrow";
import { ACTION_IDS, type ActionId } from "@bosonprotocol/x402-core/state-machine";
import { z } from "zod";

import { CHANNEL_IDS, type Channel } from "../channels/index.js";
import type { ChannelRegistry } from "./index.js";

const channelSchema = z.enum(CHANNEL_IDS as readonly [Channel, ...Channel[]]);

const actionIdSchema = z.enum(ACTION_IDS as readonly [ActionId, ...ActionId[]]);

const httpsUrlSchema = z
  .string()
  .url()
  .refine((u) => u.startsWith("http://") || u.startsWith("https://"), {
    message: "must be an http(s) URL",
  });

const channelRegistrySchema = z
  .object({
    channels: z
      .array(channelSchema)
      .min(1, { message: "at least one channel is required" })
      .refine((channels) => new Set(channels).size === channels.length, {
        message: "channels must contain unique items",
      }),
    endpoints: z.record(actionIdSchema, httpsUrlSchema).optional(),
    xmtp: addressSchema.optional(),
    mcp: z.string().min(1).optional(),
    escrow: addressSchema,
  })
  .strict();

/**
 * Build a validated `ChannelRegistry` from raw seller config. Throws a
 * `ZodError` (with field-level paths) on bad input — invalid URL,
 * malformed address, duplicate channel id, unknown action id, etc.
 *
 * Usage:
 *
 * ```ts
 * const registry = buildChannelRegistry({
 *   channels: ["server", "facilitator", "onchain", "mcp"],
 *   endpoints: {
 *     "boson-redeem": "https://seller.example/x402b/redeem",
 *   },
 *   xmtp: "0xSellerXMTP...",
 *   mcp: "boson://seller/12345",
 *   escrow: "0xDIAMOND...",
 * });
 * ```
 */
export function buildChannelRegistry(input: ChannelRegistry): ChannelRegistry {
  return channelRegistrySchema.parse(input) as ChannelRegistry;
}

/**
 * Schema-only export for callers that want to validate without
 * throwing — `safeParse` returns a discriminated `{ success, data |
 * error }`.
 */
export const channelRegistryZodSchema = channelRegistrySchema;
