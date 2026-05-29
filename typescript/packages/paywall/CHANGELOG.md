# @bosonprotocol/x402-paywall

## 0.2.1

### Patch Changes

- c81db37: Give the browser paywall per-flow offer isolation. Each Pay click now
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

- Updated dependencies [63ab3d6]
- Updated dependencies [c81db37]
  - @bosonprotocol/x402-client@0.3.0
  - @bosonprotocol/x402-core@0.2.1
  - @bosonprotocol/x402-client-browser@0.2.1

## 0.2.0

### Minor Changes

- bd7fd91: Initial skeleton for `@bosonprotocol/x402-paywall`: a browser paywall
  for the Boson `escrow` scheme. Ships a `generateHtml(payload, config?)`
  server-side function and an `evmEscrowPaywall: PaywallProvider`
  instance — both produce a self-contained HTML 402 body with the React
  app bundle (wagmi + viem inlined) and a `window.x402b` state payload
  spliced before `</head>`. Mirrors upstream `@x402/paywall`'s
  `PaywallProvider` contract so future middleware integrations can accept
  either implementation.

### Patch Changes

- Updated dependencies [bae937f]
- Updated dependencies [e151ec6]
- Updated dependencies [1d7ec97]
- Updated dependencies [79d2cfc]
- Updated dependencies [d783bb1]
- Updated dependencies [9f59ac5]
- Updated dependencies [7aa2e4c]
- Updated dependencies [0fdfd9b]
- Updated dependencies [63a0c97]
- Updated dependencies [0aae992]
  - @bosonprotocol/x402-core@0.2.0
  - @bosonprotocol/x402-client@0.2.0
  - @bosonprotocol/x402-client-browser@0.2.0
