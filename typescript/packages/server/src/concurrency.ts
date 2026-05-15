// Per-key async mutex for exchange-scoped handlers. Two concurrent
// `redeem(exchangeId=X)` (or dispute/*, complete) requests would both
// pass the facilitator round-trip and race the post-settle
// channel.onCommit / store writes — channel adapters are only
// implicitly expected to be idempotent. The mutex serializes them so
// only one handler holds the exchange at a time within this process.
//
// Server-instance-local only. Multi-instance hosts rely on the
// idempotency-key + on-chain state checks for cross-process safety;
// the local mutex covers the single-process race that the new async
// `Store<V>` contract intentionally exposes (commit-time writes and
// redeem-time reads can interleave when the store is async).

export interface KeyedMutex<K> {
  /**
   * Run `fn` once any previously-queued work for `key` has settled.
   * Successive callers for the same `key` queue in FIFO order; callers
   * for different keys run independently.
   *
   * `fn`'s resolution and rejection are surfaced to the caller
   * directly — the mutex itself never alters the return value or
   * masks errors.
   */
  runExclusive<T>(key: K, fn: () => Promise<T>): Promise<T>;
}

export function createKeyedMutex<K>(): KeyedMutex<K> {
  const chains = new Map<K, Promise<unknown>>();
  return {
    runExclusive<T>(key: K, fn: () => Promise<T>): Promise<T> {
      const prev = chains.get(key) ?? Promise.resolve();
      // `then(fn, fn)` runs fn regardless of the prior chain's outcome —
      // a previous fn rejecting must not pin the key forever.
      const run: Promise<T> = prev.then(fn, fn);
      const tracked: Promise<unknown> = run.catch(() => undefined);
      chains.set(key, tracked);
      // Clean up the chain once *this* tail completes. Identity check
      // guards against deleting a later caller's chain entry.
      tracked.then(() => {
        if (chains.get(key) === tracked) chains.delete(key);
      });
      return run;
    },
  };
}
