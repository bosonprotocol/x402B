// Boson exchange state machine — pure data.
//
// Source of truth: docs/boson-impl-04-state-machine-and-next-actions.md.
// Execution semantics (channel selection, deadline math, channel fallback,
// `nextActions` envelope construction) belong in
// `@bosonprotocol/x402-actions`; this module just owns the static shape.

export * from "./states.js";
export * from "./action-ids.js";
export * from "./transitions.js";
