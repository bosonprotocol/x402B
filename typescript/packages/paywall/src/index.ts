// Public surface for `@bosonprotocol/x402-paywall`.
//
// Server-side entry: `generateHtml` + `evmEscrowPaywall` (a ready-made
// `PaywallProvider` instance). The React app that runs in the browser is
// bundled separately into `src/gen/template.ts` at build time and is not
// part of the public TypeScript surface.

export { generateHtml, evmEscrowPaywall } from "./paywall.js";
export type {
  EscrowPaymentRequired,
  InjectedPaywallState,
  PaywallConfig,
  PaywallProvider,
} from "./types.js";
