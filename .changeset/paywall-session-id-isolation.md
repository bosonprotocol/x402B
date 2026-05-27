---
"@bosonprotocol/x402-paywall": patch
"@bosonprotocol/x402-core": patch
"@bosonprotocol/x402-client-fetch": patch
---

Give the browser paywall per-flow offer isolation. Each Pay click now
mints a fresh `X-X402-Boson-Session-Id` and stamps it on both a
session-scoped challenge re-fetch (whose escrow requirement it signs) and
the X-PAYMENT retry, mirroring `@bosonprotocol/x402-client-fetch`'s
`wrapFetchWithPayment`. Previously the paywall signed the navigation-time
requirements and retried without a session id, so sequential browser
buyers collided on the resource server's fallback cache slot — reverting
`OfferSoldOut` on a single-quantity offer template within the cache TTL.

Adds `findEscrowAccept(body)` to `@bosonprotocol/x402-core/schemes/escrow`
— the escrow-entry picker for a parsed 402 `accepts[]` body — and
single-sources `@bosonprotocol/x402-client-fetch`'s entry extraction
through it so the wrapper and the paywall select the entry identically.
