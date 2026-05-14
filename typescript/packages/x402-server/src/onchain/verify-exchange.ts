// On-chain (or off-chain — subgraph) verification of an exchange's
// state after a facilitator settle / perform-action. The reader is
// pluggable so callers can wire up a subgraph query, a viem RPC
// read, or core-sdk's `exchanges.handler.getExchange` without
// x402-server taking a hard dependency on any one mechanism.
//
// The verifier itself is pure: given a snapshot + the four-field
// expectation from boson-impl-02-flows.md Flow A/B "Verify" step
// (state, seller, exchangeToken, price), it returns a structured
// pass / fail result.

import { DisputeState, ExchangeState } from "@bosonprotocol/x402-actions";
import type { Address } from "@bosonprotocol/x402-core/schemes/escrow";

/**
 * Minimal protocol-level snapshot of an exchange the verifier needs.
 *
 * Sourced by `ExchangeReader.read` — typical implementations:
 *
 * - `@bosonprotocol/core-sdk`'s `coreSDK.getExchangeById` (subgraph
 *   round-trip; tolerant of indexer lag).
 * - A viem `publicClient.readContract` against
 *   `IBosonExchangeHandler.getExchange(exchangeId)` plus a follow-up
 *   `getOffer(offerId)` for `exchangeToken` + `price` (no indexer
 *   lag, costs an extra RPC call).
 */
export interface ExchangeSnapshot {
  state: ExchangeState;
  /** Present when `state === ExchangeState.DISPUTED`. */
  disputeState?: DisputeState;
  seller: Address;
  exchangeToken: Address;
  /** Atomic units, decimal string. */
  price: string;
}

/**
 * Pluggable reader for the post-settle / post-perform-action state
 * verification step. The reader returns `null` iff the exchange id
 * doesn't yet exist in the data source (subgraph not yet indexed,
 * `getExchange` reverts on a non-existent id, etc.). `verifyExchange`
 * retries transient not-found / stale-state results with a bounded wait.
 */
export interface ExchangeReader {
  read(exchangeId: string): Promise<ExchangeSnapshot | null>;
}

export interface VerifyExchangeExpected {
  state: ExchangeState;
  /** Present iff `state === ExchangeState.DISPUTED`. */
  disputeState?: DisputeState;
  seller: Address;
  exchangeToken: Address;
  price: string;
}

export type VerifyExchangeResult =
  | { ok: true }
  | { ok: false; code: VerifyExchangeErrorCode; field?: string; expected?: unknown; got?: unknown };

export type VerifyExchangeErrorCode =
  | "EXCHANGE_NOT_FOUND"
  | "STATE_MISMATCH"
  | "DISPUTE_STATE_MISMATCH"
  | "SELLER_MISMATCH"
  | "TOKEN_MISMATCH"
  | "PRICE_MISMATCH";

export interface VerifyExchangeOptions {
  /** Maximum read/compare attempts. Defaults to 3. */
  attempts?: number;
  /** Delay between retryable attempts in milliseconds. Defaults to 50. */
  delayMs?: number;
}

/**
 * Compare a snapshot against the expected post-state. Short-circuits
 * at the first mismatch. Pure; the reader does the I/O.
 */
export function verifyExchangeSnapshot(
  snapshot: ExchangeSnapshot | null,
  expected: VerifyExchangeExpected,
): VerifyExchangeResult {
  if (snapshot === null) {
    return { ok: false, code: "EXCHANGE_NOT_FOUND" };
  }
  if (snapshot.state !== expected.state) {
    return {
      ok: false,
      code: "STATE_MISMATCH",
      field: "state",
      expected: expected.state,
      got: snapshot.state,
    };
  }
  if (expected.state === ExchangeState.DISPUTED) {
    if (snapshot.disputeState !== expected.disputeState) {
      return {
        ok: false,
        code: "DISPUTE_STATE_MISMATCH",
        field: "disputeState",
        expected: expected.disputeState,
        got: snapshot.disputeState,
      };
    }
  }
  if (snapshot.seller.toLowerCase() !== expected.seller.toLowerCase()) {
    return {
      ok: false,
      code: "SELLER_MISMATCH",
      field: "seller",
      expected: expected.seller,
      got: snapshot.seller,
    };
  }
  if (snapshot.exchangeToken.toLowerCase() !== expected.exchangeToken.toLowerCase()) {
    return {
      ok: false,
      code: "TOKEN_MISMATCH",
      field: "exchangeToken",
      expected: expected.exchangeToken,
      got: snapshot.exchangeToken,
    };
  }
  if (snapshot.price !== expected.price) {
    return {
      ok: false,
      code: "PRICE_MISMATCH",
      field: "price",
      expected: expected.price,
      got: snapshot.price,
    };
  }
  return { ok: true };
}

/**
 * High-level convenience — read via the configured `ExchangeReader`
 * and apply `verifyExchangeSnapshot`. Retries boundedly when a reader
 * may be behind the just-mined transaction (`EXCHANGE_NOT_FOUND`,
 * `STATE_MISMATCH`, or `DISPUTE_STATE_MISMATCH`), then returns the
 * last comparison result.
 */
export async function verifyExchange(
  reader: ExchangeReader,
  exchangeId: string,
  expected: VerifyExchangeExpected,
  options: VerifyExchangeOptions = {},
): Promise<VerifyExchangeResult> {
  const attempts = Math.max(1, Math.floor(options.attempts ?? 3));
  const delayMs = Math.max(0, Math.floor(options.delayMs ?? 50));
  let result: VerifyExchangeResult = { ok: false, code: "EXCHANGE_NOT_FOUND" };

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const snapshot = await reader.read(exchangeId);
    result = verifyExchangeSnapshot(snapshot, expected);
    if (result.ok || !isRetryableVerifyResult(result) || attempt === attempts) {
      return result;
    }
    if (delayMs > 0) {
      await delay(delayMs);
    }
  }

  return result;
}

function isRetryableVerifyResult(result: VerifyExchangeResult): boolean {
  return (
    !result.ok &&
    (result.code === "EXCHANGE_NOT_FOUND" ||
      result.code === "STATE_MISMATCH" ||
      result.code === "DISPUTE_STATE_MISMATCH")
  );
}

async function delay(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}
