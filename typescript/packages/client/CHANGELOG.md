# @bosonprotocol/x402-client

## 0.3.1

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

## 0.3.0

### Minor Changes

- 63ab3d6: Add channel-aware fallback so buyer flows survive a brief resource-server
  outage. Post-commit actions and (opt-in) commit-time payments now walk
  the seller's advertised channel list, intersected with `["server",
"facilitator"]`, instead of being pinned to the first endpoint.

  `@bosonprotocol/x402-client`
  - New `submitAction(args)` method on `X402bClient` and a low-level
    `submitAction()` helper from the package root. Signs the meta-tx via
    `signAction`, looks up the matching entry in
    `priorNextActions.next[]`, and POSTs to the first responsive channel
    in `channels[]`. Falls back to the next channel on 5xx, network
    error, or timeout; stops and throws on 4xx (a buyer-side payload bug
    fallback can't fix). `NoCompatibleChannelError` covers actions
    advertising only non-HTTP channels; `AllChannelsFailedError` carries
    the per-channel attempt log. The server-channel response surfaces
    the full `nextActions` envelope; the facilitator's
    `/perform-action` returns the new state only.

  `@bosonprotocol/x402-client-fetch`
  - New `commitFallback: "off" | "auto"` option on `wrapFetchWithPayment`
    (default `"off"`). When `"auto"`, a resource-server 5xx / network
    error / timeout on the X-PAYMENT retry triggers a direct POST to the
    facilitator's `/settle` endpoint advertised in the 402's
    `actions.next[*].endpoints.facilitator`. On settle success the
    wrapper returns a synthesized `200` with `X-PAYMENT-RESPONSE`
    populated, a `X-X402-Boson-Commit-Channel: facilitator` marker so
    the caller can detect that fallback was taken, and an empty body —
    the resource itself stays the responsibility of the resource server.
    On any fallback failure the original upstream error is surfaced
    unchanged.

  `onchain`, `mcp`, and `xmtp` channels remain out of scope for both
  surfaces and will land separately when the underlying primitives ship.

### Patch Changes

- Updated dependencies [c81db37]
  - @bosonprotocol/x402-core@0.2.1

## 0.2.0

### Minor Changes

- 79d2cfc: Action-conditional fulfillment data placement at commit time.

  **Wire-format change.** `payload.fulfillment.option` always rides in the commit-time payload (capability negotiation against the server-advertised set). The `data` sub-field is action-conditional:
  - **Atomic Flow B** (`boson-createOfferCommitAndRedeem`): `data` MUST be present in `X-PAYMENT`. The atomic redeem leaves no later round trip for the buyer to attach delivery details, so `data` travels with the only round trip the buyer makes. The commit handler invokes `channel.onCommit(exchangeId, data)` after the on-chain redeem settles.
  - **Two-step Flow A** (`boson-createOfferAndCommit`): `data` MUST be absent in `X-PAYMENT`. The buyer attaches it to the `boson-redeem` POST body after a successful commit; the existing redeem handler then routes it to `channel.onCommit`.

  The action-conditional rule lives in the server validator (rule 13) — the structural Zod / JSON Schema accepts both shapes. New error codes: `FULFILLMENT_DATA_REQUIRED` (Flow B missing data), `FULFILLMENT_DATA_UNEXPECTED` (Flow A carrying data), and `FULFILLMENT_DATA_INVALID` (Flow B data fails the channel adapter's `validate`). Flow B `onCommit` failures leave a pending fulfillment update for host-side replay/reconciliation and surface as a `FULFILLMENT_COMMIT_DEFERRED` warning on the 200 response (the on-chain state is irreversibly `REDEEMED`).

  Migration: clients calling `boson-createOfferCommitAndRedeem` must include `fulfillment.data` in their commit-time payload. Clients calling `boson-createOfferAndCommit` must move any `fulfillment.data` they were attaching to the redeem POST body.

- 9f59ac5: Initial skeleton for `@bosonprotocol/x402-client`: ships the
  framework-agnostic buyer-side SDK package with typed configuration,
  typed errors, action selection, fulfillment resolution,
  and build/test/postbuild conventions matching the existing x402B
  TypeScript packages.

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

- 7aa2e4c: Fix `parsePaymentResponse` to read and normalize the nested
  `nextActions.exchangeState` (and `nextActions.disputeState` when present)
  from the `X-PAYMENT-RESPONSE` header. The server emits exchange state under
  the nested path, so the prior top-level-only lookup always returned an
  undefined `summary.state`. Top-level `state` still wins when present.
- 63a0c97: Make the token-auth strategy picker capability-aware.

  When the server advertises multiple strategies (e.g. `["erc3009", "permit2"]`)
  and the client lacks the runtime prerequisites for the preferred one
  (e.g. no `tokenDomainResolver` in `X402bClientConfig`), the picker now
  falls back to the next advertised strategy it can actually sign instead
  of throwing. Permit2 in particular requires no extra configuration, so a
  client configured without `tokenDomainResolver` will silently use Permit2
  whenever the server lists it as an alternative.

  `UnsupportedTokenAuthError` is now thrown only when the intersection
  (advertised) ∩ (preferred) ∩ (client-capable) is empty. The error message
  lists what's advertised and which client-side prerequisite is missing so
  deployments without `tokenDomainResolver` can diagnose the gap.

- Updated dependencies [bae937f]
- Updated dependencies [e151ec6]
- Updated dependencies [1d7ec97]
- Updated dependencies [79d2cfc]
- Updated dependencies [d783bb1]
- Updated dependencies [a9591a2]
- Updated dependencies [0aae992]
  - @bosonprotocol/x402-core@0.2.0
  - @bosonprotocol/x402-evm@0.2.0
