# @bosonprotocol/x402-fulfillment

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

- 0eedef4: Add `negotiateFulfillment` (client-side): walks the seller's
  advertised `FulfillmentOption[]` in `prefer`-then-original order and
  returns the first option the client can satisfy from
  `agentContext` or via an optional `collectInteractive(option)`
  callback. Schemaless options resolve to `{ data: null }` immediately.
  Throws `NoCompatibleFulfillmentError` when no advertised option is
  reachable. Exposed via the `./client` subpath.
- 14b773f: Add `FulfillmentRegistry` (server-side): owns configured channel
  instances keyed by id, dispatches `validate` / `onCommit` / `onFulfill`,
  and produces the `FulfillmentOption[]` list for
  `PaymentRequirements.fulfillment.options`. Exposed via the `./registry`
  subpath. Duplicate-id registration throws `DuplicateChannelError`;
  dispatch against an unknown id throws `UnknownChannelError`.

  Aligns the channel-interface method names with the upstream
  `x402-escrow-schema` spec — `onRedeem` → `onFulfill` and the
  `FulfillmentResult` discriminator `"atomic"` → `"inline"` in
  `src/types.ts`.

  Drops the `FulfillmentOptionDescriptor` alias; channels now return
  the wire-format `FulfillmentOption` directly from `describe()` since
  `metadata` is already part of `FulfillmentOption` on
  `@bosonprotocol/x402-core`. `buyerDataSchema` is retyped to
  `Record<string, unknown> | null` (same as `FulfillmentOption.schema`),
  removing the previous `JSONSchema7` casts and the `@types/json-schema`
  devDep.

- b4d8179: Initial skeleton for `@bosonprotocol/x402-fulfillment`: ships the
  pluggable `FulfillmentChannel` interface and `FulfillmentResult` type,
  the build/test/postbuild conventions matching `@bosonprotocol/x402-core`,
  and the export-map subpaths (`./registry`, `./client`, `./channels/*`,
  `./schemas/*`) consumers will reach for. No channel implementations,
  registry, or negotiation helper yet.

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
