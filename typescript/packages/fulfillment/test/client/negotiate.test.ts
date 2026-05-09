import type { FulfillmentOption } from "@bosonprotocol/x402-core/schemes/escrow";
import { describe, expect, it, vi } from "vitest";

import { negotiateFulfillment, NoCompatibleFulfillmentError } from "../../src/client/index.js";

const ATOMIC_HTTP: FulfillmentOption = { id: "atomic-http", schema: null };
const EMAIL: FulfillmentOption = {
  id: "email",
  schema: { type: "object", required: ["email"], properties: { email: { type: "string" } } },
};
const XMTP: FulfillmentOption = {
  id: "xmtp",
  schema: {
    type: "object",
    required: ["xmtpAddress"],
    properties: { xmtpAddress: { type: "string" } },
  },
};

describe("negotiateFulfillment", () => {
  it("returns a schemaless option immediately with data: null", async () => {
    const choice = await negotiateFulfillment([ATOMIC_HTTP, EMAIL], {
      supports: ["atomic-http", "email"],
    });
    expect(choice).toEqual({ option: "atomic-http", data: null });
  });

  it("honours `prefer` ordering when both options are supported", async () => {
    const choice = await negotiateFulfillment([ATOMIC_HTTP, XMTP], {
      supports: ["atomic-http", "xmtp"],
      prefer: ["xmtp", "atomic-http"],
      agentContext: { xmtpAddress: "0xabc" },
    });
    expect(choice).toEqual({ option: "xmtp", data: { xmtpAddress: "0xabc" } });
  });

  it("skips options the client doesn't support", async () => {
    const choice = await negotiateFulfillment([XMTP, EMAIL], {
      supports: ["email"],
      agentContext: { email: "buyer@example.com" },
    });
    expect(choice.option).toBe("email");
    expect(choice.data).toEqual({ email: "buyer@example.com" });
  });

  it("falls back to collectInteractive when agentContext is missing required fields", async () => {
    const collectInteractive = vi.fn().mockResolvedValue({ email: "buyer@example.com" });
    const choice = await negotiateFulfillment([EMAIL], {
      supports: ["email"],
      agentContext: {},
      collectInteractive,
    });
    expect(collectInteractive).toHaveBeenCalledWith(EMAIL);
    expect(choice).toEqual({ option: "email", data: { email: "buyer@example.com" } });
  });

  it("throws NoCompatibleFulfillmentError when no option matches", async () => {
    const tryNegotiate = negotiateFulfillment([EMAIL, XMTP], {
      supports: ["email", "xmtp"],
      agentContext: {},
    });
    await expect(tryNegotiate).rejects.toBeInstanceOf(NoCompatibleFulfillmentError);
    await expect(tryNegotiate).rejects.toMatchObject({ tried: ["email", "xmtp"] });
  });

  it("throws NoCompatibleFulfillmentError with empty tried[] when seller advertised no options", async () => {
    await expect(negotiateFulfillment([], { supports: ["email"] })).rejects.toMatchObject({
      tried: [],
    });
  });

  it("rejects collectInteractive output that misses required keys and keeps trying", async () => {
    const collectInteractive = vi.fn(async (opt: FulfillmentOption) =>
      opt.id === "email" ? {} : { xmtpAddress: "0xabc" },
    );
    const choice = await negotiateFulfillment([EMAIL, XMTP], {
      supports: ["email", "xmtp"],
      collectInteractive,
    });
    expect(choice).toEqual({ option: "xmtp", data: { xmtpAddress: "0xabc" } });
    expect(collectInteractive).toHaveBeenCalledTimes(2);
  });
});
