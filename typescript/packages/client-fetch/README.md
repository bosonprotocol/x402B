# @bosonprotocol/x402-client-fetch

Native-`fetch` adapter for [x402B](https://github.com/bosonprotocol/x402B) — Boson Protocol's implementation of the [`x402-escrow-schema`](https://github.com/bosonprotocol/x402-escrow-schema).

This package wraps a `fetch` implementation so a request that gets a `402` carrying `scheme: "escrow"` is transparently retried with the `X-PAYMENT` header produced by [`@bosonprotocol/x402-client`](https://github.com/bosonprotocol/x402B/tree/main/typescript/packages/client). 402 responses without an `escrow` accept entry are passed through unchanged so other x402 schemes coexist cleanly.

## Status

Pre-release skeleton. MVP exposes only the wrapper; channel fallback, response-header decoding, and per-action retry remain on the [`@bosonprotocol/x402-client`](https://github.com/bosonprotocol/x402B/tree/main/typescript/packages/client) surface.

## Install

```bash
pnpm add @bosonprotocol/x402-client-fetch
# or: npm install @bosonprotocol/x402-client-fetch
```

`@bosonprotocol/x402-client`'s public API is re-exported from this package, so a single install covers the common case.

## Usage

```ts
import {
  createX402bClient,
  viemAccountSigner,
  wrapFetchWithPayment,
} from "@bosonprotocol/x402-client-fetch";
import { privateKeyToAccount } from "viem/accounts";

const client = createX402bClient({
  signer: viemAccountSigner(privateKeyToAccount("0x...")),
  tokenDomainResolver: async (asset, chainId) => ({
    name: "USD Coin",
    version: "2",
    chainId,
    verifyingContract: asset,
  }),
});

const fetchWithPayment = wrapFetchWithPayment(fetch, client);
const res = await fetchWithPayment("https://seller.example/resource");
```

## License

[Apache-2.0](./LICENSE)
