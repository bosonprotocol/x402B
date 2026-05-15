// Unit coverage for the `Store<V>` contract and the `mapAsStore`
// adapter. The contract itself is a four-method async interface;
// `mapAsStore` is the one-line in-memory adapter the server defaults
// to when the host doesn't supply its own backing.

import { describe, expect, it } from "vitest";

import { isStore, mapAsStore, type Store } from "../src/store.js";

describe("mapAsStore", () => {
  it("round-trips through get/set/delete", async () => {
    const backing = new Map<string, number>();
    const store = mapAsStore(backing);

    expect(await store.get("a")).toBeUndefined();
    await store.set("a", 1);
    expect(await store.get("a")).toBe(1);
    await store.set("a", 2);
    expect(await store.get("a")).toBe(2);
    await store.delete("a");
    expect(await store.get("a")).toBeUndefined();
  });

  it("writes through to the underlying Map (no defensive copy)", async () => {
    const backing = new Map<string, string>();
    const store = mapAsStore(backing);
    await store.set("k", "v");
    expect(backing.get("k")).toBe("v");
    backing.set("k", "v2");
    expect(await store.get("k")).toBe("v2");
  });

  it("yields entries asynchronously", async () => {
    const backing = new Map<string, number>([
      ["a", 1],
      ["b", 2],
      ["c", 3],
    ]);
    const collected: Array<readonly [string, number]> = [];
    for await (const e of mapAsStore(backing).entries()) {
      collected.push(e);
    }
    expect(collected).toEqual([
      ["a", 1],
      ["b", 2],
      ["c", 3],
    ]);
  });
});

describe("isStore", () => {
  it("accepts a real mapAsStore adapter", () => {
    expect(isStore(mapAsStore(new Map()))).toBe(true);
  });

  it("accepts a Map structurally (Map has get/set/delete/entries)", () => {
    // Documented runtime behaviour: a raw `Map` instance satisfies the
    // structural shape. The recommended path is `mapAsStore(map)` so
    // the TS types stay honest, but pre-existing code passing a raw
    // Map keeps working at runtime.
    expect(isStore(new Map())).toBe(true);
  });

  it("rejects partial implementations", () => {
    expect(isStore({ get: () => undefined })).toBe(false);
    expect(isStore({ get: () => undefined, set: () => undefined, delete: () => undefined })).toBe(
      false,
    );
  });

  it("rejects nullish / non-objects", () => {
    expect(isStore(undefined)).toBe(false);
    expect(isStore(null)).toBe(false);
    expect(isStore(42)).toBe(false);
    expect(isStore("store")).toBe(false);
  });
});

describe("flakyStore fixture", () => {
  // A store that rejects every Nth set — the shape downstream branches
  // (recovery inspection / replay) will exercise to assert handlers
  // survive transient backing-store failures.
  function flakyStore<V>(backing: Map<string, V>, failEvery: number): Store<V> {
    let count = 0;
    return {
      async get(key) {
        return backing.get(key);
      },
      async set(key, value) {
        count += 1;
        if (count % failEvery === 0) {
          throw new Error(`flakyStore: set #${count} failed`);
        }
        backing.set(key, value);
      },
      async delete(key) {
        backing.delete(key);
      },
      async *entries() {
        for (const e of backing.entries()) yield e;
      },
    };
  }

  it("propagates errors from set so handlers can surface them as warnings", async () => {
    const backing = new Map<string, number>();
    const store = flakyStore(backing, 2);
    await store.set("a", 1);
    await expect(store.set("b", 2)).rejects.toThrow(/set #2 failed/);
    expect(backing.has("a")).toBe(true);
    expect(backing.has("b")).toBe(false);
  });
});
