---
"@bosonprotocol/x402-facilitator": minor
---

Implement `performAction()`: relays post-commit meta-transactions
(`boson-redeem`, `boson-completeExchange`, `boson-cancelVoucher`,
`boson-revokeVoucher`, `boson-raiseDispute`, `boson-retractDispute`,
`boson-escalateDispute`, `boson-resolveDispute`) through the same
`executeMetaTransaction` envelope used by `settle()`. `signedPayload` is
the ABI-encoded `BosonMetaTx` tuple — `encodeSignedPayload` /
`decodeSignedPayload` codec helpers are exported for client SDKs.

`FacilitatorPerformActionInput` now carries `network` and
`escrowAddress` alongside `exchangeId`, `action`, and `signedPayload` —
the facilitator needs both to dispatch to the right Diamond on the
right chain. The spec doc has been updated in lockstep.

Returns `{ txHash, newExchangeState, newDisputeState? }` so callers can
update local state without re-querying the protocol; the state lookup
is a pure read of `ACTION_POST_STATE` in
`@bosonprotocol/x402-core/state-machine`.
