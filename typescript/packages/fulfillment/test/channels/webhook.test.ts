import { describe, expect, it, vi } from "vitest";

import { createWebhookChannel, type WebhookBuyerData } from "../../src/channels/webhook/index.js";

const URL_HTTPS = "https://buyer.example.com/x402b/deliver";

describe("webhook channel", () => {
  it("describes itself with a JSON-Schema-shaped buyer data schema", () => {
    const channel = createWebhookChannel();
    const descriptor = channel.describe();
    expect(descriptor.id).toBe("webhook");
    expect(descriptor.schema).toMatchObject({
      type: "object",
      properties: {
        url: { type: "string" },
        authToken: { type: "string" },
        encryptionPubKey: { type: "string" },
      },
      required: ["url"],
      additionalProperties: false,
    });
  });

  it("validates the minimal record (url only)", () => {
    const channel = createWebhookChannel();
    expect(channel.validate({ url: URL_HTTPS })).toEqual({ ok: true });
  });

  it("validates the full record (url + authToken + encryptionPubKey)", () => {
    const channel = createWebhookChannel();
    expect(
      channel.validate({
        url: URL_HTTPS,
        authToken: "tkn-abc123",
        encryptionPubKey: "0x04abcdef",
      }),
    ).toEqual({ ok: true });
  });

  it("rejects http (non-tls) endpoints", () => {
    const channel = createWebhookChannel();
    expect(
      channel.validate({ url: "http://buyer.example.com/x402b/deliver" } as WebhookBuyerData),
    ).toMatchObject({ ok: false });
  });

  it("accepts an uppercase HTTPS scheme (case-insensitive)", () => {
    const channel = createWebhookChannel();
    expect(
      channel.validate({ url: "HTTPS://buyer.example.com/x402b/deliver" } as WebhookBuyerData),
    ).toEqual({ ok: true });
  });

  it("rejects malformed urls", () => {
    const channel = createWebhookChannel();
    expect(channel.validate({ url: "not-a-url" } as WebhookBuyerData)).toMatchObject({
      ok: false,
    });
  });

  it("rejects empty optional fields if present", () => {
    const channel = createWebhookChannel();
    expect(channel.validate({ url: URL_HTTPS, authToken: "" })).toMatchObject({ ok: false });
    expect(channel.validate({ url: URL_HTTPS, encryptionPubKey: "" })).toMatchObject({
      ok: false,
    });
  });

  it("rejects whitespace-only optional fields", () => {
    const channel = createWebhookChannel();
    expect(channel.validate({ url: URL_HTTPS, authToken: "   " })).toMatchObject({ ok: false });
    expect(channel.validate({ url: URL_HTTPS, encryptionPubKey: "\t\n" })).toMatchObject({
      ok: false,
    });
  });

  it("rejects extra keys (strict mode)", () => {
    const channel = createWebhookChannel();
    expect(channel.validate({ url: URL_HTTPS, extra: 1 } as never)).toMatchObject({
      ok: false,
    });
  });

  it("onCommit stores by exchange id; onFulfill invokes send and returns the buyer url as pointer", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const channel = createWebhookChannel({ send });
    const data: WebhookBuyerData = { url: URL_HTTPS, authToken: "tkn" };

    await channel.onCommit("exch-1", data);
    const result = await channel.onFulfill("exch-1");

    expect(send).toHaveBeenCalledWith("exch-1", data);
    expect(result).toEqual({ kind: "async", pointer: URL_HTTPS });
  });

  it("supports a caller-supplied store", async () => {
    const store = new Map<string, WebhookBuyerData>();
    const channel = createWebhookChannel({ send: async () => {}, store });
    const data: WebhookBuyerData = { url: URL_HTTPS };
    await channel.onCommit("exch-2", data);
    expect(store.get("exch-2")).toEqual(data);
  });

  it("onFulfill rejects when not configured", async () => {
    const channel = createWebhookChannel();
    await expect(channel.onFulfill("exch-1")).rejects.toThrow(/configure/);
  });

  it("onFulfill rejects when no commit data exists for the exchange", async () => {
    const channel = createWebhookChannel({ send: async () => {} });
    await expect(channel.onFulfill("nonexistent")).rejects.toThrow(/no buyer data/);
  });
});
