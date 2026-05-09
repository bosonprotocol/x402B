import { describe, expectTypeOf, it } from "vitest";

import type {
  FulfillmentChannel,
  FulfillmentOptionDescriptor,
  FulfillmentResult,
} from "../src/index.js";

describe("@bosonprotocol/x402-fulfillment public types", () => {
  it("FulfillmentResult is a discriminated union of atomic | async", () => {
    const atomic: FulfillmentResult = {
      kind: "atomic",
      body: new Uint8Array([0x4f, 0x4b]),
      contentType: "text/plain",
    };
    const async: FulfillmentResult = { kind: "async", pointer: "ipfs://bafy" };
    expectTypeOf(atomic.kind).toEqualTypeOf<"atomic" | "async">();
    expectTypeOf(async.kind).toEqualTypeOf<"atomic" | "async">();
  });

  it("FulfillmentChannel is generic over TServerCfg and TBuyerData", () => {
    type Cfg = { apiKey: string };
    type Data = { email: string };
    type Channel = FulfillmentChannel<Cfg, Data>;
    expectTypeOf<Parameters<Channel["configure"]>[0]>().toEqualTypeOf<Cfg>();
    expectTypeOf<Parameters<Channel["onCommit"]>[1]>().toEqualTypeOf<Data>();
    expectTypeOf<ReturnType<Channel["describe"]>>().toEqualTypeOf<FulfillmentOptionDescriptor>();
  });
});
