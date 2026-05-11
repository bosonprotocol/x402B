import { describe, expect, it } from "vitest";

import type { EscrowPaymentRequirements } from "@bosonprotocol/x402-core/schemes/escrow";

import { FulfillmentValidationError } from "../src/errors.js";
import { resolveFulfillment } from "../src/fulfillment.js";

function baseRequirements(): EscrowPaymentRequirements {
  return {
    scheme: "escrow",
    network: "eip155:8453",
    asset: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
    amount: "1000000",
    escrowAddress: "0xdddddddddddddddddddddddddddddddddddddddd",
    recipientId: "did:boson:seller:1",
    maxTimeoutSeconds: 300,
    offer: {
      fullOffer: { id: "0" },
      sellerSig: "0xdeadbeef",
      creator: "0x1111111111111111111111111111111111111111",
    },
    tokenAuthStrategies: ["erc3009"],
    actions: { next: [{ id: "boson-createOfferAndCommit", channels: ["server"] }] },
  };
}

describe("resolveFulfillment", () => {
  it("returns undefined when fulfillment is absent in requirements", () => {
    const req = baseRequirements();
    expect(resolveFulfillment(req, {})).toBeUndefined();
  });

  it("returns undefined when requirements.fulfillment.required is false", () => {
    const req = baseRequirements();
    req.fulfillment = { required: false, options: [{ id: "atomic", schema: null }] };
    expect(resolveFulfillment(req, {})).toBeUndefined();
  });

  it("throws when required but no fulfillment in config", () => {
    const req = baseRequirements();
    req.fulfillment = { required: true, options: [{ id: "atomic", schema: null }] };
    expect(() => resolveFulfillment(req, {})).toThrow(FulfillmentValidationError);
  });

  it("throws when chosen option is not advertised", () => {
    const req = baseRequirements();
    req.fulfillment = { required: true, options: [{ id: "atomic", schema: null }] };
    expect(() => resolveFulfillment(req, { fulfillment: { option: "email", data: {} } })).toThrow(
      /not advertised/,
    );
  });

  it("accepts atomic option (schema: null) without validating data", () => {
    const req = baseRequirements();
    req.fulfillment = { required: true, options: [{ id: "atomic", schema: null }] };
    expect(resolveFulfillment(req, { fulfillment: { option: "atomic", data: {} } })).toEqual({
      option: "atomic",
      data: {},
    });
  });

  it("accepts data that validates against the option's JSON Schema", () => {
    const req = baseRequirements();
    req.fulfillment = {
      required: true,
      options: [{ id: "email", schema: { type: "object", required: ["email"] } }],
    };
    expect(
      resolveFulfillment(req, {
        fulfillment: { option: "email", data: { email: "buyer@example.com" } },
      }),
    ).toEqual({ option: "email", data: { email: "buyer@example.com" } });
  });

  it("throws when data fails the option's JSON Schema", () => {
    const req = baseRequirements();
    req.fulfillment = {
      required: true,
      options: [{ id: "email", schema: { type: "object", required: ["email"] } }],
    };
    expect(() => resolveFulfillment(req, { fulfillment: { option: "email", data: {} } })).toThrow(
      FulfillmentValidationError,
    );
  });
});
