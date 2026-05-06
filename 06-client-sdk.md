# 06 — Client SDK

> **Status:** stub (v0.1, 2026-05-04). API surface only; details to be filled during implementation.

## Goals

`@bosonprotocol/x402-client` is the framework-agnostic client. It:

1. Intercepts 402 responses with `scheme: "escrow"`.
2. Negotiates the delivery transport.
3. Decides between `createOfferAndCommit` (commit now, redeem later) and `createOfferCommitAndRedeem` (commit and redeem in one tx, regardless of when the resource is delivered) based on the buyer's policy and what `actions.next[]` allows. This is independent of the chosen delivery transport.
4. Picks a token-authorization strategy from `tokenAuthStrategies` (one of `none`, `erc3009`, `permit`, `permit2` per [BPIP-12](https://github.com/zajck/BPIPs/blob/authorized-token-transfer-metaTx/content/BPIP-12.md)).
5. Builds and signs the protocol meta-tx envelope (always) plus the token-transfer authorization for the chosen strategy (omitted for `none`).
6. Retries the request with `X-PAYMENT`.
7. Drives all post-200 actions (redeem, complete, dispute) via whichever channel the buyer/agent prefers, with fallback through the channel order.
8. Verifies on-chain state where the server's claims are load-bearing.

Adapter sub-packages: `x402-client-axios`, `x402-client-fetch`.

## Sketch

```ts
import { createX402bClient } from "@bosonprotocol/x402-client";
import { axiosInterceptor } from "@bosonprotocol/x402-client-axios";

const client = createX402bClient({
  signer:                  buyerWallet,
  channelOrder:            ["server", "facilitator", "onchain", "mcp"],
  delivery: {
    prefer: ["atomic-http", "xmtp", "email"],
    knownData: { xmtpAddress: buyerWallet.xmtp },
  },
  policy: {
    redeemMode:        "commit-and-redeem" | "commit-only" | "auto", // path through the protocol; independent of delivery timing
    tokenAuthStrategy: "auto" | "none" | "erc3009" | "permit" | "permit2",
    maxAmount:         "100000000",                                   // safety cap, atomic units
  },
});

axios.interceptors.response.use(...axiosInterceptor(client));

// from caller:
const res = await axios.get("/datafeed");
// client transparently handles 402, signs, retries, and exposes:
const exchange = client.getCurrentExchange(res);
await client.performAction(exchange, "boson-completeExchange");
```

## Sections to write

- Decision tree for `redeemMode = "auto"` — when the buyer should redeem at commit time vs defer the redeem state transition. Note: this is independent of when the resource is delivered.
- Decision tree for `tokenAuthStrategy = "auto"`: prefer existing allowance (`none`) → ERC-3009 if token supports it → Permit2 if buyer has the one-time max-approval → Permit fallback.
- Channel fallback policy and per-channel timeouts.
- ERC-1271 (contract-wallet) buyer support.
- Local persistence of in-flight exchanges (so a crash doesn't lose state).
- Optional UI hook surface for human buyers (`ui.collect`, `ui.confirm`, `ui.notify`).
- React hooks: `useX402b`, `useExchange`, `usePerformAction` (lives in a sibling react package).
