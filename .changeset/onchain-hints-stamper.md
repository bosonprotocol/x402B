---
"@bosonprotocol/x402-actions": minor
"@bosonprotocol/x402-core": minor
---

Auto-stamp `fallback.onchainHints` in the `nextActions` envelope.

In `@bosonprotocol/x402-core`: add `ACTION_FACETS: Record<ActionId,
string>` to `state-machine` — the canonical action-id → Boson Diamond
facet mapping (e.g. `boson-redeem` → `ExchangeHandlerFacet`,
`boson-raiseDispute` → `DisputeHandlerFacet`). The keys are exhaustive
over `ActionId` so adding a new action forces a paired facet entry.

In `@bosonprotocol/x402-actions`:

- Add `buildOnchainHints(escrow, actionIds)`, `actionFacetsFor(actionIds)`,
  and the `META_TX_FACET` / `META_TX_ENTRYPOINT` constants — pure
  helpers that bundle `ACTION_FACETS` with the BPIP-12 meta-tx
  entry-point names.
- Refactor `ChannelRegistry`: replace the nested
  `fallback: ActionsFallback` block with discrete top-level fields
  (`xmtp?`, `mcp?`, `escrow?`). When `escrow` is set, the envelope's
  `fallback.onchainHints` is populated automatically from the emitted
  action ids — sellers no longer maintain that mapping by hand.
- Wire the stamper into `deriveNextActions` /
  `deriveInitialNextActions`. PR-2 tests updated.
