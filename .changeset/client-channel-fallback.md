---
"@bosonprotocol/x402-client": minor
"@bosonprotocol/x402-client-fetch": minor
---

Add channel-aware fallback so buyer flows survive a brief resource-server
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
