---
"@bosonprotocol/x402-example-resource-server": minor
"@bosonprotocol/x402-server-express": patch
---

Wire the optional `paywall` + `paywallConfig` options through
`createResourceServerApp` to the underlying `expressMiddleware` and
`mountX402b` calls. Setting any `PAYWALL_*` env var
(`PAYWALL_APP_NAME`, `PAYWALL_WALLETCONNECT_PROJECT_ID`,
`PAYWALL_TESTNET`) populates a `paywall` block on the parsed env;
forks of the example binary can then import `evmEscrowPaywall` from
`@bosonprotocol/x402-paywall` and forward both into the app to get
HTML 402 bodies for browser User-Agents.

Also widens `PaywallConfigLike` in `@bosonprotocol/x402-server-express`
from `Record<string, unknown>` to `object` so concrete `PaywallConfig`
shapes (with named optional fields, no index signature) satisfy it
structurally — required for the demo example to typecheck without
casts.
