// Public configuration types for `createX402bClient`. The `Signer` interface
// is defined here (rather than under `src/signer/`) so the config types can
// reference it without forcing consumers through a secondary subpath.

import type { ClientState } from "@bosonprotocol/x402-core/state-machine";
import type { TokenEip712Domain } from "@bosonprotocol/x402-core/eip712/token-auth";
import type { Address, Hex, PublicClient, TypedDataDomain, TypedDataParameter } from "viem";

/**
 * Decision the buyer's policy makes about the on-chain redemption phase, **independent
 * of when the resource is delivered off-chain**.
 *
 *  - `"auto"`     — default. Prefers the deferred `boson-createOfferAndCommit`
 *                   path when advertised; falls back to atomic commit+redeem.
 *  - `"commit-only"` — explicitly want the deferred path; buyer (or another agent)
 *                      will redeem later.
 *  - `"commit-and-redeem"` — explicitly want atomic on-chain commit+redeem;
 *                            requires the server to advertise
 *                            `boson-createOfferCommitAndRedeem` on the server channel,
 *                            otherwise throws `NoCompatibleActionError`.
 */
export type RedeemMode = "auto" | "commit-only" | "commit-and-redeem";

export interface Policy {
  redeemMode?: RedeemMode;
  /** Atomic-units cap. If set, the client rejects requirements whose `amount` exceeds it. */
  maxAmount?: string;
}

export interface FulfillmentConfig {
  /** `id` of the option the buyer wants from `requirements.fulfillment.options[]`. */
  option: string;
  /** Buyer-supplied data; validated against the chosen option's JSON Schema. */
  data: Record<string, unknown>;
}

/**
 * Resolves the EIP-712 domain a given ERC-20 publishes for ERC-3009 /
 * EIP-2612 signatures. Callers usually provide a small in-memory lookup
 * table keyed by `(chainId, asset)`. Permit2 does not use the token's
 * EIP-712 domain and can be signed without this resolver.
 */
export type TokenDomainResolver = (
  asset: Address,
  chainId: number,
) => Promise<TokenEip712Domain> | TokenEip712Domain;

/**
 * Minimal wallet abstraction the client signs through. Matches the shape of
 * viem's `Account.signTypedData` so a viem `LocalAccount` can be passed
 * directly (its `signTypedData` and `address` already line up); a viem
 * `WalletClient`-bound account or an external signer needs a 4-line
 * inline wrapper of the same shape.
 */
export interface Signer {
  getAddress(): Promise<Address>;
  signTypedData(args: {
    domain: TypedDataDomain;
    types: Record<string, readonly TypedDataParameter[]>;
    primaryType: string;
    message: Record<string, unknown>;
  }): Promise<Hex>;
}

export interface X402bClientConfig {
  signer: Signer;
  /**
   * Per-chain Boson subgraph URLs. `CoreSDK`'s base constructor requires one;
   * for signing-only flows the URL may not actually be queried, but it must
   * be present. Keyed by EIP-155 chain id (e.g. `8453` for Base mainnet).
   */
  subgraphUrls?: Record<number, string>;
  /**
   * Per-chain viem `PublicClient`s. Required for the EIP-2612 Permit
   * token-auth strategy, which fetches the token's `nonces(owner)` before
   * signing. If the buyer signs only on chains with no Permit support, this
   * may be omitted; attempting to sign a Permit payload without a configured
   * PublicClient throws a clear error. Keyed by EIP-155 chain id.
   */
  publicClients?: Record<number, PublicClient>;
  tokenDomainResolver?: TokenDomainResolver;
  policy?: Policy;
  /** Default fulfillment selection. Required when `requirements.fulfillment.required` is true. */
  fulfillment?: FulfillmentConfig;
}

/**
 * Whatever the server returns in `X-PAYMENT-RESPONSE` (if anything) after a
 * successful settle. Permissive — the server-side contract for this header
 * isn't pinned yet; the client surfaces the raw payload and best-effort
 * lifts `exchangeId` / `state` from common property paths.
 */
export interface ExchangeSummary {
  raw?: unknown;
  exchangeId?: string;
  state?: ClientState;
}
