---
"@bosonprotocol/x402-facilitator": minor
---

Implement `settle()`: runs `verify()`, builds the outer
`executeMetaTransaction` envelope via `@bosonprotocol/x402-evm`,
submits via the configured viem `WalletClient`, awaits the receipt,
and extracts `exchangeId` from the `BuyerCommitted` event using
`@bosonprotocol/common`'s `IBosonExchangeHandlerABI`. Functional for
`tokenAuthStrategy: "none"`; the BPIP-12 token-auth queue path
surfaces as `UNSUPPORTED_TOKEN_AUTH_STRATEGY` until
`@bosonprotocol/x402-evm` ships the encoder. Receipt-level reverts
surface as `ONCHAIN_REVERT`; receipts without `BuyerCommitted` surface
as `EVENT_NOT_FOUND`.
