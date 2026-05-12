// Public I/O types for `@bosonprotocol/x402-facilitator`.
//
// Source of truth: docs/boson-impl-07-facilitator.md.
//
// The three library functions (verify / settle / performAction) mirror
// the three HTTP endpoints the spec doc describes. HTTP transport itself
// is out of scope for this package — server authors wrap these functions
// with their framework of choice (Fastify, Hono, Web Fetch, …) the same
// way `@bosonprotocol/x402-actions` and `@bosonprotocol/x402-fulfillment`
// stay framework-neutral.

import type {
  Address,
  EscrowPaymentPayload,
  EscrowPaymentRequirements,
  EvmNetwork,
  Hex,
} from "@bosonprotocol/x402-core/schemes/escrow";
import type { ActionId } from "@bosonprotocol/x402-core/state-machine";
import { DisputeState, ExchangeState } from "@bosonprotocol/x402-core/state-machine";
import type { PublicClient, WalletClient } from "viem";

export { DisputeState, ExchangeState };
export type { ActionId };

/**
 * Stable wire-level error codes. Consumers should branch on these rather
 * than on the human-readable `reason` string — the latter is informational
 * and may change between releases.
 *
 * v0.1 — subject to growth as the facilitator's responsibilities widen.
 */
export type FacilitatorErrorCode =
  | "NOT_IMPLEMENTED"
  | "INVALID_PAYLOAD"
  | "SCHEME_MISMATCH"
  | "NETWORK_MISMATCH"
  | "BAD_META_TX_SIGNATURE"
  | "BAD_TOKEN_AUTH_SIGNATURE"
  | "UNSUPPORTED_ACTION"
  | "UNSUPPORTED_TOKEN_AUTH_STRATEGY"
  | "ACTION_NOT_IN_REQUIREMENTS"
  | "TOKEN_AUTH_NOT_IN_REQUIREMENTS"
  | "SIMULATION_REVERT"
  | "INSUFFICIENT_FUNDS_FOR_GAS"
  | "ONCHAIN_REVERT"
  | "EVENT_NOT_FOUND"
  | "INTERNAL_ERROR";

/** Body of `POST /verify` (per spec §"Endpoints"). */
export interface FacilitatorVerifyInput {
  scheme: "escrow";
  network: EvmNetwork;
  payload: EscrowPaymentPayload;
  requirements: EscrowPaymentRequirements;
}

export type FacilitatorVerifyResult =
  | { ok: true }
  | { ok: false; code: FacilitatorErrorCode; reason: string };

/** Body of `POST /settle` (per spec §"Endpoints"). */
export interface FacilitatorSettleInput {
  scheme: "escrow";
  network: EvmNetwork;
  payload: EscrowPaymentPayload;
  requirements: EscrowPaymentRequirements;
}

export type FacilitatorSettleResult =
  | { ok: true; exchangeId: string; txHash: Hex }
  | { ok: false; code: FacilitatorErrorCode; reason: string };

/** Body of `POST /perform-action` (per spec §"Endpoints").
 *
 * Carries enough context for the facilitator to dispatch a post-commit
 * meta-tx without re-fetching protocol state: `network` selects which
 * relayer wallet / RPC to use, and `escrowAddress` is the Boson Diamond
 * the signed meta-tx was bound to (its EIP-712 verifyingContract).
 *
 * `signedPayload` is the ABI-encoded `BosonMetaTx` tuple
 * `(address from, string functionName, bytes functionSignature,
 *   uint256 nonce, uint8 v, bytes32 r, bytes32 s)` —
 * the buyer / seller's pre-signed envelope ready to be wrapped in
 * `MetaTransactionsHandlerFacet.executeMetaTransaction(...)`.
 */
export interface FacilitatorPerformActionInput {
  network: EvmNetwork;
  escrowAddress: Address;
  exchangeId: string;
  action: ActionId;
  signedPayload: Hex;
}

export type FacilitatorPerformActionResult =
  | {
      ok: true;
      txHash: Hex;
      newExchangeState: ExchangeState;
      newDisputeState?: DisputeState;
    }
  | { ok: false; code: FacilitatorErrorCode; reason: string };

/**
 * Runtime configuration passed to each library function.
 *
 * The relayer's signing key lives inside `walletClient` (typically a
 * viem `LocalAccount` HD wallet or a KMS-backed signer). The facilitator
 * never touches the key directly — the wallet handles signing.
 */
export interface FacilitatorConfig {
  /** Public URL the facilitator service is reachable at — populates `nextActions[].endpoints.facilitator`. */
  url: string;
  /** Networks the operator has provisioned a relayer wallet + RPC for. */
  supportedNetworks: readonly EvmNetwork[];
  /** viem WalletClient — pays gas on settle / perform-action. Network must be in `supportedNetworks`. */
  walletClient: WalletClient;
  /** viem PublicClient — used to await receipts and read protocol state. */
  publicClient: PublicClient;
}
