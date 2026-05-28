// `generateHtml` — the server-side entry point.
//
// Takes the prebuilt HTML template (the IIFE-inlined React app, baked at
// build time into `./gen/template.ts`) and splices a
// `<script>window.x402b = {...}</script>` block before `</head>`. The
// React entry (`src/app/main.tsx`) reads `window.x402b` on load and
// drives the payment flow from there.
//
// The same `</head>` splice strategy upstream `@x402/paywall` uses — keep
// it simple and avoid pulling in any HTML parser on the server-side hot
// path. The template is a constant string we control, so a string
// `.replace()` is sufficient and predictable.

import { EVM_ESCROW_PAYWALL_TEMPLATE } from "./gen/template.js";
import type {
  EscrowPaymentRequired,
  InjectedPaywallState,
  PaywallConfig,
  PaywallProvider,
} from "./types.js";

const HEAD_CLOSE = "</head>";

/**
 * Build the 402 HTML response body for the given escrow
 * PaymentRequirements. Returns a complete `<!DOCTYPE html>...` document.
 *
 * @throws if the prebuilt template doesn't contain a `</head>` close tag
 *   (which would indicate the IIFE build pipeline produced something
 *   malformed and we'd rather fail loudly than silently emit an HTML
 *   document with no payload).
 */
export function generateHtml(payload: EscrowPaymentRequired, config?: PaywallConfig): string {
  // Promote `config.currentUrl` into the top-level `state.currentUrl` when
  // the payload doesn't carry one of its own. Callers can land the retry
  // URL on either side; the injected state always exposes it under the
  // single canonical field the React app reads.
  const currentUrl = payload.currentUrl ?? config?.currentUrl;
  const state: InjectedPaywallState = {
    requirements: payload.requirements,
    ...(currentUrl !== undefined ? { currentUrl } : {}),
    ...(config !== undefined ? { config } : {}),
  };
  const injection = `<script>window.x402b = ${escapeForScript(JSON.stringify(state))};</script>`;

  const headIdx = EVM_ESCROW_PAYWALL_TEMPLATE.indexOf(HEAD_CLOSE);
  if (headIdx === -1) {
    throw new Error(
      "x402-paywall: prebuilt template is missing </head>; rebuild the package (`pnpm build:app`)",
    );
  }
  return (
    EVM_ESCROW_PAYWALL_TEMPLATE.slice(0, headIdx) +
    injection +
    EVM_ESCROW_PAYWALL_TEMPLATE.slice(headIdx)
  );
}

/**
 * Defend the inline `<script>` block against seller-supplied strings that
 * happen to contain a literal `</script>` (or `</style>`) sequence — the
 * realistic vector here is offer metadata or fulfillment-option metadata
 * coming from a third party. Modern browsers no longer treat U+2028 /
 * U+2029 as line terminators inside string literals (per ES2019), so we
 * don't bother escaping those.
 */
function escapeForScript(json: string): string {
  return json.replace(/<\/(script|style)/gi, "<\\/$1");
}

/**
 * Default `PaywallProvider` implementation backed by {@link generateHtml}.
 * Supports the `escrow` scheme; falls through (returns `false` from
 * {@link PaywallProvider.supports}) for anything else so a middleware
 * mounting multiple providers can chain them.
 */
export const evmEscrowPaywall: PaywallProvider = {
  supports(requirements) {
    return requirements?.scheme === "escrow";
  },
  generateHtml,
};
