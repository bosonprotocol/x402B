# @bosonprotocol/x402-evm

## 0.2.1

### Patch Changes

- bedee60: Bump `@bosonprotocol/core-sdk` (1.48.0-alpha.6 → 1.48.0) and
  `@bosonprotocol/common` (1.33.0-alpha.7 → 1.33.0) off the pre-release lines to
  their stable releases, so consumers of `@bosonprotocol/x402-*` resolve the
  matching stable peer chain (PR #113).

  This changeset is added retroactively: PR #113 merged without one, leaving the
  _latest_ release flow with nothing to consume.

- Updated dependencies [bedee60]
  - @bosonprotocol/x402-core@0.2.2

## 0.2.0

### Minor Changes

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

- 0aae992: Initial release of `@bosonprotocol/x402-evm` — EVM-specific calldata
  helpers for the x402B `escrow` scheme that are **not already covered by
  `@bosonprotocol/core-sdk`**. This release pins
  `@bosonprotocol/core-sdk@1.47.1-alpha.0` because that alpha exposes
  `signMetaTxCreateOfferAndCommit`. Subpaths:
  - `./actions` — `buildCreateOfferAndCommitCalldata` for the commit-step
    inner action. Returns the `{ functionName, functionSignature }` pair
    that feeds the meta-tx typed-data the buyer signs.
  - `./envelope` — `buildExecuteMetaTransactionTx` over the existing
    Boson `MetaTransactionsHandlerFacet.executeMetaTransaction(...)`
    entrypoint.

  Two builders ship as throwing `NotYetSupportedError` stubs until the
  underlying primitives land upstream:
  - `buildCreateOfferCommitAndRedeemCalldata` — atomic
    `OrchestrationHandlerFacet2.createOfferCommitAndRedeem` (Boson
    contracts PR #1105).
  - `buildExecuteMetaTransactionWithTokenAuthTx` — BPIP-12
    `executeMetaTransactionWithTokenTransferAuthorization` envelope.

  Post-commit transitions (`redeem`, `complete`, `cancel`, `revoke`,
  `raise/retract/escalate/resolve` dispute) are intentionally NOT
  re-implemented: each one is already fully covered by core-sdk's
  `metaTx.handler.signMetaTxXxx` (meta-tx path, each with its bespoke
  EIP-712 type) and `exchanges.iface.encode*` / the public
  `IBosonDisputeHandlerABI` (direct-call path). The README documents the
  recommended call patterns.

  Also extracts the shared throwing / typed-data-intercepting
  `Web3LibAdapter` stub factories into
  `@bosonprotocol/x402-core/internal/web3lib-stub.ts` so the existing
  `full-offer` and `meta-transaction` EIP-712 builders share one
  loud-error idiom.

### Patch Changes

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

- Updated dependencies [bae937f]
- Updated dependencies [e151ec6]
- Updated dependencies [1d7ec97]
- Updated dependencies [79d2cfc]
- Updated dependencies [d783bb1]
- Updated dependencies [0aae992]
  - @bosonprotocol/x402-core@0.2.0
