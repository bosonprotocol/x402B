---
"@bosonprotocol/x402-fulfillment": minor
"@bosonprotocol/x402-core": minor
---

Add the v0.1 fulfillment-channel registry to
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
