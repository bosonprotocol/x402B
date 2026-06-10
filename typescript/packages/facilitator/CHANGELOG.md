# @bosonprotocol/x402-facilitator

## 1.0.1

### Patch Changes

- bedee60: Bump `@bosonprotocol/core-sdk` (1.48.0-alpha.6 → 1.48.0) and
  `@bosonprotocol/common` (1.33.0-alpha.7 → 1.33.0) off the pre-release lines to
  their stable releases, so consumers of `@bosonprotocol/x402-*` resolve the
  matching stable peer chain (PR #113).

  This changeset is added retroactively: PR #113 merged without one, leaving the
  _latest_ release flow with nothing to consume.

- Updated dependencies [bedee60]
  - @bosonprotocol/x402-core@0.2.2
  - @bosonprotocol/x402-evm@0.2.1

## 1.0.0

### Major Changes

- e151ec6: Cleanup pass on stale references.

  Breaking change for `@bosonprotocol/x402-facilitator`: remove the unused
  `NotImplementedError` export and the `"NOT_IMPLEMENTED"` member of
  `FacilitatorErrorCode`. These were public API symbols, even though the
  facilitator implementation no longer throws them.
  - Update the stale Flow B comment in
    `@bosonprotocol/x402-server-express`'s middleware that claimed the
    shipped client could not yet sign the atomic
    `createOfferCommitAndRedeem` entry point.
  - Replace the `boson-protocol-contracts` PR-number reference in
    `@bosonprotocol/x402-core`'s `ACTION_FACETS` JSDoc with a durable
    facet-only reference, per the repo's "no PR-number references in
    source" rule.
  - Align documentation, JSDoc examples, test fixtures, and the Express
    convenience-route docs with the canonical `/x402B` route mount while
    keeping the legacy `/x402b` default alias for existing consumers.
  - Keep the `bosonprotocol/x402B` casing in package `repository` /
    `homepage` / `bugs` URLs and README links.
  - Drop the unused `@x402/core` dependency from `@bosonprotocol/x402-core`'s
    `package.json`; keep `lodash` because `@bosonprotocol/core-sdk` still
    requires `lodash/groupBy` at runtime under pnpm's strict resolution.

### Minor Changes

- fdbf090: Extend the `FacilitatorConfig.escrows` allowlist enforcement to
  `verify()` and `settle()`. Previously only `performAction()` validated
  the target Diamond against the operator-configured allowlist;
  `verify()`/`settle()` trusted `input.requirements.escrowAddress`
  directly, so a malicious seller could direct the relayer at any
  contract on a supported chain that exposes a compatible
  `executeMetaTransaction(...)` selector.

  `verify()` (and transitively `settle()`) now reject:
  - Networks with no `config.escrows[network]` entry →
    `NETWORK_MISMATCH`.
  - `requirements.escrowAddress` mismatched against the configured
    Diamond → `INVALID_PAYLOAD`.

  Spec doc and `FacilitatorConfig.escrows` JSDoc updated to reflect that
  all three library functions now consume the same allowlist.

- d5e157d: Implement `performAction()`: relays post-commit meta-transactions
  (`boson-redeem`, `boson-completeExchange`, `boson-cancelVoucher`,
  `boson-revokeVoucher`, `boson-raiseDispute`, `boson-retractDispute`,
  `boson-escalateDispute`, `boson-resolveDispute`) through the same
  `executeMetaTransaction` envelope used by `settle()`. `signedPayload` is
  the ABI-encoded `BosonMetaTx` tuple — `encodeSignedPayload` /
  `decodeSignedPayload` codec helpers are exported for client SDKs.

  `FacilitatorPerformActionInput` now carries `network` and
  `escrowAddress` alongside `exchangeId`, `action`, and `signedPayload` —
  the facilitator needs both to dispatch to the right Diamond on the
  right chain. The spec doc has been updated in lockstep.

  Returns `{ txHash, newExchangeState, newDisputeState? }` so callers can
  update local state without re-querying the protocol; the state lookup
  is a pure read of `ACTION_POST_STATE` in
  `@bosonprotocol/x402-core/state-machine`.

- cde6ef1: Implement `settle()`: runs `verify()`, builds the outer
  `executeMetaTransaction` envelope via `@bosonprotocol/x402-evm`,
  submits via the configured viem `WalletClient`, awaits the receipt,
  and extracts `exchangeId` from the `BuyerCommitted` event using
  `@bosonprotocol/common`'s `IBosonExchangeHandlerABI`. Functional for
  `tokenAuthStrategy: "none"`; the BPIP-12 token-auth queue path
  surfaces as `UNSUPPORTED_TOKEN_AUTH_STRATEGY` until
  `@bosonprotocol/x402-evm` ships the encoder. Receipt-level reverts
  surface as `ONCHAIN_REVERT`; receipts without `BuyerCommitted` surface
  as `EVENT_NOT_FOUND`.
- 5fb1564: Implement `verify()`: structural validation against the escrow-scheme
  Zod schemas, scheme / network / action / strategy cross-checks against
  the `PaymentRequirements`, offer/calldata consistency checks against the
  advertised `FullOffer`, EIP-712 signature recovery for the buyer's
  meta-tx (via `@bosonprotocol/x402-core/eip712`'s
  `metaTransactionTypedData` + viem's `recoverTypedDataAddress`), token-
  auth signature recovery for ERC-3009 / EIP-2612 Permit / Permit2
  variants plus amount/deadline constraints (via
  `@bosonprotocol/x402-core/eip712/token-auth`, looking up each token's
  EIP-712 domain via EIP-5267 with a `name()` / `version()` fallback), and
  an on-chain simulation pre-flight via `publicClient.call` against the
  `executeMetaTransaction` envelope built by `@bosonprotocol/x402-evm/envelope`.
  The BPIP-12 token-auth envelope still maps to
  `UNSUPPORTED_TOKEN_AUTH_STRATEGY` while the EVM builder is deferred.
  Protocol-level reverts surface as `SIMULATION_REVERT` without consuming
  gas.
- b43b4aa: Initial skeleton for `@bosonprotocol/x402-facilitator`: ships I/O types
  (`FacilitatorVerifyInput/Result`, `FacilitatorSettleInput/Result`,
  `FacilitatorPerformActionInput/Result`), `FacilitatorConfig`, the
  `FacilitatorErrorCode` union, the typed `FacilitatorError` /
  `NotImplementedError` classes with a `toResult()` normalizer, and the
  `FacilitatorChannelAdapter` implementation of
  `@bosonprotocol/x402-actions`'s `ChannelAdapter` for the `facilitator`
  channel. The three library functions (`verify`, `settle`,
  `performAction`) are stubs that throw `NotImplementedError` until the
  real implementations land in follow-up PRs.
- a9591a2: Replace the facilitator's hand-rolled meta-transaction envelope with
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

### Patch Changes

- Updated dependencies [bae937f]
- Updated dependencies [78f6f48]
- Updated dependencies [e151ec6]
- Updated dependencies [1d7ec97]
- Updated dependencies [79d2cfc]
- Updated dependencies [d783bb1]
- Updated dependencies [8979b85]
- Updated dependencies [a9591a2]
- Updated dependencies [0aae992]
  - @bosonprotocol/x402-core@0.2.0
  - @bosonprotocol/x402-actions@0.2.0
  - @bosonprotocol/x402-evm@0.2.0
