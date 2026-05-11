import type { FulfillmentOption } from "@bosonprotocol/x402-core/schemes/escrow";
import { describe, expect, it, vi } from "vitest";

import type { FulfillmentChannel, FulfillmentResult } from "../../src/index.js";
import {
  DuplicateChannelError,
  FulfillmentRegistry,
  UnknownChannelError,
} from "../../src/registry/index.js";

interface FakeData {
  email: string;
}

function makeFakeChannel(
  id: string,
  overrides: Partial<FulfillmentChannel<unknown, FakeData>> = {},
): FulfillmentChannel<unknown, FakeData> {
  const descriptor: FulfillmentOption = {
    id,
    schema: { type: "object", properties: { email: { type: "string" } }, required: ["email"] },
    metadata: { hint: id },
  };
  return {
    id,
    buyerDataSchema: descriptor.schema,
    configure: vi.fn(),
    describe: vi.fn(() => descriptor),
    validate: vi.fn((data: FakeData) =>
      typeof data?.email === "string" && data.email.includes("@")
        ? ({ ok: true } as const)
        : ({ ok: false, reason: "invalid email" } as const),
    ),
    onCommit: vi.fn(async () => {}),
    onFulfill: vi.fn(
      async (): Promise<FulfillmentResult> => ({ kind: "async", pointer: `done:${id}` }),
    ),
    ...overrides,
  };
}

describe("FulfillmentRegistry", () => {
  it("registers and looks up channels by id", () => {
    const registry = new FulfillmentRegistry();
    const channel = makeFakeChannel("email");
    registry.register(channel);
    expect(registry.has("email")).toBe(true);
    expect(registry.lookup("email")).toBe(channel);
    expect(registry.ids()).toEqual(["email"]);
  });

  it("rejects duplicate ids", () => {
    const registry = new FulfillmentRegistry();
    registry.register(makeFakeChannel("email"));
    expect(() => registry.register(makeFakeChannel("email"))).toThrow(DuplicateChannelError);
  });

  it("describeAll() returns one descriptor per channel in insertion order", () => {
    const registry = new FulfillmentRegistry();
    registry.register(makeFakeChannel("xmtp"));
    registry.register(makeFakeChannel("email"));
    const all = registry.describeAll();
    expect(all.map((d) => d.id)).toEqual(["xmtp", "email"]);
    expect(all[0].metadata).toEqual({ hint: "xmtp" });
  });

  it("dispatches validate/onCommit/onFulfill to the named channel", async () => {
    const registry = new FulfillmentRegistry();
    const email = makeFakeChannel("email");
    registry.register(email);

    expect(registry.validate("email", { email: "buyer@example.com" })).toEqual({ ok: true });
    expect(registry.validate("email", { email: "nope" })).toEqual({
      ok: false,
      reason: "invalid email",
    });

    await registry.onCommit("email", "exch-1", { email: "buyer@example.com" });
    expect(email.onCommit).toHaveBeenCalledWith("exch-1", { email: "buyer@example.com" });

    await expect(registry.onFulfill("email", "exch-1")).resolves.toEqual({
      kind: "async",
      pointer: "done:email",
    });
  });

  it("throws UnknownChannelError for unregistered ids", async () => {
    const registry = new FulfillmentRegistry();
    expect(() => registry.validate("missing", {})).toThrow(UnknownChannelError);
    await expect(registry.onCommit("missing", "exch-1", {})).rejects.toBeInstanceOf(
      UnknownChannelError,
    );
    await expect(registry.onFulfill("missing", "exch-1")).rejects.toBeInstanceOf(
      UnknownChannelError,
    );
  });
});
