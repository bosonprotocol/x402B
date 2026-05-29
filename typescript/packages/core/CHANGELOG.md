# @bosonprotocol/x402-core

## 0.2.0

### Minor Changes

- bae937f: Add the v0.1 fulfillment-channel registry to
  `@bosonprotocol/x402-fulfillment`. Method names and types align with
  the upstream `x402-escrow-schema` v0.1 spec (`onFulfill` /
  `FulfillmentResult.kind: "inline"`).
  - `inline` — schemaless; `onFulfill` returns the resource body
    resolved by a server-supplied `resolve(exchangeId)` callback.
  - `email` — buyer attaches `{ email }`; server stores by exchange id
    and dispatches via the configured `send` hook at fulfill time;
    returns a `mailto:<email>` async pointer.
  - `xmtp` — buyer attaches `{ xmtpAddress: <0x…> }`; server stores
    and pushes via `send`; returns an `xmtp:<address>` async pointer.
    Reuses `addressSchema` from `@bosonprotocol/x402-core/schemes/escrow`.
  - `webhook` — buyer attaches `{ url, authToken?, encryptionPubKey? }`
    (https only); server stores and dispatches via `send`; returns the
    buyer's url as the pointer. Buyer-side endpoint protection is
    layered (server signature with timestamp + idempotency, optional
    bearer token, optional encryption pubkey); see the "Webhook
    security" section in `docs/boson-impl-03-fulfillment-channels.md`.
  - `ipfs-pointer` — buyer optionally attaches `{ recipientPubKey? }`;
    server hands data to the `upload(exchangeId, data)` hook which
    returns the IPFS CID; channel returns `ipfs://<cid>` as the
    async pointer.

  The four data-at-commit channels (email, xmtp, webhook, ipfs-pointer)
  share an internal factory `createDataAtCommitChannel` so each
  channel's surface contains only the bits unique to that channel
  (schema, cfg shape, dispatch + pointer-derivation lambda). `inline`
  stays standalone — its lifecycle (no store, inline result) doesn't
  fit the shared shape.

  Also surfaces the existing regex / zod scalar validators
  (`addressSchema`, `hexSchema`, `hex32Schema`, `hexBytesSchema`,
  `decimalUintSchema`, `evmNetworkSchema`, and the underlying `RegExp`
  constants) on `@bosonprotocol/x402-core/schemes/escrow`'s public
  exports so downstream packages can reuse them instead of duplicating
  regex.

  Each channel exposed under its own `./channels/<id>` subpath.

  Channels return the wire-format `FulfillmentOption` from `describe()`
  (the `FulfillmentOptionDescriptor` alias was dropped in favour of the
  underlying type, which now carries `metadata?`). `buyerDataSchema` is
  typed as `Record<string, unknown> | null` to match
  `FulfillmentOption.schema`, removing the previous `JSONSchema7` casts
  in the factory and inline channel and dropping the `@types/json-schema`
  devDep.

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

- 79d2cfc: Action-conditional fulfillment data placement at commit time.

  **Wire-format change.** `payload.fulfillment.option` always rides in the commit-time payload (capability negotiation against the server-advertised set). The `data` sub-field is action-conditional:
  - **Atomic Flow B** (`boson-createOfferCommitAndRedeem`): `data` MUST be present in `X-PAYMENT`. The atomic redeem leaves no later round trip for the buyer to attach delivery details, so `data` travels with the only round trip the buyer makes. The commit handler invokes `channel.onCommit(exchangeId, data)` after the on-chain redeem settles.
  - **Two-step Flow A** (`boson-createOfferAndCommit`): `data` MUST be absent in `X-PAYMENT`. The buyer attaches it to the `boson-redeem` POST body after a successful commit; the existing redeem handler then routes it to `channel.onCommit`.

  The action-conditional rule lives in the server validator (rule 13) — the structural Zod / JSON Schema accepts both shapes. New error codes: `FULFILLMENT_DATA_REQUIRED` (Flow B missing data), `FULFILLMENT_DATA_UNEXPECTED` (Flow A carrying data), and `FULFILLMENT_DATA_INVALID` (Flow B data fails the channel adapter's `validate`). Flow B `onCommit` failures leave a pending fulfillment update for host-side replay/reconciliation and surface as a `FULFILLMENT_COMMIT_DEFERRED` warning on the 200 response (the on-chain state is irreversibly `REDEEMED`).

  Migration: clients calling `boson-createOfferCommitAndRedeem` must include `fulfillment.data` in their commit-time payload. Clients calling `boson-createOfferAndCommit` must move any `fulfillment.data` they were attaching to the redeem POST body.

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

- 0aae992: Initial release of `@bosonprotocol/x402-evm` — EVM-specific calldata
  helpers for the x402B `escrow` scheme that are **not already covered by
  `@bosonprotocol/core-sdk`**. This release pins
  `@bosonprotocol/core-sdk@1.47.1-alpha.0` because that alpha exposes
  `signMetaTxCreateOfferAndCommit`. Subpaths:
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
