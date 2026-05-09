---
"@bosonprotocol/x402-fulfillment": minor
---

Add the `email` fulfillment channel: buyer attaches `{ email: string }`
at commit; the server stores it against the exchange id and dispatches
through the configured `send(exchangeId, data)` hook at redeem time
(returning a `mailto:` pointer). zod is the runtime source of truth;
the JSON Schema surfaced on `describe()` is derived via
`zod-to-json-schema`. Exposed via the `./channels/email` subpath.
