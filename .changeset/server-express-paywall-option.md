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

The 402 challenge response now sets `Cache-Control: no-store` and
`Vary: Accept` on both branches so an intermediary cache cannot store
the per-request body or cross-serve HTML to a JSON client. A new
`currentUrl?: string | ((req) => string)` option on both adapters lets
deployments behind a TLS-terminating proxy pin the canonical retry URL
embedded in the paywall HTML — useful when `app.set('trust proxy', ...)`
alone isn't sufficient.
