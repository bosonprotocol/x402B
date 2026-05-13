// Shared zod fragments used by both `payment-requirements.ts` (the
// pre-commit / 402 envelope) and `next-actions.ts` (the post-commit
// envelope). Centralised here so the two wire-format validators can't
// drift on shared sub-shapes like an action entry, the `fallback` block,
// or the `onchainHints` block.

import { z } from "zod";

import { ACTION_CHANNELS, type ActionChannel } from "./types.js";
import { addressSchema } from "./validators.js";

/** ISO 8601 absolute timestamp with timezone offset. */
export const actionDeadlineSchema = z.string().datetime({ offset: true });

/** Non-empty unique `ActionChannel[]` for `next[i].channels`. */
export const actionChannelsSchema = z
  .array(z.enum(ACTION_CHANNELS as readonly [ActionChannel, ...ActionChannel[]]))
  .min(1)
  .refine((channels) => new Set(channels).size === channels.length, {
    message: "channels must contain unique items",
  });

/** Single entry in the `next[]` array of any `nextActions` envelope. */
export const actionEntrySchema = z
  .object({
    id: z.string().min(1),
    channels: actionChannelsSchema,
    endpoints: z.record(z.string()).optional(),
    deadline: actionDeadlineSchema.optional(),
  })
  .strict();

/**
 * Per-`tokenAuthStrategy` meta-tx entry points on
 * `onchainHints.metaTxFacet`. All four strategies are required so
 * clients can resolve any strategy they happen to advertise.
 */
export const metaTxEntrypointsSchema = z
  .object({
    none: z.string().min(1),
    erc3009: z.string().min(1),
    permit: z.string().min(1),
    permit2: z.string().min(1),
  })
  .strict();

/** `fallback.onchainHints` block. */
export const onchainHintsSchema = z
  .object({
    escrow: addressSchema,
    metaTxFacet: z.string().min(1),
    metaTxEntrypoints: metaTxEntrypointsSchema,
    actionFacets: z.record(z.string()),
  })
  .strict();

/** `fallback` block embedded in any `nextActions` envelope. */
export const actionsFallbackSchema = z
  .object({
    xmtp: z.string().optional(),
    mcp: z.string().optional(),
    onchainHints: onchainHintsSchema.optional(),
  })
  .strict();
