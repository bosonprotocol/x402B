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
  and the `META_TX_FACET` / `META_TX_ENTRYPOINTS` constants — pure
  helpers that bundle `ACTION_FACETS` with the BPIP-12 meta-tx
  entry-point names. `META_TX_ENTRYPOINTS` is keyed by
  `TokenAuthStrategy`: `none` → `executeMetaTransaction` (legacy
  BPIP-9), the other three → BPIP-12's
  `executeMetaTransactionWithTokenTransferAuthorization`.
- Refactor `ChannelRegistry`: replace the nested
  `fallback: ActionsFallback` block with discrete top-level fields
  (`xmtp?`, `mcp?`, required `escrow`). The envelope's
  `fallback.onchainHints` is populated automatically from
  `registry.escrow` plus the emitted action ids — sellers no longer
  maintain that mapping by hand, and the `onchain` channel is
  guaranteed reachable for every emitted action.
- Wire the stamper into `deriveNextActions` /
  `deriveInitialNextActions`. PR-2 tests updated.
