---
"@bosonprotocol/x402-facilitator": minor
"@bosonprotocol/x402-evm": minor
---

Replace the facilitator's hand-rolled meta-transaction envelope with
`coreSdk.executeMetaTransaction(metaTxParams)` — the unified entrypoint
introduced in `@bosonprotocol/core-sdk@1.48.0-alpha.3` that routes
between `executeMetaTransaction` and the BPIP-12
`executeMetaTransactionWithTokenTransferAuthorization` based on whether
`transferAuthorizations` is supplied. The relayer wallet pays gas
through a new viem-backed `Web3LibAdapter` exposed at
`@bosonprotocol/x402-evm/adapters` (`walletClientToWeb3LibAdapter` +
tagged `RelayerSubmitError`). The simulate (`eth_call`) pre-flight now
sources its calldata from core-sdk's handler-level
`executeMetaTransaction(..., returnTxInfo: true)` instead of a custom
encoder.

`performAction()` now accepts any `tokenAuthStrategy` (the previous
`UNSUPPORTED_TOKEN_AUTH_STRATEGY` gate is gone): when
`tokenAuthStrategy !== "none"`, `tokenAuth`, `asset`, `amount`, and
`maxTimeoutSeconds` are required and the token-auth signature is
recovered and cross-checked the same way `settle()`/`verify()` already
do.

`@bosonprotocol/x402-evm`'s `./envelope` subpath is removed (the SDK
covers it). The new `./adapters` subpath exposes the relayer adapter
and re-exports the existing calldata-only stub.

`@bosonprotocol/common` is bumped to `1.33.0-alpha.4` and
`@bosonprotocol/core-sdk` to `1.48.0-alpha.3` across the workspace.
