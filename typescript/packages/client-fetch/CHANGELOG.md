# @bosonprotocol/x402-client-fetch

## 0.2.0

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

- c81db37: Give the browser paywall per-flow offer isolation. Each Pay click now
  mints a fresh `X-X402-Boson-Session-Id` and stamps it on both a
  session-scoped challenge re-fetch (whose escrow requirement it signs) and
  the X-PAYMENT retry, mirroring `@bosonprotocol/x402-client-fetch`'s
  `wrapFetchWithPayment`. Previously the paywall signed the navigation-time
  requirements and retried without a session id, so sequential browser
  buyers collided on the resource server's fallback cache slot — reverting
  `OfferSoldOut` on a single-quantity offer template within the cache TTL.

  Adds `findEscrowAccept(body)` to `@bosonprotocol/x402-core/schemes/escrow`
  — the escrow-entry picker for a parsed 402 `accepts[]` body — and
  single-sources `@bosonprotocol/x402-client-fetch`'s entry extraction
  through it so the wrapper and the paywall select the entry identically.

- Updated dependencies [63ab3d6]
- Updated dependencies [c81db37]
  - @bosonprotocol/x402-client@0.3.0
  - @bosonprotocol/x402-core@0.2.1

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
- Updated dependencies [79d2cfc]
- Updated dependencies [d783bb1]
- Updated dependencies [9f59ac5]
- Updated dependencies [7aa2e4c]
- Updated dependencies [63a0c97]
- Updated dependencies [0aae992]
  - @bosonprotocol/x402-core@0.2.0
  - @bosonprotocol/x402-client@0.2.0
