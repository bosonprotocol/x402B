---
"@bosonprotocol/x402-actions": patch
"@bosonprotocol/x402-client": patch
"@bosonprotocol/x402-client-fetch": patch
"@bosonprotocol/x402-core": patch
"@bosonprotocol/x402-evm": patch
"@bosonprotocol/x402-facilitator": patch
"@bosonprotocol/x402-facilitator-express": patch
"@bosonprotocol/x402-fulfillment": patch
"@bosonprotocol/x402-server": patch
"@bosonprotocol/x402-server-express": patch
---

Cleanup pass on stale references — no behavior change.

- Drop the unused `NotImplementedError` class and the `"NOT_IMPLEMENTED"`
  member of `FacilitatorErrorCode`; the class was defined but never
  thrown in the facilitator's `src/`.
- Update the stale Flow B comment in
  `@bosonprotocol/x402-server-express`'s middleware that claimed the
  shipped client could not yet sign the atomic
  `createOfferCommitAndRedeem` entry point.
- Replace the `boson-protocol-contracts` PR-number reference in
  `@bosonprotocol/x402-core`'s `ACTION_FACETS` JSDoc with a durable
  facet-only reference, per the repo's "no PR-number references in
  source" rule.
- Align documentation, JSDoc examples, and test fixtures with the
  shipping lowercase `/x402b` route mount in
  `@bosonprotocol/x402-server-express`.
- Correct the `bosonprotocol/x402B` casing in every package's
  `repository` / `homepage` / `bugs` URLs and README links to match the
  actual lowercase GitHub repository path.
- Drop the unused `@x402/core` and `lodash` dependencies from
  `@bosonprotocol/x402-core`'s `package.json` (no imports in `src/`).
