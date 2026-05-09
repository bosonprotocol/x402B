---
"@bosonprotocol/x402-fulfillment": minor
---

Add the `atomic-http` fulfillment channel: schemaless (the buyer
attaches no data), with `onRedeem` returning the resource body
resolved by a server-supplied `resolve(exchangeId)` callback. Exposed
via the `./channels/atomic-http` subpath.
