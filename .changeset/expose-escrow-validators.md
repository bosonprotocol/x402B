---
"@bosonprotocol/x402-core": minor
---

Re-export the regex/zod scalar validators (`addressSchema`,
`hexSchema`, `hexBytesSchema`, `hex32Schema`, `decimalUintSchema`,
`evmNetworkSchema` and their underlying `RegExp` constants) from
`@bosonprotocol/x402-core/schemes/escrow`. Downstream packages can
reuse them instead of duplicating the regex.
