// Public configuration types for `createX402bClient`. The `Signer` interface
// is defined here (rather than under `src/signer/`) so the config types can
// reference it without forcing consumers to install or import from a
// secondary subpath; the `./signer` subpath re-exports it for ergonomics.

import type { ClientState } from "@bosonprotocol/x402-core/state-machine";
import type { TokenEip712Domain } from "@bosonprotocol/x402-core/eip712/token-auth";
import type { Address, Hex, TypedDataDomain, TypedDataParameter } from "viem";

/**
 * Decision the buyer's policy makes about the on-chain redemption phase, **independent
 * of when the resource is delivered off-chain**.
 *
 *  - `"auto"`     — default. MVP picks the deferred `boson-createOfferAndCommit`
 *                   path; later iterations may pick atomic commit+redeem when both
 *                   are advertised.
 *  - `"commit-only"` — explicitly want the deferred path; buyer (or another agent)
 *                      will redeem later.
 *  - `"commit-and-redeem"` — explicitly want atomic on-chain commit+redeem. Not
 *                            implemented in MVP — throws `NotImplementedError`.
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
 * EIP-2612 signatures. Tokens are not on-chain queried by the client in
 * MVP — callers must provide this resolver (often a small in-memory lookup
 * table keyed by `(chainId, asset)`).
 */
export type TokenDomainResolver = (
  asset: Address,
  chainId: number,
) => Promise<TokenEip712Domain> | TokenEip712Domain;

/**
 * Minimal wallet abstraction the client signs through. Matches the shape of
 * viem's `Account.signTypedData` so a viem `LocalAccount` /
 * `WalletClient`-bound account can be wrapped by a thin adapter (see
 * `viemAccountSigner` / `viemWalletClientSigner` in `./signer`).
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
