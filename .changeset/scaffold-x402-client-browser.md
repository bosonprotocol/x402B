---
"@bosonprotocol/x402-client-browser": minor
---

Initial skeleton for `@bosonprotocol/x402-client-browser`: ships two
browser-oriented signer adapters — `signerFromWalletClient` (wraps a
viem `WalletClient`) and `signerFromEip1193` (wraps a raw EIP-1193
provider such as `window.ethereum`) — and re-exports the full
`@bosonprotocol/x402-client` surface so a single install covers the
common browser-buyer case.
