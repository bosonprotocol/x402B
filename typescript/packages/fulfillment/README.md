# @bosonprotocol/x402-fulfillment

Fulfillment channels for the Boson Protocol [`escrow`
scheme](../core/) of [x402](https://github.com/x402-foundation/x402).
Defines the pluggable `FulfillmentChannel` interface that lets a seller
advertise — and a buyer attach — delivery data alongside an x402
escrow payment.

See [`docs/boson-impl-03-fulfillment-channels.md`](../../../docs/boson-impl-03-fulfillment-channels.md)
for the design and wire-format spec.

## Status

Skeleton package. Ships the `FulfillmentChannel` interface and
`FulfillmentResult` type so consumers can begin to type against the
contract. Built-in channels (`atomic-http`, `email`, `xmtp`, `webhook`,
`ipfs-pointer`), the registry, and the client-side `negotiateFulfillment`
helper land separately.

## Install

```bash
pnpm add @bosonprotocol/x402-fulfillment @bosonprotocol/x402-core
```

## API

```ts
import type {
  FulfillmentChannel,
  FulfillmentResult,
} from "@bosonprotocol/x402-fulfillment";
```

`FulfillmentOption` and `FulfillmentRequirements` (the on-the-wire
shapes that appear in the 402 `PaymentRequirements` and the
`X-PAYMENT` payload) are re-exported from
[`@bosonprotocol/x402-core/schemes/escrow`](../core/) — import them from there.

## License

Apache-2.0.
