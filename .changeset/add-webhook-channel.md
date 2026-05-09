---
"@bosonprotocol/x402-fulfillment": minor
---

Add the `webhook` fulfillment channel: buyer attaches
`{ url, authToken?, encryptionPubKey? }` at commit (https endpoints
only). The server stores the record against the exchange id and
dispatches via the configured `send(exchangeId, data)` hook at redeem
time, returning the buyer's url as the async pointer.

Buyer-side endpoint protection has three layers — server-signed
envelopes (always on, via `metadata.serverPublicKey`), an optional
bearer `authToken` the server sends as `Authorization: Bearer …`,
and an optional `encryptionPubKey` for the future cipher specced
under `03b-webhook-encryption.md`. See the new "Webhook security"
section in `docs/boson-impl-03-fulfillment-channels.md`.

Exposed via the `./channels/webhook` subpath.
