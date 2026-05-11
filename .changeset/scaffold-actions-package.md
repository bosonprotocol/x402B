---
"@bosonprotocol/x402-actions": minor
---

Initial skeleton for `@bosonprotocol/x402-actions`: ships the
`NextActionsEnvelope` / `ActionEntry` types, the `Channel` /
`CHANNEL_IDS` registry constants, the thin `ChannelAdapter` contract,
and the `ChannelRegistry` config type. The build/test/postbuild
conventions match `@bosonprotocol/x402-core` and
`@bosonprotocol/x402-fulfillment`, with subpath exports for
`./channels`, `./registry`, and `./schemas/*`. No `deriveNextActions`
implementation, channel adapters, or registry helpers yet.
