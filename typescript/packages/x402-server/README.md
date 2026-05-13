# @bosonprotocol/x402-server

Framework-agnostic resource-server SDK for the Boson Protocol
[`escrow`](https://github.com/bosonprotocol/x402-escrow-schema) scheme — the
server side of [x402B](https://github.com/bosonprotocol/x402B).

See [`docs/boson-impl-05-server-sdk.md`](../../../docs/boson-impl-05-server-sdk.md)
for the spec and [`docs/boson-impl-01-escrow-scheme.md`](../../../docs/boson-impl-01-escrow-scheme.md)
for the wire format.

## Status

**Pre-release.** v0.1 ships only the request-side primitives — the 402
challenge builder, the seller FullOffer signer hook, and the
`createX402bServer` factory that binds them together. Follow-up PRs add:

- the `X-PAYMENT` 13-rule validator,
- the facilitator HTTP client (talks to `@bosonprotocol/x402-facilitator`),
- the convenience handlers (`commit-and-redeem`, `complete`, `dispute/*`),
- a framework adapter (`@bosonprotocol/x402-server-express`).

## Install

```sh
pnpm add @bosonprotocol/x402-server @bosonprotocol/x402-core @bosonprotocol/x402-actions
```

## Quick start

```ts
import { createX402bServer } from "@bosonprotocol/x402-server";
import { buildChannelRegistry } from "@bosonprotocol/x402-actions";
import { privateKeyToAccount } from "viem/accounts";

const sellerAssistant = privateKeyToAccount(process.env.SELLER_PK as `0x${string}`);

const server = createX402bServer({
  network: "eip155:8453",
  chainId: 8453,
  escrow: "0xDIAMOND...",
  signer: sellerAssistant,
  facilitator: { url: "https://facilitator.example" },
  channelRegistry: buildChannelRegistry({
    channels: ["server", "facilitator", "onchain", "mcp"],
    escrow: "0xDIAMOND...",
    mcp: "boson://seller/12345",
  }),
});

const requirements = await server.buildPaymentRequirements({
  offer: { unsigned: { /* UnsignedFullOffer — see `@bosonprotocol/x402-core/eip712` */ } },
  asset: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", // USDC on Base
  amount: "1000000", // 1 USDC (6 decimals)
  tokenAuthStrategies: ["erc3009"],
  recipientId: "did:boson:seller:12345",
  maxTimeoutSeconds: 300,
});
```

`requirements` is an `EscrowPaymentRequirements` ready to embed in a
402 response's `accepts[]` array.

## License

[Apache-2.0](./LICENSE)
