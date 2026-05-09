import { describe, expect, it, vi } from "vitest";

import { createAtomicHttpChannel } from "../../src/channels/atomic-http/index.js";

const encoder = new TextEncoder();

describe("atomic-http channel", () => {
  it("describes itself with a null schema", () => {
    const channel = createAtomicHttpChannel();
    expect(channel.describe()).toEqual({ id: "atomic-http", schema: null });
    expect(channel.buyerDataSchema).toBeNull();
  });

  it("validates only null buyer data", () => {
    const channel = createAtomicHttpChannel();
    expect(channel.validate(null)).toEqual({ ok: true });
    expect(channel.validate({} as never)).toMatchObject({ ok: false });
    expect(channel.validate("anything" as never)).toMatchObject({ ok: false });
  });

  it("onRedeem returns the body resolved by the configured resolver", async () => {
    const body = encoder.encode("hello");
    const resolve = vi.fn().mockResolvedValue({ body, contentType: "text/plain" });
    const channel = createAtomicHttpChannel({ resolve });

    await expect(channel.onRedeem("exch-1")).resolves.toEqual({
      kind: "atomic",
      body,
      contentType: "text/plain",
    });
    expect(resolve).toHaveBeenCalledWith("exch-1");
  });

  it("supports late configuration via configure()", async () => {
    const channel = createAtomicHttpChannel();
    const body = encoder.encode("late");
    channel.configure({
      resolve: async () => ({ body, contentType: "application/octet-stream" }),
    });
    const result = await channel.onRedeem("exch-2");
    expect(result).toEqual({
      kind: "atomic",
      body,
      contentType: "application/octet-stream",
    });
  });

  it("onRedeem rejects when not configured", async () => {
    const channel = createAtomicHttpChannel();
    await expect(channel.onRedeem("exch-3")).rejects.toThrow(/configure/);
  });

  it("onCommit is a no-op", async () => {
    const channel = createAtomicHttpChannel();
    await expect(channel.onCommit("exch-1", null)).resolves.toBeUndefined();
  });
});
