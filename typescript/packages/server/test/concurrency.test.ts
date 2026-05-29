// Unit coverage for `createKeyedMutex`. The mutex serializes work per
// key (FIFO), runs distinct keys independently, and never pins a key
// after a rejecting `fn`.

import { describe, expect, it } from "vitest";

import { createKeyedMutex } from "../src/concurrency.js";

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (err: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("createKeyedMutex", () => {
  it("serializes work for the same key (FIFO)", async () => {
    const mutex = createKeyedMutex<string>();
    const order: number[] = [];
    const a = deferred<void>();
    const b = deferred<void>();

    const p1 = mutex.runExclusive("x", async () => {
      order.push(1);
      await a.promise;
      order.push(2);
    });
    const p2 = mutex.runExclusive("x", async () => {
      order.push(3);
      await b.promise;
      order.push(4);
    });

    // p2 must not have started while p1 was awaiting.
    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual([1]);

    a.resolve();
    await p1;
    // p2 has been allowed to start now.
    await Promise.resolve();
    expect(order).toEqual([1, 2, 3]);

    b.resolve();
    await p2;
    expect(order).toEqual([1, 2, 3, 4]);
  });

  it("runs different keys concurrently", async () => {
    const mutex = createKeyedMutex<string>();
    const order: string[] = [];
    const a = deferred<void>();
    const b = deferred<void>();

    const p1 = mutex.runExclusive("x", async () => {
      order.push("x-start");
      await a.promise;
      order.push("x-end");
    });
    const p2 = mutex.runExclusive("y", async () => {
      order.push("y-start");
      await b.promise;
      order.push("y-end");
    });

    // Both should have started despite neither having resolved.
    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual(["x-start", "y-start"]);

    b.resolve();
    await p2;
    a.resolve();
    await p1;
    expect(order).toEqual(["x-start", "y-start", "y-end", "x-end"]);
  });

  it("never pins a key after a rejecting fn", async () => {
    const mutex = createKeyedMutex<string>();
    const p1 = mutex.runExclusive("x", async () => {
      throw new Error("boom");
    });
    await expect(p1).rejects.toThrow(/boom/);

    // The next call for the same key must still run.
    const p2 = mutex.runExclusive("x", async () => 42);
    await expect(p2).resolves.toBe(42);
  });

  it("propagates fn's resolution value", async () => {
    const mutex = createKeyedMutex<string>();
    const result = await mutex.runExclusive("x", async () => ({ ok: true, n: 7 }));
    expect(result).toEqual({ ok: true, n: 7 });
  });

  it("FIFO is preserved across many enqueued calls", async () => {
    const mutex = createKeyedMutex<string>();
    const N = 10;
    const observed: number[] = [];
    const runs = Array.from({ length: N }, (_, i) =>
      mutex.runExclusive("k", async () => {
        observed.push(i);
        await Promise.resolve();
      }),
    );
    await Promise.all(runs);
    expect(observed).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
});
