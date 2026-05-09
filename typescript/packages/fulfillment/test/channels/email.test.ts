import { describe, expect, it, vi } from "vitest";

import { createEmailChannel, type EmailBuyerData } from "../../src/channels/email/index.js";

describe("email channel", () => {
  it("describes itself with a JSON-Schema-shaped buyer data schema", () => {
    const channel = createEmailChannel();
    const descriptor = channel.describe();
    expect(descriptor.id).toBe("email");
    expect(descriptor.schema).toMatchObject({
      type: "object",
      properties: { email: { type: "string", format: "email" } },
      required: ["email"],
      additionalProperties: false,
    });
  });

  it("surfaces optional descriptor metadata when configured", () => {
    const channel = createEmailChannel({
      send: async () => {},
      metadata: { from: "shop@example.com" },
    });
    expect(channel.describe().metadata).toEqual({ from: "shop@example.com" });
  });

  it("validates well-formed emails and rejects garbage", () => {
    const channel = createEmailChannel();
    expect(channel.validate({ email: "buyer@example.com" })).toEqual({ ok: true });
    const bad = channel.validate({ email: "not-an-email" } as EmailBuyerData);
    expect(bad).toMatchObject({ ok: false });
    expect(channel.validate({} as EmailBuyerData)).toMatchObject({ ok: false });
    expect(channel.validate({ email: "x@y.z", extra: 1 } as never)).toMatchObject({
      ok: false,
    });
  });

  it("onCommit stores by exchange id; onRedeem invokes send and returns a mailto pointer", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const channel = createEmailChannel({ send });

    await channel.onCommit("exch-1", { email: "buyer@example.com" });
    const result = await channel.onRedeem("exch-1");

    expect(send).toHaveBeenCalledWith("exch-1", { email: "buyer@example.com" });
    expect(result).toEqual({ kind: "async", pointer: "mailto:buyer@example.com" });
  });

  it("supports a caller-supplied store", async () => {
    const store = new Map<string, EmailBuyerData>();
    const channel = createEmailChannel({ send: async () => {}, store });

    await channel.onCommit("exch-2", { email: "x@y.z" });
    expect(store.get("exch-2")).toEqual({ email: "x@y.z" });
  });

  it("onRedeem rejects when not configured", async () => {
    const channel = createEmailChannel();
    await expect(channel.onRedeem("exch-1")).rejects.toThrow(/configure/);
  });

  it("onRedeem rejects when no commit data exists for the exchange", async () => {
    const channel = createEmailChannel({ send: async () => {} });
    await expect(channel.onRedeem("nonexistent")).rejects.toThrow(/no buyer data/);
  });
});
