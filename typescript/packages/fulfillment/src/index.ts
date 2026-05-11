// Public API for @bosonprotocol/x402-fulfillment.
//
// The root entry exposes the framework-level types. Concrete channels,
// the server-side registry, and the client-side `negotiateFulfillment`
// helper are reached via subpath imports (`./channels/<id>`,
// `./registry`, `./client`).

export type { FulfillmentChannel, FulfillmentResult } from "./types.js";
