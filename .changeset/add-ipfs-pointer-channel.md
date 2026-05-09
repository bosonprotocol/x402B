---
"@bosonprotocol/x402-fulfillment": minor
---

Add the `ipfs-pointer` fulfillment channel: buyer optionally attaches
`{ recipientPubKey? }` at commit. The server stores the record
against the exchange id and at redeem time hands it to the configured
`upload(exchangeId, data)` hook (which is responsible for assembling
the resource bytes, optionally encrypting to `recipientPubKey`, and
returning the IPFS CID). The channel returns `ipfs://<cid>` as the
async pointer. Exposed via the `./channels/ipfs-pointer` subpath.
