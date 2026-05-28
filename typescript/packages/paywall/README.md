# @bosonprotocol/x402-paywall

Browser paywall for the [x402B](https://github.com/bosonprotocol/x402B) escrow scheme. Renders the FullOffer, connects a wallet via [wagmi](https://wagmi.sh) (injected / Coinbase / WalletConnect), drives the atomic commit-and-redeem flow through [`@bosonprotocol/x402-client-browser`](https://github.com/bosonprotocol/x402B/tree/main/typescript/packages/client-browser), and swaps in the resource on success.

Mirrors the `PaywallProvider` contract used by upstream [`@x402/paywall`](https://github.com/x402-foundation/x402/tree/main/typescript/packages/http/paywall) — middleware that already speaks that contract can swap in this provider for browser User-Agents hitting an `escrow` 402.

## Status

Pre-release skeleton. The package ships:

- A server-side `generateHtml(payload, config?)` function that returns the 402 HTML body with a `<script>window.x402b = {...}</script>` block spliced before `</head>`.
- An `evmEscrowPaywall: PaywallProvider` instance ready to plug into a middleware option.
- A prebuilt, self-contained IIFE bundle (React + wagmi + viem inlined) that runs in the browser, reads `window.x402b`, and drives the payment.

Out of scope for v0.1: handler for non-`escrow` schemes, ERC-3009/Permit/Permit2 domain auto-detection (host app supplies `tokenDomains` via `PaywallConfig`), Solana / Algorand support.

## Install

```bash
pnpm add @bosonprotocol/x402-paywall
# or: npm install @bosonprotocol/x402-paywall
```

## Server-side usage

```ts
import { evmEscrowPaywall } from "@bosonprotocol/x402-paywall";
import type { EscrowPaymentRequirements } from "@bosonprotocol/x402-core/schemes/escrow";

app.get("/protected", (req, res) => {
  const requirements: EscrowPaymentRequirements = /* build via x402-server */ ...;

  // Browser User-Agent → HTML paywall; everything else → JSON 402.
  const wantsHtml = (req.headers.accept ?? "").includes("text/html");
  if (wantsHtml) {
    const html = evmEscrowPaywall.generateHtml(
      { requirements, currentUrl: `${req.protocol}://${req.get("host")}${req.originalUrl}` },
      { appName: "My App", testnet: true, tokenDomains: { /* asset → { name, version } */ } },
    );
    res.status(402).type("html").send(html);
    return;
  }

  res.status(402).json({ x402Version: 2, accepts: [requirements] });
});
```

The future `paywall:` option on `@bosonprotocol/x402-server-express` will wire this up automatically — until that ships, hand-rolling the `Accept`-based branch above is the integration path.

## Browser bundle

The IIFE is built at package-build time by `src/build.ts` (esbuild) and inlined into the HTML template (`src/gen/template.ts`). Consumers don't import anything browser-side — `generateHtml()` returns a complete `<!DOCTYPE html>...` document that the browser loads as-is.

Runtime contract: the React app reads `window.x402b: InjectedPaywallState` on `load`. If you need to extend the payload (e.g. for a custom branding hook), edit `src/types.ts` (`InjectedPaywallState`) on both sides — server splicer and React entry both consume the same type.

## Configuration (`PaywallConfig`)

| Field                       | Purpose                                                                |
|-----------------------------|------------------------------------------------------------------------|
| `appName`                   | Display name + injected/Coinbase/WC connector identity                 |
| `appLogo`                   | Optional logo URL above the offer card                                 |
| `currentUrl`                | URL the React app retries against once X-PAYMENT is built              |
| `walletConnectProjectId`    | Enables the WalletConnect connector (required for mobile wallet flows) |
| `tokenDomains`              | `{ [asset]: { name, version } }` for ERC-3009 / EIP-2612 typed data    |
| `testnet`                   | Surface "testnet" badge in the UI                                      |

## License

[Apache-2.0](./LICENSE)
