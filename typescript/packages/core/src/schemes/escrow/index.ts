// Public surface for the `escrow` scheme.
// See docs/boson-impl-01-escrow-scheme.md for the wire format.

export * from "./types.js";
export * from "./payment-requirements.js";
export * from "./payment-payload.js";
export * from "./next-actions.js";
export * from "./validators.js";

/** Stable identifier for the scheme. Use this in place of the raw string `"escrow"` to avoid typos. */
export const ESCROW_SCHEME = "escrow" as const;
export type EscrowScheme = typeof ESCROW_SCHEME;
