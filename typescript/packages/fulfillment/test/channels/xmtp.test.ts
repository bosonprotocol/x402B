import { describe, expect, it, vi } from "vitest";

import { createXmtpChannel, type XmtpBuyerData } from "../../src/channels/xmtp/index.js";

const VALID_ADDRESS = "0x1234567890abcdefABCDEF1234567890abcdef12";

describe("xmtp channel", () => {
  it("describes itself with a JSON-Schema-shaped buyer data schema", () => {
    const channel = createXmtpChannel();
    const descriptor = channel.describe();
    expect(descriptor.id).toBe("xmtp");
    expect(descriptor.schema).toMatchObject({
      type: "object",
      properties: { xmtpAddress: { type: "string" } },
      required: ["xmtpAddress"],
      additionalProperties: false,
    });
  });

  it("surfaces optional descriptor metadata when configured", () => {
    const channel = createXmtpChannel({
      send: async () => {},
      metadata: { sellerXmtp: VALID_ADDRESS },
    });
    expect(channel.describe().metadata).toEqual({ sellerXmtp: VALID_ADDRESS });
  });

  it("validates 0x-prefixed 20-byte addresses and rejects malformed inputs", () => {
    const channel = createXmtpChannel();
    expect(channel.validate({ xmtpAddress: VALID_ADDRESS })).toEqual({ ok: true });
    expect(channel.validate({ xmtpAddress: VALID_ADDRESS.toLowerCase() })).toEqual({ ok: true });

    expect(channel.validate({ xmtpAddress: "0xnothex" } as XmtpBuyerData)).toMatchObject({
      ok: false,
    });
    expect(channel.validate({ xmtpAddress: "0x1234" } as XmtpBuyerData)).toMatchObject({
      ok: false,
    });
    expect(channel.validate({} as XmtpBuyerData)).toMatchObject({ ok: false });
    expect(channel.validate({ xmtpAddress: VALID_ADDRESS, extra: 1 } as never)).toMatchObject({
      ok: false,
    });
  });

  it("onCommit stores by exchange id; onRedeem invokes send and returns an xmtp: pointer", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const channel = createXmtpChannel({ send });

    await channel.onCommit("exch-1", { xmtpAddress: VALID_ADDRESS });
    const result = await channel.onRedeem("exch-1");

    expect(send).toHaveBeenCalledWith("exch-1", { xmtpAddress: VALID_ADDRESS });
    expect(result).toEqual({ kind: "async", pointer: `xmtp:${VALID_ADDRESS}` });
  });

  it("supports a caller-supplied store", async () => {
    const store = new Map<string, XmtpBuyerData>();
    const channel = createXmtpChannel({ send: async () => {}, store });

    await channel.onCommit("exch-2", { xmtpAddress: VALID_ADDRESS });
    expect(store.get("exch-2")).toEqual({ xmtpAddress: VALID_ADDRESS });
  });

  it("onRedeem rejects when not configured", async () => {
    const channel = createXmtpChannel();
    await expect(channel.onRedeem("exch-1")).rejects.toThrow(/configure/);
  });

  it("onRedeem rejects when no commit data exists for the exchange", async () => {
    const channel = createXmtpChannel({ send: async () => {} });
    await expect(channel.onRedeem("nonexistent")).rejects.toThrow(/no buyer data/);
  });
});
