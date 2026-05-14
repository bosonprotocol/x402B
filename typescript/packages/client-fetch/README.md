# @bosonprotocol/x402-client-fetch

Native-`fetch` adapter for [x402B](https://github.com/bosonprotocol/x402B) — Boson Protocol's implementation of the [`x402-escrow-schema`](https://github.com/bosonprotocol/x402-escrow-schema).

This package wraps a `fetch` implementation so a request that gets a `402` carrying `scheme: "escrow"` is transparently retried with the `X-PAYMENT` header produced by [`@bosonprotocol/x402-client`](https://github.com/bosonprotocol/x402B/tree/main/typescript/packages/client). 402 responses without an `escrow` accept entry are passed through unchanged so other x402 schemes coexist cleanly.

## Status

Pre-release skeleton. The only adapter-specific export is `wrapFetchWithPayment`; the rest of the public API — `createX402bClient`, error classes, `client.handle402`, `client.signAction`, `client.parsePaymentResponse`, and the configuration types — is re-exported verbatim from [`@bosonprotocol/x402-client`](https://github.com/bosonprotocol/x402B/tree/main/typescript/packages/client), so a single install of this package covers the common case.

## Install

```bash
pnpm add @bosonprotocol/x402-client-fetch
# or: npm install @bosonprotocol/x402-client-fetch
```

## Usage

```ts
import { createX402bClient, wrapFetchWithPayment } from "@bosonprotocol/x402-client-fetch";
import { privateKeyToAccount } from "viem/accounts";

const account = privateKeyToAccount("0x...");

const client = createX402bClient({
  signer: {
    getAddress: async () => account.address,
    signTypedData: (args) => account.signTypedData(args),
  },
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
