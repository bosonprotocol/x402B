---
"@bosonprotocol/x402-fulfillment": minor
---

Add `FulfillmentRegistry` (server-side): owns configured channel
instances keyed by id, dispatches `validate` / `onCommit` / `onRedeem`,
and produces the descriptor list for `PaymentRequirements.fulfillment.options`.
Exposed via the `./registry` subpath. Duplicate-id registration throws
`DuplicateChannelError`; dispatch against an unknown id throws
`UnknownChannelError`.
