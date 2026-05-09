---
"@bosonprotocol/x402-fulfillment": minor
---

Add the `xmtp` fulfillment channel: buyer attaches
`{ xmtpAddress: <0x…> }` at commit; the server stores it against the
exchange id and pushes the delivery to the buyer's XMTP inbox at
redeem time via the configured `send(exchangeId, data)` hook
(returning an `xmtp:<address>` pointer). Reuses `addressSchema` from
`@bosonprotocol/x402-core/schemes/escrow` for the validation rule.
Exposed via the `./channels/xmtp` subpath.
