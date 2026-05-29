// Async key/value store contract for server-side per-exchange state
// (fulfillment option policy + recovery queue). Map-shaped on purpose
// so an in-memory `Map` wraps via `mapAsStore` and Redis/Postgres
// back-ends implement four methods.
//
// The defaults wired up by `createX402bServer` use `mapAsStore(new Map())`
// so dev / single-process deployments need no extra plumbing; hosts
// running multiple instances or who need to survive a restart plug in
// their own implementation.

/**
 * Minimal async key/value store. `get` / `set` / `delete` are the
 * hot-path handler operations; `entries` is consumed by the
 * recovery-inspection surface (`recovery.list`) and stays optional in
 * spirit by being a method on the same interface — wrapping a `Map`
 * via `mapAsStore` makes all four trivial.
 */
export interface Store<V> {
  get(key: string): Promise<V | undefined>;
  set(key: string, value: V): Promise<void>;
  delete(key: string): Promise<void>;
  entries(): AsyncIterable<readonly [string, V]>;
}

/**
 * Wrap an in-memory `Map` as a `Store<V>`. The adapter is intentionally
 * cheap — no copies, no locking — so single-process tests and dev
 * deployments pay zero overhead versus the previous direct-`Map`
 * shape.
 */
export function mapAsStore<V>(m: Map<string, V>): Store<V> {
  return {
    async get(key) {
      return m.get(key);
    },
    async set(key, value) {
      m.set(key, value);
    },
    async delete(key) {
      m.delete(key);
    },
    async *entries() {
      for (const e of m.entries()) yield e;
    },
  };
}

/**
 * Structural type-guard for the `Store<V>` shape. Used by
 * `x402bServerConfigSchema` to validate host-supplied stores without
 * locking the contract to `Map` (the previous `z.instanceof(Map)`
 * accepted only the concrete `Map` class).
 */
export function isStore(value: unknown): value is Store<unknown> {
  if (value === null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.get === "function" &&
    typeof v.set === "function" &&
    typeof v.delete === "function" &&
    typeof v.entries === "function"
  );
}
