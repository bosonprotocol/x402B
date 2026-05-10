// Post-commit `nextActions` envelope (top level of every response after
// the initial 402). The pre-commit variant lives nested inside
// `EscrowPaymentRequirements.actions` — see `payment-requirements.ts`.
//
// Source of truth: docs/boson-impl-04-state-machine-and-next-actions.md
// §"`nextActions` envelope" and `schemas/next_actions.schema.json`.

import { z } from "zod";

import { DisputeState, ExchangeState } from "../../state-machine/states.js";
import {
  ACTION_CHANNELS,
  type ActionChannel,
  type ActionsFallback,
  type NextAction,
} from "./types.js";
import { addressSchema } from "./validators.js";

/**
 * Wire-format type for the post-commit `nextActions` envelope.
 *
 * The `exchangeState === DISPUTED ↔ disputeState present` invariant is
 * encoded structurally: `exchangeState: DISPUTED` requires
 * `disputeState`, and any other `exchangeState` forbids it. The zod
 * validator below enforces the same invariant at runtime.
 *
 * The wire field is named `exchangeState` (not `state`) for symmetry
 * with `disputeState` and to remove ambiguity with the `state` field
 * the subgraph entity itself carries.
 */
export type EscrowNextActions = {
  exchangeId: string;
  next: NextAction[];
  fallback?: ActionsFallback;
} & (
  | {
      exchangeState: Exclude<ExchangeState, typeof ExchangeState.DISPUTED>;
      disputeState?: never;
    }
  | { exchangeState: typeof ExchangeState.DISPUTED; disputeState: DisputeState }
);

const exchangeStateSchema = z.nativeEnum(ExchangeState);
const disputeStateSchema = z.nativeEnum(DisputeState);

const nextActionSchema = z
  .object({
    id: z.string().min(1),
    channels: z
      .array(z.enum(ACTION_CHANNELS as readonly [ActionChannel, ...ActionChannel[]]))
      .min(1)
      .refine((channels) => new Set(channels).size === channels.length, {
        message: "channels must contain unique items",
      }),
    endpoints: z.record(z.string()).optional(),
    deadline: z.string().datetime({ offset: true }).optional(),
  })
  .strict();

const fallbackSchema = z
  .object({
    xmtp: z.string().optional(),
    mcp: z.string().optional(),
    onchainHints: z
      .object({
        escrow: addressSchema,
        metaTxFacet: z.string().min(1),
        metaTxEntrypoints: z
          .object({
            none: z.string().min(1),
            erc3009: z.string().min(1),
            permit: z.string().min(1),
            permit2: z.string().min(1),
          })
          .strict(),
        actionFacets: z.record(z.string()),
      })
      .strict()
      .optional(),
  })
  .strict()
  .optional();

/** Zod validator paired with `next_actions.schema.json`. */
export const escrowNextActionsSchema = z
  .object({
    exchangeId: z.string().min(1),
    exchangeState: exchangeStateSchema,
    disputeState: disputeStateSchema.optional(),
    next: z.array(nextActionSchema),
    fallback: fallbackSchema,
  })
  .strict()
  .refine(
    (envelope) =>
      envelope.exchangeState === ExchangeState.DISPUTED
        ? envelope.disputeState !== undefined
        : envelope.disputeState === undefined,
    {
      message: "disputeState is required iff exchangeState === DISPUTED",
      path: ["disputeState"],
    },
  );

/** Type-guard form. Returns the parsed value on success, throws on failure. */
export function parseEscrowNextActions(value: unknown): EscrowNextActions {
  return escrowNextActionsSchema.parse(value) as EscrowNextActions;
}
