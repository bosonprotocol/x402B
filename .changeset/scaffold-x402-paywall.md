---
"@bosonprotocol/x402-paywall": minor
---

Initial skeleton for `@bosonprotocol/x402-paywall`: a browser paywall
for the Boson `escrow` scheme. Ships a `generateHtml(payload, config?)`
server-side function and an `evmEscrowPaywall: PaywallProvider`
instance — both produce a self-contained HTML 402 body with the React
app bundle (wagmi + viem inlined) and a `window.x402b` state payload
spliced before `</head>`. Mirrors upstream `@x402/paywall`'s
`PaywallProvider` contract so future middleware integrations can accept
either implementation.
