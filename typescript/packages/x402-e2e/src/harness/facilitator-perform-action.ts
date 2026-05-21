// Drive a post-commit action straight through the facilitator's
// `POST /perform-action` route — bypasses the resource server entirely.
//
// Why this exists: `@bosonprotocol/x402-server-express` only mounts
// HTTP routes for buyer-initiated post-commit actions that fit the
// "resource purchase" workflow (`redeem`, `complete`, `dispute/*`).
// The protocol also supports `boson-cancelVoucher` (buyer ends the
// exchange before redeeming, e.g. abandoned cart) and
// `boson-revokeVoucher` (seller-initiated cancellation), but no
// resource-server route was added for either — they're outside the
// "happy path" purchase flow. The facilitator's `perform-action`
// endpoint accepts them anyway via its generic action dispatcher,
// so the harness reaches them directly. Production integrators
// would presumably mount their own routes or call this endpoint
// from their own backend.

import type { ExchangeState, DisputeState } from "@bosonprotocol/x402-actions";
import type { Address, Hex } from "viem";

import type { BuyerActor } from "./buyer-actor.js";
import { safeStringify } from "./http-error-utils.js";
import type { SellerActor } from "./seller-actor.js";

/** Subset of action ids the facilitator's `/perform-action` route exposes that this helper drives. */
export type FacilitatorOnlyActionId = "boson-cancelVoucher" | "boson-revokeVoucher";

export interface FacilitatorPerformArgs {
  /** Facilitator service URL (e.g. `http://127.0.0.1:8889`). */
  facilitatorUrl: string;
  /** Disputed/committed exchange id. */
  exchangeId: string;
  /** CAIP-2 network id (e.g. `"eip155:31337"`). */
  network: string;
  /** Escrow address (Boson Diamond). */
  escrowAddress: Address;
}

export interface CancelVoucherArgs extends FacilitatorPerformArgs {
  /** Buyer signs `cancelVoucher` (it ends *their* commitment). */
  buyer: BuyerActor;
}

export interface RevokeVoucherArgs extends FacilitatorPerformArgs {
  /** Seller signs `revokeVoucher` (only the seller can revoke their own offer). */
  seller: SellerActor;
}

/** Successful facilitator response (mirrors `FacilitatorPerformExchangeActionOk`). */
export interface FacilitatorPerformResult {
  ok: true;
  txHash: Hex;
  newExchangeState: ExchangeState;
  newDisputeState?: DisputeState;
}

/** Thrown when the facilitator returns a non-2xx or `{ ok: false }` envelope. */
export class FacilitatorPerformError extends Error {
  readonly status: number;
  readonly body: unknown;
  constructor(action: FacilitatorOnlyActionId, status: number, body: unknown) {
    super(`[x402-e2e/facilitator] ${action} → HTTP ${status}: ${safeStringify(body)}`);
    this.name = "FacilitatorPerformError";
    this.status = status;
    this.body = body;
  }
}

/**
 * Sign `cancelVoucher` with the buyer's key and submit through the
 * facilitator's perform-action route. Returns the parsed success body.
 */
export async function performCancelVoucher(
  args: CancelVoucherArgs,
): Promise<FacilitatorPerformResult> {
  const signed = await args.buyer.client.signAction({
    actionId: "boson-cancelVoucher",
    exchangeId: args.exchangeId,
    network: args.network,
    escrowAddress: args.escrowAddress,
  });
  return postPerformAction("boson-cancelVoucher", args, signed.signedPayload);
}

/**
 * Sign `revokeVoucher` with the seller's key and submit through the
 * facilitator's perform-action route. Returns the parsed success body.
 *
 * The seller's BuyerActor twin doesn't exist in the harness — sellers
 * don't fetch HTTP resources — so the signing path is implemented
 * inline here against the seller's viem account.
 *
 * **TODO**: This currently isn't wired (B8 deferred in PR7a). When B8
 * lands, the seller-side meta-tx signing needs the `signMetaTxRevoke
 * Voucher` core-sdk surface plumbed through `SellerActor`.
 */
export async function performRevokeVoucher(
  _args: RevokeVoucherArgs,
): Promise<FacilitatorPerformResult> {
  throw new Error(
    "[x402-e2e/facilitator] performRevokeVoucher is not yet wired — needs SellerActor.signMetaTxRevokeVoucher (see PR7 follow-up)",
  );
}

async function postPerformAction(
  actionId: FacilitatorOnlyActionId,
  args: FacilitatorPerformArgs,
  signedPayload: string,
): Promise<FacilitatorPerformResult> {
  const url = new URL("/perform-action", args.facilitatorUrl).toString();
  const body = {
    action: actionId,
    exchangeId: args.exchangeId,
    network: args.network,
    escrowAddress: args.escrowAddress,
    signedPayload,
  };
  const res = await globalThis.fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const parsed = (await res.json().catch(() => null)) as
    | { ok: true; txHash: Hex; newExchangeState: ExchangeState; newDisputeState?: DisputeState }
    | { ok: false; code?: string; reason?: string }
    | null;
  if (!res.ok || parsed === null || parsed.ok !== true) {
    throw new FacilitatorPerformError(actionId, res.status, parsed);
  }
  return parsed;
}
