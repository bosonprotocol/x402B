# @bosonprotocol/x402-facilitator-express

## 0.1.2

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
- Updated dependencies [fdbf090]
- Updated dependencies [d5e157d]
- Updated dependencies [cde6ef1]
- Updated dependencies [5fb1564]
- Updated dependencies [79d2cfc]
- Updated dependencies [d783bb1]
- Updated dependencies [b43b4aa]
- Updated dependencies [a9591a2]
- Updated dependencies [0aae992]
  - @bosonprotocol/x402-core@0.2.0
  - @bosonprotocol/x402-facilitator@1.0.0
