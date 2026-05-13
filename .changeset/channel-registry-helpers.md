---
"@bosonprotocol/x402-actions": minor
---

Add channel-registry helpers to `@bosonprotocol/x402-actions`:

- `buildChannelRegistry(input)` and `channelRegistryZodSchema` —
  zod-validated constructor for `ChannelRegistry`. Catches malformed
  URLs, malformed addresses, duplicate channel ids, unknown channel
  ids, and unknown action-id keys at boot time rather than letting
  bad config silently leak into `nextActions` envelopes.
- `BUYER_ONCHAIN_FALLBACK`, `hasBuyerOnchainFallback(entry)`, and
  `isBuyerOnchainResilient(id)` — codify the censorship-resistance
  table from
  docs/boson-impl-04-state-machine-and-next-actions.md
  §"Censorship resistance — guarantees", letting clients short-circuit
  channel fallback to direct on-chain submission when the seller's
  preferred channels are unreachable.
