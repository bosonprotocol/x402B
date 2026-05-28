# @bosonprotocol/x402-server

## 0.2.0

### Minor Changes

- cd8572b: Add pure X-PAYMENT validation helpers for escrow payloads, including
  base64 header decoding, rule-by-rule payment payload validation, meta-tx
  signature recovery, token authorization checks, and fulfillment option
  validation hooks.
- 79d2cfc: Action-conditional fulfillment data placement at commit time.

  **Wire-format change.** `payload.fulfillment.option` always rides in the commit-time payload (capability negotiation against the server-advertised set). The `data` sub-field is action-conditional:
  - **Atomic Flow B** (`boson-createOfferCommitAndRedeem`): `data` MUST be present in `X-PAYMENT`. The atomic redeem leaves no later round trip for the buyer to attach delivery details, so `data` travels with the only round trip the buyer makes. The commit handler invokes `channel.onCommit(exchangeId, data)` after the on-chain redeem settles.
  - **Two-step Flow A** (`boson-createOfferAndCommit`): `data` MUST be absent in `X-PAYMENT`. The buyer attaches it to the `boson-redeem` POST body after a successful commit; the existing redeem handler then routes it to `channel.onCommit`.

  The action-conditional rule lives in the server validator (rule 13) — the structural Zod / JSON Schema accepts both shapes. New error codes: `FULFILLMENT_DATA_REQUIRED` (Flow B missing data), `FULFILLMENT_DATA_UNEXPECTED` (Flow A carrying data), and `FULFILLMENT_DATA_INVALID` (Flow B data fails the channel adapter's `validate`). Flow B `onCommit` failures leave a pending fulfillment update for host-side replay/reconciliation and surface as a `FULFILLMENT_COMMIT_DEFERRED` warning on the 200 response (the on-chain state is irreversibly `REDEEMED`).

  Migration: clients calling `boson-createOfferCommitAndRedeem` must include `fulfillment.data` in their commit-time payload. Clients calling `boson-createOfferAndCommit` must move any `fulfillment.data` they were attaching to the redeem POST body.

- ce750ed: Initial `@bosonprotocol/x402-server` package: ships the request-side
  402 challenge builder, seller FullOffer signer hook, server config
  validation, and `createX402bServer` factory for building escrow payment
  requirements with initial next-actions.

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

- 0fa1661: Distinguish facilitator domain rejections from transport failures in
  `createFacilitatorClient`. When an HTTP 400 response carries a parseable
  `{ok:false, code, reason}` body (as `facilitator-express` emits for
  domain failures), the client now returns it as the typed domain result
  instead of throwing `FacilitatorHttpError`. Transport faults (network
  error, non-JSON body, schema-mismatched body, or 5xx response) still
  throw `FacilitatorHttpError`. The convenience handlers'
  `FACILITATOR_REJECTED` branch is now exercised for legitimate
  facilitator rejections like `BAD_META_TX_SIGNATURE` instead of masking
  them as `FACILITATOR_UNREACHABLE`.
- Updated dependencies [bae937f]
- Updated dependencies [78f6f48]
- Updated dependencies [e151ec6]
- Updated dependencies [1d7ec97]
- Updated dependencies [fdbf090]
- Updated dependencies [d5e157d]
- Updated dependencies [cde6ef1]
- Updated dependencies [5fb1564]
- Updated dependencies [79d2cfc]
- Updated dependencies [d783bb1]
- Updated dependencies [8979b85]
- Updated dependencies [b43b4aa]
- Updated dependencies [a9591a2]
- Updated dependencies [0aae992]
  - @bosonprotocol/x402-core@0.2.0
  - @bosonprotocol/x402-actions@0.2.0
  - @bosonprotocol/x402-evm@0.2.0
  - @bosonprotocol/x402-facilitator@1.0.0
