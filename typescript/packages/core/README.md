# @bosonprotocol/x402-core

`escrow`-scheme primitives for [x402B](https://github.com/bosonprotocol/x402B) — Boson Protocol's implementation of the [`x402-escrow-schema`](https://github.com/bosonprotocol/x402-escrow-schema).

This is the leaf package that every other `@bosonprotocol/x402-*` package depends on. It will provide:

- JSON schemas + TypeScript types + zod validators for the `escrow` scheme wire format
- EIP-712 builders for the Boson `FullOffer`, the protocol meta-transaction envelope, and the four BPIP-12 token-authorization strategies (ERC-3009 `ReceiveWithAuthorization`, EIP-2612 `Permit`, Uniswap Permit2, plain approve)
- Exchange state machine model (states + legal transitions + `boson-*` action ids)

The escrow scheme is intended as a drop-in addition to existing x402 servers and clients — types here extend the base `PaymentRequirements` / `PaymentPayload` from [`@x402/core`](https://www.npmjs.com/package/@x402/core).

## Status

Pre-release skeleton. The public API surface lands incrementally; the package currently exports nothing.

## Install

```bash
pnpm add @bosonprotocol/x402-core
# or: npm install @bosonprotocol/x402-core
```

## License

[Apache-2.0](./LICENSE)
