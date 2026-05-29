# @bosonprotocol/x402-actions

## 0.2.0

### Minor Changes

- 78f6f48: Add channel-registry helpers to `@bosonprotocol/x402-actions`:
  - `buildChannelRegistry(input)` and `channelRegistryZodSchema` —
    zod-validated constructor for `ChannelRegistry`. Catches malformed
    URLs, malformed addresses, duplicate channel ids, unknown channel
    ids, and unknown action-id keys at boot time rather than letting
    bad config silently leak into `nextActions` envelopes.
  - `BUYER_ONCHAIN_FALLBACK`, `hasBuyerOnchainFallback(entry)`, and
    `isBuyerOnchainResilient(id)` — codify the censorship-resistance
    table from
    docs/boson-impl-04-state-machine-and-next-actions.md
    §"Censorship resistance — guarantees", letting clients short-circuit
    channel fallback to direct on-chain submission when the seller's
    preferred channels are unreachable.

- 1d7ec97: Add `deriveNextActions` and `deriveInitialNextActions` to
  `@bosonprotocol/x402-actions` — pure envelope builders that read the
  client-invokable transitions from `x402-core`'s state-machine tables
  and stamp them with the seller's configured channels, endpoints, and
  optional deadlines.

  In `@bosonprotocol/x402-core`:
  - Add the post-commit `EscrowNextActions` type, its zod validator
    (`escrowNextActionsSchema` / `parseEscrowNextActions`), and the JSON
    Schema `next_actions.schema.json` (re-exported under
    `./schemas/next_actions.schema.json`). The type and schema encode the
    spec invariant that `exchangeState === DISPUTED` ↔ `disputeState` is
    present.
  - Extend the `NextAction` wire-format type and the
    `payment_requirements.schema.json` `actions.next[]` items with an
    optional ISO 8601 `deadline` field (relevant for
    dispute-window-bounded actions).

- d783bb1: Auto-stamp `fallback.onchainHints` in the `nextActions` envelope.

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

- 8979b85: Initial skeleton for `@bosonprotocol/x402-actions`: ships the
  `NextActionsEnvelope` / `ActionEntry` types, the `Channel` /
  `CHANNEL_IDS` registry constants, the thin `ChannelAdapter` contract,
  and the `ChannelRegistry` config type. The build/test/postbuild
  conventions match `@bosonprotocol/x402-core` and
  `@bosonprotocol/x402-fulfillment`, with subpath exports for
  `./channels`, `./registry`, and `./schemas/*`. No `deriveNextActions`
  implementation, channel adapters, or registry helpers yet.

### Patch Changes

- e151ec6: Cleanup pass on stale references.

  Breaking change for `@bosonprotocol/x402-facilitator`: remove the unused
  `NotImplementedError` export and the `"NOT_IMPLEMENTED"` member of
  `FacilitatorErrorCode`. These were public API symbols, even though the
  facilitator implementation no longer throws them.
  - Update the stale Flow B comment in
    `@bosonprotocol/x402-server-express`'s middleware that claimed the
    shipped client could not yet sign the atomic
    `createOfferCommitAndRedeem` entry point.
  - Replace the `boson-protocol-contracts` PR-number reference in
    `@bosonprotocol/x402-core`'s `ACTION_FACETS` JSDoc with a durable
    facet-only reference, per the repo's "no PR-number references in
    source" rule.
  - Align documentation, JSDoc examples, test fixtures, and the Express
    convenience-route docs with the canonical `/x402B` route mount while
    keeping the legacy `/x402b` default alias for existing consumers.
  - Keep the `bosonprotocol/x402B` casing in package `repository` /
    `homepage` / `bugs` URLs and README links.
  - Drop the unused `@x402/core` dependency from `@bosonprotocol/x402-core`'s
    `package.json`; keep `lodash` because `@bosonprotocol/core-sdk` still
    requires `lodash/groupBy` at runtime under pnpm's strict resolution.

- Updated dependencies [bae937f]
- Updated dependencies [e151ec6]
- Updated dependencies [1d7ec97]
- Updated dependencies [79d2cfc]
- Updated dependencies [d783bb1]
- Updated dependencies [0aae992]
  - @bosonprotocol/x402-core@0.2.0
