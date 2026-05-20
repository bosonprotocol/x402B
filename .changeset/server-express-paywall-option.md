---
"@bosonprotocol/x402-server-express": minor
---

Add optional `paywall` + `paywallConfig` to `ExpressMiddlewareOptions`
and `MountX402bOptions`. When supplied and the request's `Accept`
header prefers `text/html`, the 402 challenge is rendered as an HTML
document via `paywall.generateHtml(...)` instead of the canonical JSON
body — pairing naturally with `@bosonprotocol/x402-paywall`'s
`evmEscrowPaywall`. Non-browser clients always get JSON, and the
paywall path never fires on the settle phase (X-PAYMENT present).
