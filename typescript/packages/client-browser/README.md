# @bosonprotocol/x402-client-browser

Browser-environment adapters for [x402B](https://github.com/bosonprotocol/x402B) — Boson Protocol's implementation of the [`x402-escrow-schema`](https://github.com/bosonprotocol/x402-escrow-schema).

This package wraps a browser wallet — either a viem [`WalletClient`](https://viem.sh/docs/clients/wallet.html) or a raw EIP-1193 provider (e.g. `window.ethereum`) — as the [`Signer`](https://github.com/bosonprotocol/x402B/tree/main/typescript/packages/client) interface that [`createX402bClient`](https://github.com/bosonprotocol/x402B/tree/main/typescript/packages/client) expects. Pair it with [`@bosonprotocol/x402-client-fetch`](https://github.com/bosonprotocol/x402B/tree/main/typescript/packages/client-fetch) for the 402-retry plumbing in a browser app.

## Status

Pre-release skeleton. The adapter-specific exports are `signerFromWalletClient` and `signerFromEip1193`; the rest of the public API — `createX402bClient`, error classes, `client.handle402`, `client.signAction`, `client.parsePaymentResponse`, and the configuration types — is re-exported verbatim from [`@bosonprotocol/x402-client`](https://github.com/bosonprotocol/x402B/tree/main/typescript/packages/client), so a single install of this package covers the common browser case.

## Install

```bash
pnpm add @bosonprotocol/x402-client-browser
# or: npm install @bosonprotocol/x402-client-browser
```

## Usage — viem `WalletClient`

```ts
import { createWalletClient, custom } from "viem";
import { base } from "viem/chains";
import {
  createX402bClient,
  signerFromWalletClient,
} from "@bosonprotocol/x402-client-browser";

const walletClient = createWalletClient({
  chain: base,
  transport: custom(window.ethereum!),
});

// If the wallet client was created without a bound account, pass one
// explicitly via `{ account }`.
const [address] = await walletClient.getAddresses();

const client = createX402bClient({
  signer: signerFromWalletClient(walletClient, { account: address }),
  tokenDomainResolver: async (asset, chainId) => ({
    name: "USD Coin",
    version: "2",
    chainId,
    verifyingContract: asset,
  }),
});
```

## Usage — raw EIP-1193 provider

`signerFromEip1193` resolves the signing address lazily on each call. By default it issues `eth_accounts` and assumes the wallet is already connected; passing `{ requestAccounts: true }` switches to `eth_requestAccounts`, which **will trigger a connection prompt** in the user's wallet UI if no account is connected yet. Prefer gating that on an explicit user gesture (e.g. a "Connect wallet" button) — or pass `{ account }` to skip account discovery entirely.

```ts
import {
  createX402bClient,
  signerFromEip1193,
} from "@bosonprotocol/x402-client-browser";

const signer = signerFromEip1193(window.ethereum!, { requestAccounts: true });

const client = createX402bClient({
  signer,
  // ...same config as above
});
```

## End-to-end with `wrapFetchWithPayment`

Once you have a `client`, pair it with [`wrapFetchWithPayment`](https://github.com/bosonprotocol/x402B/tree/main/typescript/packages/client-fetch) from `@bosonprotocol/x402-client-fetch` so a request that gets a `402` carrying `scheme: "escrow"` is transparently retried with the `X-PAYMENT` header:

```bash
pnpm add @bosonprotocol/x402-client-fetch
```

```ts
import { wrapFetchWithPayment } from "@bosonprotocol/x402-client-fetch";

const fetchWithPayment = wrapFetchWithPayment(fetch, client);
const res = await fetchWithPayment("https://seller.example/resource");
```

## License

[Apache-2.0](./LICENSE)
