---
"@bosonprotocol/x402-evm": minor
"@bosonprotocol/x402-core": patch
---

Initial release of `@bosonprotocol/x402-evm` — EVM-specific calldata
helpers for the x402B `escrow` scheme that are **not already covered by
`@bosonprotocol/core-sdk`**. Subpaths:

- `./actions` — `buildCreateOfferAndCommitCalldata` for the commit-step
  inner action. Returns the `{ functionName, functionSignature }` pair
  that feeds the meta-tx typed-data the buyer signs.
- `./envelope` — `buildExecuteMetaTransactionTx` over the existing
  Boson `MetaTransactionsHandlerFacet.executeMetaTransaction(...)`
  entrypoint.

Two builders ship as throwing `NotYetSupportedError` stubs until the
underlying primitives land upstream:

- `buildCreateOfferCommitAndRedeemCalldata` — atomic
  `OrchestrationHandlerFacet2.createOfferCommitAndRedeem` (Boson
  contracts PR #1105).
- `buildExecuteMetaTransactionWithTokenAuthTx` — BPIP-12
  `executeMetaTransactionWithTokenTransferAuthorization` envelope.

Post-commit transitions (`redeem`, `complete`, `cancel`, `revoke`,
`raise/retract/escalate/resolve` dispute) are intentionally NOT
re-implemented: each one is already fully covered by core-sdk's
`metaTx.handler.signMetaTxXxx` (meta-tx path, each with its bespoke
EIP-712 type) and `exchanges.iface.encode*` / the public
`IBosonDisputeHandlerABI` (direct-call path). The README documents the
recommended call patterns.

Also extracts the shared throwing / typed-data-intercepting
`Web3LibAdapter` stub factories into
`@bosonprotocol/x402-core/internal/web3lib-stub.ts` so the existing
`full-offer` and `meta-transaction` EIP-712 builders share one
loud-error idiom.
