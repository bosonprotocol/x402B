---
"@bosonprotocol/x402-fulfillment": minor
---

Initial skeleton for `@bosonprotocol/x402-fulfillment`: ships the
pluggable `FulfillmentChannel` interface and `FulfillmentResult` type,
the build/test/postbuild conventions matching `@bosonprotocol/x402-core`,
and the export-map subpaths (`./registry`, `./client`, `./channels/*`,
`./schemas/*`) consumers will reach for. No channel implementations,
registry, or negotiation helper yet.
