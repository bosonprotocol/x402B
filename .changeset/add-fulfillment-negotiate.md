---
"@bosonprotocol/x402-fulfillment": minor
---

Add `negotiateFulfillment` (client-side): walks the seller's
advertised `FulfillmentOption[]` in `prefer`-then-original order and
returns the first option the client can satisfy from
`agentContext` or via an optional `collectInteractive(option)`
callback. Schemaless options resolve to `{ data: null }` immediately.
Throws `NoCompatibleFulfillmentError` when no advertised option is
reachable. Exposed via the `./client` subpath.
