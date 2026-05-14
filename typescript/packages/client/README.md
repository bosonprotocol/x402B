# @bosonprotocol/x402-client

Framework-agnostic buyer-side SDK for [x402B](https://github.com/bosonprotocol/x402B) — Boson Protocol's implementation of the [`x402-escrow-schema`](https://github.com/bosonprotocol/x402-escrow-schema).

This package intercepts a `402 Payment Required` carrying `scheme: "escrow"`, signs the buyer's Boson protocol meta-transaction + token-transfer authorization, and produces the `X-PAYMENT` header so the request can be re-issued.

Adapters for specific HTTP clients will be published as sibling packages — e.g. `@bosonprotocol/x402-client-fetch` for native `fetch`.

## Status

Pre-release skeleton. The public API surface lands incrementally; the package currently exports types, errors, the client factory, and pure-function utilities (action picker, fulfillment resolver).

## Install

```bash
pnpm add @bosonprotocol/x402-client
# or: npm install @bosonprotocol/x402-client
```

## License

[Apache-2.0](./LICENSE)
