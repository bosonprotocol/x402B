// Typed errors thrown by `@bosonprotocol/x402-evm` builders.

/**
 * Thrown when a builder is invoked for a Boson action whose on-chain
 * primitive (or the core-sdk encoder for it) has not yet shipped. The
 * deferred actions for v0.1 are:
 *
 *   - `createOfferCommitAndRedeem` — blocked on Boson contracts PR #1105.
 *   - `executeMetaTransactionWithTokenTransferAuthorization` — blocked on
 *      BPIP-12 landing in `MetaTransactionsHandlerFacet`.
 *
 * Callers can `catch (e) { if (e instanceof NotYetSupportedError) … }` to
 * fall back to a supported action (e.g. `createOfferAndCommit`).
 */
export class NotYetSupportedError extends Error {
  readonly name = "NotYetSupportedError" as const;
  readonly builder: string;

  constructor(builder: string, reason: string) {
    super(`@bosonprotocol/x402-evm: ${builder} is not supported yet — ${reason}`);
    this.builder = builder;
  }
}
