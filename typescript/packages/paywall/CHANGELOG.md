# @bosonprotocol/x402-paywall

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
