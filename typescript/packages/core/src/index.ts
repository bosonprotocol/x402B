// Public API for @bosonprotocol/x402-core.
//
// Shared types, EIP-712 builders, and state machine live under their
// own subpath exports (`/eip712`, `/schemes/escrow`, `/state-machine`,
// …); the root entry point exposes only constants that are part of the
// cross-package wire contract.

export { SESSION_ID_HEADER } from "./headers.js";
