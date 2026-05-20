// Public configuration types for the paywall.
//
// The shape of `PaywallProvider` mirrors upstream `@x402/paywall`'s
// `PaywallProvider` (defined in `@x402/core/server`) so any middleware
// that already speaks that contract can swap in this Boson escrow
// implementation. The runtime hand-off contract — `window.x402b` injected
// before `</head>` of the returned HTML — is identical in shape to
// upstream's `window.x402`, just namespaced separately to make the two
// schemes co-installable without colliding.

import type { EscrowPaymentRequirements } from "@bosonprotocol/x402-core/schemes/escrow";

/**
 * Caller-supplied paywall config. Forwarded to the React app via
 * `window.x402b.config` so the rendered UI can pick up branding, the
 * current URL to retry against, and wallet-connector settings.
 */
export interface PaywallConfig {
  /** Display name used by injected & WalletConnect connectors. Defaults to "x402B paywall". */
  appName?: string;
  /** Optional logo URL. Rendered above the offer card. */
  appLogo?: string;
  /**
   * The URL the client should retry once the X-PAYMENT header is built.
   * If omitted the React app falls back to `window.location.href`.
   */
  currentUrl?: string;
  /**
   * Required to enable the WalletConnect connector. Without this only
   * injected and Coinbase wallets are offered.
   */
  walletConnectProjectId?: string;
  /**
   * Token domain hint used by the buyer SDK when signing ERC-3009 /
   * EIP-2612 token authorizations. Keyed by token contract address; the
   * UI passes the requirement's `asset` through and expects the consumer
   * to return the matching `{ name, version }` it publishes for typed-data
   * signatures. If omitted, the UI falls back to `{ name: asset, version: "1" }`,
   * which works for some but not all USD-coin deployments.
   */
  tokenDomains?: Record<string, { name: string; version: string }>;
  /** When `true`, the UI surfaces "testnet" badges and skips production-only warnings. */
  testnet?: boolean;
}

/**
 * Subset of fields a server passes to the paywall builder when it returns
 * 402. `requirements` is the same wire-format object the server emits
 * inside `accepts[]`; `currentUrl` (when known) is the URL the buyer
 * should retry with the X-PAYMENT header.
 */
export interface EscrowPaymentRequired {
  requirements: EscrowPaymentRequirements;
  currentUrl?: string;
}

/**
 * Contract that the resource-server middleware sees. A `PaywallProvider`
 * is a stateless object with two methods: `supports` (is this request
 * one we should render a paywall for?) and `generateHtml` (produce the
 * 402 HTML body). Matches upstream's `@x402/core/server` interface so the
 * same middleware option can accept either implementation.
 */
export interface PaywallProvider {
  /**
   * Decide whether this provider can render a paywall for the given
   * `requirements`. The default x402B implementation returns `true` only
   * for `scheme: "escrow"`.
   */
  supports(requirements: { scheme?: string }): boolean;

  /**
   * Build the full HTML document (starts with `<!DOCTYPE html>`) that the
   * server should send back as the 402 body for browser User-Agents.
   * `config` is optional and merged onto the React app's injected state.
   */
  generateHtml(payload: EscrowPaymentRequired, config?: PaywallConfig): string;
}

/**
 * Shape of the global `window.x402b` object that the prebuilt React app
 * reads at load time. Keep this declaration centralized so both the
 * server-side splicer ({@link "./paywall.ts"}) and the React entry
 * (`src/app/main.tsx`) agree on the field names.
 */
export interface InjectedPaywallState {
  requirements: EscrowPaymentRequirements;
  currentUrl?: string;
  config?: PaywallConfig;
}
