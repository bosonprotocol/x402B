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
  BosonTokenAuth,
  EscrowPaymentPayload,
  EscrowPaymentRequirements,
  EvmNetwork,
  Hex,
  TokenAuthStrategy,
} from "@bosonprotocol/x402-core/schemes/escrow";
import type {
  ActionId,
  EntityActionId,
  ExchangeActionId,
} from "@bosonprotocol/x402-core/state-machine";
import { DisputeState, ExchangeState } from "@bosonprotocol/x402-core/state-machine";
import type { PublicClient, WalletClient } from "viem";

export { DisputeState, ExchangeState };
export type { ActionId, EntityActionId, ExchangeActionId };

/**
 * Stable wire-level error codes. Consumers should branch on these rather
 * than on the human-readable `reason` string — the latter is informational
 * and may change between releases.
 *
 * v0.1 — subject to growth as the facilitator's responsibilities widen.
 */
export type FacilitatorErrorCode =
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

/**
 * Fields shared across every `/perform-action` variant. See the per-variant
 * interfaces below for the action-specific keying (`exchangeId` vs
 * `entityId`).
 *
 * `signedPayload` is the ABI-encoded `BosonMetaTx` tuple
 * `(address from, string functionName, bytes functionSignature,
 *   uint256 nonce, uint8 v, bytes32 r, bytes32 s)` —
 * the buyer / seller's pre-signed envelope ready to be wrapped in
 * `MetaTransactionsHandlerFacet.executeMetaTransaction(...)`.
 *
 * Most post-commit actions are non-payable: the relayer just submits
 * the meta-tx and `tokenAuthStrategy` defaults to `"none"`. The one
 * action that may need value transfer today is `boson-escalateDispute`,
 * which is `payable` on the Diamond. `performAction()` routes through
 * `coreSdk.executeMetaTransaction(...)`, which accepts any
 * `tokenAuthStrategy` — the SDK dispatches between the bare envelope
 * and the BPIP-12 token-transfer-authorization variant internally.
 * When `tokenAuthStrategy !== "none"`, `tokenAuth`, `asset`, `amount`,
 * and `maxTimeoutSeconds` are all required so the facilitator can
 * verify the token-auth signature and cross-check the declared
 * metadata; when it is `"none"`, all four must be omitted.
 */
interface FacilitatorPerformActionInputBase {
  network: EvmNetwork;
  escrowAddress: Address;
  signedPayload: Hex;
  /** Defaults to `"none"`. */
  tokenAuthStrategy?: TokenAuthStrategy;
  /** Required when `tokenAuthStrategy !== "none"`; must be omitted otherwise. */
  tokenAuth?: BosonTokenAuth;
  /** Required when `tokenAuthStrategy !== "none"`; must be omitted otherwise. */
  asset?: Address;
  /** Required when `tokenAuthStrategy !== "none"`; must be omitted otherwise. */
  amount?: string;
  /** Required when `tokenAuthStrategy !== "none"`; must be omitted otherwise. */
  maxTimeoutSeconds?: number;
}

/** Exchange-keyed variant — the default for redeem / complete / dispute family. */
export interface FacilitatorPerformExchangeActionInput extends FacilitatorPerformActionInputBase {
  action: ExchangeActionId;
  exchangeId: string;
}

/**
 * Entity-keyed variant — for actions that target a Boson account
 * `entityId` (buyer or seller) rather than a single exchange. The only
 * action today is `boson-withdrawFunds`.
 */
export interface FacilitatorPerformEntityActionInput extends FacilitatorPerformActionInputBase {
  action: EntityActionId;
  entityId: string;
}

/** Body of `POST /perform-action` (per spec §"Endpoints"). Discriminated on `action`. */
export type FacilitatorPerformActionInput =
  | FacilitatorPerformExchangeActionInput
  | FacilitatorPerformEntityActionInput;

/** Successful exchange-keyed result — pins the new exchange / dispute state. */
export interface FacilitatorPerformExchangeActionOk {
  ok: true;
  txHash: Hex;
  newExchangeState: ExchangeState;
  newDisputeState?: DisputeState;
}

/**
 * Successful entity-keyed result — the action doesn't transition the
 * exchange state machine, so neither state field is reported.
 */
export interface FacilitatorPerformEntityActionOk {
  ok: true;
  txHash: Hex;
}

export type FacilitatorPerformActionResult =
  | FacilitatorPerformExchangeActionOk
  | FacilitatorPerformEntityActionOk
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
  /**
   * Server-side allowlist of trusted Boson Diamond addresses, keyed by
   * `EvmNetwork`. The facilitator MUST resolve the on-chain target from
   * this map rather than trusting client-supplied addresses — otherwise
   * any contract on a supported chain that exposes a compatible
   * `executeMetaTransaction(...)` selector could trick the relayer into
   * sponsoring gas for non-Boson calls.
   *
   * All three library functions enforce the allowlist:
   *
   * - `verify()` and `settle()` reject when
   *   `input.requirements.escrowAddress` doesn't match
   *   `escrows[input.network]`.
   * - `performAction()` rejects when `input.escrowAddress` doesn't match
   *   `escrows[input.network]`.
   *
   * Networks without an entry are rejected as `NETWORK_MISMATCH`.
   */
  escrows: Readonly<Record<EvmNetwork, Address>>;
  /** viem WalletClient — pays gas on settle / perform-action. Network must be in `supportedNetworks`. */
  walletClient: WalletClient;
  /** viem PublicClient — used to await receipts and read protocol state. */
  publicClient: PublicClient;
}
