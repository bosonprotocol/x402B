---
"@bosonprotocol/x402-actions": patch
"@bosonprotocol/x402-client": patch
"@bosonprotocol/x402-client-fetch": patch
"@bosonprotocol/x402-core": patch
"@bosonprotocol/x402-evm": patch
"@bosonprotocol/x402-facilitator": major
"@bosonprotocol/x402-facilitator-express": patch
"@bosonprotocol/x402-fulfillment": patch
"@bosonprotocol/x402-server": patch
"@bosonprotocol/x402-server-express": patch
---

Cleanup pass on stale references.

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
  convenience-route default with the canonical `/x402B` route mount.
- Keep the `bosonprotocol/x402B` casing in package `repository` /
  `homepage` / `bugs` URLs and README links.
- Drop the unused `@x402/core` and `lodash` dependencies from
  `@bosonprotocol/x402-core`'s `package.json` (no imports in `src/`).
