// Drive a post-commit buyer action through the example resource
// server's `/x402B/<route>` HTTP surface (mounted by
// `@bosonprotocol/x402-server-express`). Wraps:
//
//   1. `BuyerActor.client.signAction(...)` → produces the `signedPayload`
//      hex the server route expects.
//   2. `fetch(...)` POST to the right route — the mapping from
//      `actionId` → URL path mirrors `server-express/src/mount.ts`.
//   3. JSON parse + minimal shape coerce so scenarios can assert on
//      `txHash` / `newExchangeState` / `newDisputeState` directly.
//
// Scoped to buyer-initiated actions today: `boson-redeem`,
// `boson-completeExchange`, `boson-raiseDispute`, `boson-resolveDispute`,
// `boson-retractDispute`, `boson-escalateDispute`. The server-express
// router does not expose `cancelVoucher` / `revokeVoucher` /
// `decideDispute` — those routes don't exist, so scenarios reach
// them via the facilitator's `POST /perform-action` directly (see
// `facilitator-perform-action.ts`).

import type { ExchangeState, DisputeState } from "@bosonprotocol/x402-actions";
import type { Address, Hex } from "viem";

import type { BuyerActor } from "./buyer-actor.js";

/** Buyer-driven post-commit actions the server-express router mounts. */
export type BuyerPostCommitActionId =
  | "boson-redeem"
  | "boson-completeExchange"
  | "boson-raiseDispute"
  | "boson-resolveDispute"
  | "boson-retractDispute"
  | "boson-escalateDispute";

/** Path segment under `/x402B/` for each supported action. */
const POST_COMMIT_ROUTE: Record<BuyerPostCommitActionId, string> = {
  "boson-redeem": "redeem",
  "boson-completeExchange": "complete",
  "boson-raiseDispute": "dispute/raise",
  "boson-resolveDispute": "dispute/resolve",
  "boson-retractDispute": "dispute/retract",
  "boson-escalateDispute": "dispute/escalate",
};

/** Counterparty (seller) signature shape — matches `SignedResolutionProposal` or a raw hex. */
type CounterpartySig = Hex | { r: Hex; s: Hex; v: number };

/**
 * Args to `performBuyerPostCommitAction`. `boson-resolveDispute` is the
 * one action that needs extra fields (`buyerPercent`, `counterpartySig`);
 * every other id sticks to the base set.
 */
export type PerformBuyerPostCommitActionArgs =
  | (BasePerformArgs & {
      actionId: Exclude<BuyerPostCommitActionId, "boson-resolveDispute">;
    })
  | (BasePerformArgs & {
      actionId: "boson-resolveDispute";
      buyerPercent: bigint | string | number;
      counterpartySig: CounterpartySig;
    });

interface BasePerformArgs {
  buyer: BuyerActor;
  /** Resource server's base URL (e.g. `http://127.0.0.1:<port>`). */
  resourceServerUrl: string;
  /** Disputed/committed exchange id. */
  exchangeId: string;
  /** Escrow address (Boson Diamond) — the EIP-712 verifyingContract. */
  escrowAddress: Address;
  /** CAIP-2 network id (e.g. `"eip155:31337"`). */
  network: string;
  /** Optional redeem-only fulfillment payload, forwarded verbatim to the server route. */
  fulfillment?: { option: string; data: Record<string, unknown> | null };
}

/** Successful post-commit response (mirrors `PerformActionOk` in the server handlers). */
export interface PostCommitActionResult {
  txHash: Hex;
  newExchangeState: ExchangeState;
  newDisputeState?: DisputeState;
}

/**
 * Thrown when the server responds with a non-2xx status. The
 * `body` field carries the parsed JSON error envelope (`{ code, reason }`)
 * so scenarios can assert against `error.body.code` for validation
 * negatives without having to re-parse the response.
 */
export class PostCommitActionError extends Error {
  readonly status: number;
  readonly body: unknown;
  constructor(actionId: BuyerPostCommitActionId, status: number, body: unknown) {
    super(`[x402-e2e/post-commit-http] ${actionId} → HTTP ${status}: ${safeStringify(body)}`);
    this.name = "PostCommitActionError";
    this.status = status;
    this.body = body;
  }
}

/**
 * Sign the action through the buyer's client, POST it to the right
 * `/x402B/<route>`, and return the parsed success body. Throws
 * `PostCommitActionError` on non-2xx so scenarios don't need to
 * decode error envelopes by hand.
 */
export async function performBuyerPostCommitAction(
  args: PerformBuyerPostCommitActionArgs,
): Promise<PostCommitActionResult> {
  const { buyer, resourceServerUrl, exchangeId, escrowAddress, network, actionId } = args;

  const signed =
    actionId === "boson-resolveDispute"
      ? await buyer.client.signAction({
          actionId,
          exchangeId,
          network,
          escrowAddress,
          buyerPercent: args.buyerPercent,
          counterpartySig: args.counterpartySig,
        })
      : await buyer.client.signAction({
          actionId,
          exchangeId,
          network,
          escrowAddress,
        });

  const route = POST_COMMIT_ROUTE[actionId];
  const url = `${resourceServerUrl}/x402B/${route}`;
  const body: Record<string, unknown> = {
    exchangeId,
    signedPayload: signed.signedPayload,
  };
  if (actionId === "boson-redeem" && args.fulfillment !== undefined) {
    body.fulfillment = args.fulfillment;
  }

  const res = await globalThis.fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  const parsed = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) {
    throw new PostCommitActionError(actionId, res.status, parsed);
  }
  if (parsed === null || typeof parsed !== "object") {
    throw new PostCommitActionError(actionId, res.status, parsed);
  }
  return parsed as PostCommitActionResult;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
