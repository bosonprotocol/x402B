# @bosonprotocol/x402-actions

`nextActions` envelope builder for the Boson Protocol [`escrow`
scheme](../core/) of [x402](https://github.com/x402-foundation/x402).
Defines the wire-format types and the pluggable `ChannelAdapter`
contract the server SDK uses to advertise legal next transitions on
every response.

See [`docs/boson-impl-04-state-machine-and-next-actions.md`](../../../docs/boson-impl-04-state-machine-and-next-actions.md)
for the design and wire-format spec.

## Status

Skeleton package. Ships the framework-level types
(`NextActionsEnvelope`, `ActionEntry`), the `Channel` /
`CHANNEL_IDS` registry constants, the thin `ChannelAdapter` contract,
and the `ChannelRegistry` config type. The `deriveNextActions`
envelope builder, the per-action `onchainHints` stamper, and the
channel-registry helpers land in follow-up PRs.

The exchange + dispute state machine itself (action ids, transition
tables, state enums) lives in
[`@bosonprotocol/x402-core/state-machine`](../core/) — this package
consumes those tables to derive the `next[]` array at runtime.

## Install

```bash
pnpm add @bosonprotocol/x402-actions @bosonprotocol/x402-core
```

## API

```ts
import {
  CHANNEL_IDS,
  type ActionEntry,
  type Channel,
  type ChannelAdapter,
  type ChannelRegistry,
  type NextActionsEnvelope,
} from "@bosonprotocol/x402-actions";
```

The base wire-format types (`NextAction`, `OnchainHints`,
`ActionsFallback`, `ActionsEnvelope`, `ActionChannel`) and the state
enums (`ExchangeState`, `DisputeState`) are re-exported from
[`@bosonprotocol/x402-core`](../core/) for ergonomics.

## License

Apache-2.0.
