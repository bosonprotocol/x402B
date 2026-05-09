import { describe, expect, it, vi } from "vitest";

import { createInlineChannel } from "../../src/channels/inline/index.js";

const encoder = new TextEncoder();

describe("inline channel", () => {
  it("describes itself with a null schema", () => {
    const channel = createInlineChannel();
    expect(channel.describe()).toEqual({ id: "inline", schema: null });
    expect(channel.buyerDataSchema).toBeNull();
  });

  it("validates only null buyer data", () => {
    const channel = createInlineChannel();
    expect(channel.validate(null)).toEqual({ ok: true });
    expect(channel.validate({} as never)).toMatchObject({ ok: false });
    expect(channel.validate("anything" as never)).toMatchObject({ ok: false });
  });

  it("onFulfill returns the body resolved by the configured resolver", async () => {
    const body = encoder.encode("hello");
    const resolve = vi.fn().mockResolvedValue({ body, contentType: "text/plain" });
    const channel = createInlineChannel({ resolve });

    await expect(channel.onFulfill("exch-1")).resolves.toEqual({
      kind: "inline",
      body,
      contentType: "text/plain",
    });
    expect(resolve).toHaveBeenCalledWith("exch-1");
  });

  it("supports late configuration via configure()", async () => {
    const channel = createInlineChannel();
    const body = encoder.encode("late");
    channel.configure({
      resolve: async () => ({ body, contentType: "application/octet-stream" }),
    });
    const result = await channel.onFulfill("exch-2");
    expect(result).toEqual({
      kind: "inline",
      body,
      contentType: "application/octet-stream",
    });
  });

  it("onFulfill rejects when not configured", async () => {
    const channel = createInlineChannel();
    await expect(channel.onFulfill("exch-3")).rejects.toThrow(/configure/);
  });

  it("onCommit is a no-op", async () => {
    const channel = createInlineChannel();
    await expect(channel.onCommit("exch-1", null)).resolves.toBeUndefined();
  });
});
