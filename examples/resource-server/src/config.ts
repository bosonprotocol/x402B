// Env parsing + validation for the resource-server example. Mirrors
// the patterns established in `examples/facilitator-http/src/config.ts`
// (required / optional / asAddress / asHex32 / asInt helpers) so both
// example apps fail the same way on the same kind of bad input.

import type { Address, Hex } from "viem";

export interface ResourceServerEnv {
  /** Public URL the resource server is reachable at; stamped into ChannelRegistry endpoints. */
  publicUrl: string;
  /** RPC endpoint (kept for parity with facilitator-http; unused by the demo until a subgraph-backed `exchangeReader` lands). */
  rpcNode: string;
  /** Numeric chain id of the network. */
  chainId: number;
  /** CAIP-2 EVM network identifier, derived from `chainId`. */
  network: `eip155:${number}`;
  /** Boson Diamond on the configured chain. */
  escrowAddress: Address;
  /** Public URL of the facilitator service the resource server forwards to. */
  facilitatorUrl: string;
  /** Seller private key (`0x`-prefixed 32-byte hex). Signs FullOffers. */
  sellerPk: Hex;
  /** Boson seller entity id (decimal string). Stamped into the FullOffer. */
  sellerId: string;
  /** Boson dispute resolver id (decimal string). Stamped into the FullOffer. */
  disputeResolverId: string;
  /** ERC-20 token the buyer pays in (`exchangeToken` on the FullOffer). */
  assetAddress: Address;
  /** Atomic-units price advertised in the 402 challenge. */
  amount: string;
  /** `PaymentRequirements.maxTimeoutSeconds`. Defaults to 3600 seconds and is capped at 24 hours. */
  maxTimeoutSeconds: number;
  /** Optional subgraph URL — wired into `X402bServerConfig.subgraphUrl` for the funds handlers. */
  subgraphUrl?: string;
  /** HTTP listen port. */
  port: number;
  /**
   * Paywall config block. Populated only when at least one
   * `PAYWALL_*` env var is set; otherwise `undefined` and the
   * resource server serves JSON-only 402s. Pair-shipped with
   * the `paywall` option on `createResourceServerApp` — the binary
   * passes both together so a fork can opt into the HTML paywall by
   * setting env vars and importing `evmEscrowPaywall`.
   */
  paywall?: {
    /** Display name used in the paywall UI + wagmi connector identity. */
    appName?: string;
    /** Enables the WalletConnect connector. Omit for injected + Coinbase only. */
    walletConnectProjectId?: string;
    /** Surface a "testnet" badge in the paywall UI. */
    testnet: boolean;
  };
}

function required(name: string): string {
  const v = process.env[name];
  if (!v || v.length === 0) {
    throw new Error(`[resource-server] missing required env var ${name}`);
  }
  return v;
}

function optional(name: string, fallback: string): string {
  const v = process.env[name];
  return v && v.length > 0 ? v : fallback;
}

function asAddress(value: string, name: string): Address {
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error(`[resource-server] ${name} must be a 0x-prefixed 20-byte hex address`);
  }
  return value as Address;
}

function asHex32(value: string, name: string): Hex {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(`[resource-server] ${name} must be a 0x-prefixed 32-byte hex private key`);
  }
  return value as Hex;
}

function asInt(value: string, name: string, { min, max }: { min: number; max?: number }): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < min || (max !== undefined && n > max)) {
    const range = max !== undefined ? `an integer in [${min}, ${max}]` : `an integer >= ${min}`;
    throw new Error(`[resource-server] ${name} must be ${range} (got ${JSON.stringify(value)})`);
  }
  return n;
}

function asDecimalUint(value: string, name: string): string {
  if (!/^(?:0|[1-9][0-9]*)$/.test(value)) {
    throw new Error(
      `[resource-server] ${name} must be a decimal unsigned integer in canonical form (0 or a non-zero number without leading zeros) (got ${JSON.stringify(value)})`,
    );
  }
  return value;
}

function asHttpUrl(value: string, name: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`[resource-server] ${name} must be an http(s) URL`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`[resource-server] ${name} must be an http(s) URL`);
  }
  return value;
}

export function readEnv(): ResourceServerEnv {
  const chainId = asInt(optional("CHAIN_ID", "31337"), "CHAIN_ID", { min: 1 });
  const subgraphRaw = process.env.SUBGRAPH_URL;
  const paywall = readPaywallEnv();
  return {
    publicUrl: asHttpUrl(required("RESOURCE_SERVER_URL"), "RESOURCE_SERVER_URL"),
    rpcNode: asHttpUrl(required("RPC_NODE"), "RPC_NODE"),
    chainId,
    network: `eip155:${chainId}` as const,
    escrowAddress: asAddress(required("ESCROW_ADDRESS"), "ESCROW_ADDRESS"),
    facilitatorUrl: asHttpUrl(required("FACILITATOR_URL"), "FACILITATOR_URL"),
    sellerPk: asHex32(required("SELLER_PK"), "SELLER_PK"),
    sellerId: asDecimalUint(required("SELLER_ID"), "SELLER_ID"),
    disputeResolverId: asDecimalUint(required("DISPUTE_RESOLVER_ID"), "DISPUTE_RESOLVER_ID"),
    assetAddress: asAddress(required("ASSET_ADDRESS"), "ASSET_ADDRESS"),
    amount: asDecimalUint(required("AMOUNT"), "AMOUNT"),
    maxTimeoutSeconds: asInt(optional("MAX_TIMEOUT_SECONDS", "3600"), "MAX_TIMEOUT_SECONDS", {
      min: 1,
      max: 24 * 60 * 60,
    }),
    ...(subgraphRaw && subgraphRaw.length > 0
      ? { subgraphUrl: asHttpUrl(subgraphRaw, "SUBGRAPH_URL") }
      : {}),
    port: asInt(optional("PORT", "4001"), "PORT", { min: 1, max: 65535 }),
    ...(paywall !== undefined ? { paywall } : {}),
  };
}

/**
 * Build the paywall config from `PAYWALL_*` env vars. Returns
 * `undefined` when no paywall env var is set, signalling that the
 * resource server should not enable the HTML paywall path. Any
 * non-empty `PAYWALL_*` var opts in; `PAYWALL_TESTNET` defaults to
 * `false` when the block is enabled but the var is unset.
 */
function readPaywallEnv(): ResourceServerEnv["paywall"] {
  const appName = process.env.PAYWALL_APP_NAME;
  const walletConnectProjectId = process.env.PAYWALL_WALLETCONNECT_PROJECT_ID;
  const testnetRaw = process.env.PAYWALL_TESTNET;
  const anySet =
    (appName !== undefined && appName.length > 0) ||
    (walletConnectProjectId !== undefined && walletConnectProjectId.length > 0) ||
    (testnetRaw !== undefined && testnetRaw.length > 0);
  if (!anySet) return undefined;
  return {
    ...(appName !== undefined && appName.length > 0 ? { appName } : {}),
    ...(walletConnectProjectId !== undefined && walletConnectProjectId.length > 0
      ? { walletConnectProjectId }
      : {}),
    testnet: testnetRaw === "true" || testnetRaw === "1",
  };
}
