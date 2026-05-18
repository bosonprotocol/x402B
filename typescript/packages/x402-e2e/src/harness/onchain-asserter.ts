// `OnchainAsserter` — wraps the harness `ExchangeReader` with assertion
// helpers scenario tests call directly. The thin wrapper layer keeps
// the test files terse:
//
//   await asserter.expectState(exchangeId, ExchangeState.COMMITTED);
//
// rather than threading the reader through every `expect(...)`. Re-uses
// `verifyExchangeSnapshot` from `@bosonprotocol/x402-server` so the
// comparison rules match the server's own post-settle verification.

import {
  verifyExchangeSnapshot,
  type ExchangeReader,
  type ExchangeSnapshot,
  type VerifyExchangeExpected,
} from "@bosonprotocol/x402-server";

export interface ExpectStateArgs extends VerifyExchangeExpected {
  /** Maximum retries to allow for subgraph indexer lag. Default: 20 (~10s at 500ms interval). */
  attempts?: number;
  /** Delay between retries in ms. Default: 500. */
  delayMs?: number;
}

export interface OnchainAsserter {
  /** Returns the current snapshot, or `null` if the subgraph hasn't indexed the exchange yet. */
  snapshot(exchangeId: string): Promise<ExchangeSnapshot | null>;
  /**
   * Poll the reader until the snapshot matches `expected` (using
   * `verifyExchangeSnapshot`'s comparison rules) or the retry budget
   * runs out. Throws a structured error on persistent mismatch — the
   * thrown message includes the discriminated-union result so a
   * scenario test failure pinpoints which field diverged.
   */
  expect(exchangeId: string, expected: ExpectStateArgs): Promise<ExchangeSnapshot>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function createOnchainAsserter(reader: ExchangeReader): OnchainAsserter {
  return {
    snapshot: (exchangeId) => reader.read(exchangeId),

    async expect(exchangeId, expected) {
      const attempts = expected.attempts ?? 20;
      const delayMs = expected.delayMs ?? 500;

      let lastResult: ReturnType<typeof verifyExchangeSnapshot> | undefined;
      for (let attempt = 0; attempt < attempts; attempt++) {
        const snapshot = await reader.read(exchangeId);
        if (snapshot !== null) {
          const verifyExpected: VerifyExchangeExpected = {
            state: expected.state,
            seller: expected.seller,
            exchangeToken: expected.exchangeToken,
            price: expected.price,
            ...(expected.disputeState !== undefined ? { disputeState: expected.disputeState } : {}),
          };
          const result = verifyExchangeSnapshot(snapshot, verifyExpected);
          if (result.ok) return snapshot;
          lastResult = result;
        }
        if (attempt < attempts - 1) await sleep(delayMs);
      }

      throw new Error(
        `OnchainAsserter.expect(${exchangeId}) failed after ${attempts} attempts: ${
          lastResult ? JSON.stringify(lastResult) : "exchange never indexed"
        }`,
      );
    },
  };
}
