import { describe, expect, it, vi } from "vitest";

import {
  createIpfsPointerChannel,
  type IpfsPointerBuyerData,
} from "../../src/channels/ipfs-pointer/index.js";

const CID = "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi";

describe("ipfs-pointer channel", () => {
  it("describes itself with a JSON-Schema-shaped buyer data schema", () => {
    const channel = createIpfsPointerChannel();
    const descriptor = channel.describe();
    expect(descriptor.id).toBe("ipfs-pointer");
    expect(descriptor.schema).toMatchObject({
      type: "object",
      properties: { recipientPubKey: { type: "string" } },
      additionalProperties: false,
    });
    expect((descriptor.schema as { required?: string[] }).required).toBeUndefined();
  });

  it("surfaces optional descriptor metadata when configured", () => {
    const channel = createIpfsPointerChannel({
      upload: async () => CID,
      metadata: { gateway: "https://w3s.link/ipfs/" },
    });
    expect(channel.describe().metadata).toEqual({ gateway: "https://w3s.link/ipfs/" });
  });

  it("validates with and without recipientPubKey", () => {
    const channel = createIpfsPointerChannel();
    expect(channel.validate({})).toEqual({ ok: true });
    expect(channel.validate({ recipientPubKey: "0x04abcdef" })).toEqual({ ok: true });
  });

  it("rejects empty recipientPubKey when present", () => {
    const channel = createIpfsPointerChannel();
    expect(channel.validate({ recipientPubKey: "" })).toMatchObject({ ok: false });
  });

  it("rejects whitespace-only recipientPubKey", () => {
    const channel = createIpfsPointerChannel();
    expect(channel.validate({ recipientPubKey: "   " })).toMatchObject({ ok: false });
    expect(channel.validate({ recipientPubKey: "\t\n" })).toMatchObject({ ok: false });
  });

  it("rejects extra keys (strict mode)", () => {
    const channel = createIpfsPointerChannel();
    expect(channel.validate({ extra: 1 } as never)).toMatchObject({ ok: false });
  });

  it("onCommit stores by exchange id; onFulfill uploads and returns an ipfs:// pointer", async () => {
    const upload = vi.fn().mockResolvedValue(CID);
    const channel = createIpfsPointerChannel({ upload });
    const data: IpfsPointerBuyerData = { recipientPubKey: "0x04abcdef" };

    await channel.onCommit("exch-1", data);
    const result = await channel.onFulfill("exch-1");

    expect(upload).toHaveBeenCalledWith("exch-1", data);
    expect(result).toEqual({ kind: "async", pointer: `ipfs://${CID}` });
  });

  it("onFulfill works with no recipientPubKey supplied", async () => {
    const upload = vi.fn().mockResolvedValue(CID);
    const channel = createIpfsPointerChannel({ upload });

    await channel.onCommit("exch-2", {});
    const result = await channel.onFulfill("exch-2");

    expect(upload).toHaveBeenCalledWith("exch-2", {});
    expect(result).toEqual({ kind: "async", pointer: `ipfs://${CID}` });
  });

  it("supports a caller-supplied store", async () => {
    const store = new Map<string, IpfsPointerBuyerData>();
    const channel = createIpfsPointerChannel({ upload: async () => CID, store });
    await channel.onCommit("exch-3", { recipientPubKey: "0x04abcdef" });
    expect(store.get("exch-3")).toEqual({ recipientPubKey: "0x04abcdef" });
  });

  it("onFulfill rejects when not configured", async () => {
    const channel = createIpfsPointerChannel();
    await expect(channel.onFulfill("exch-1")).rejects.toThrow(/configure/);
  });

  it("onFulfill rejects when no commit data exists for the exchange", async () => {
    const channel = createIpfsPointerChannel({ upload: async () => CID });
    await expect(channel.onFulfill("nonexistent")).rejects.toThrow(/no buyer data/);
  });

  it("strips an `ipfs://` or `/ipfs/` prefix the upload adapter may have added", async () => {
    const channel = createIpfsPointerChannel({ upload: async () => `ipfs://${CID}` });
    await channel.onCommit("exch-prefix", {});
    await expect(channel.onFulfill("exch-prefix")).resolves.toEqual({
      kind: "async",
      pointer: `ipfs://${CID}`,
    });

    const channel2 = createIpfsPointerChannel({ upload: async () => `/ipfs/${CID}` });
    await channel2.onCommit("exch-prefix-2", {});
    await expect(channel2.onFulfill("exch-prefix-2")).resolves.toEqual({
      kind: "async",
      pointer: `ipfs://${CID}`,
    });
  });

  it("rejects an empty CID from the upload adapter", async () => {
    const channel = createIpfsPointerChannel({ upload: async () => "   " });
    await channel.onCommit("exch-empty", {});
    await expect(channel.onFulfill("exch-empty")).rejects.toThrow(/empty CID/);
  });

  it("rejects an invalid CID containing illegal characters", async () => {
    const channel = createIpfsPointerChannel({ upload: async () => "not/a/cid" });
    await channel.onCommit("exch-bad", {});
    await expect(channel.onFulfill("exch-bad")).rejects.toThrow(/invalid CID/);
  });
});
