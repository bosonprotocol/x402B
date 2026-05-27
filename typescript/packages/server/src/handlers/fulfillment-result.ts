// Wire serialisation for a channel's `onFulfill` result.
//
// `FulfillmentResult` carries an `inline` body as raw `Uint8Array`,
// which isn't JSON-serialisable, so the handlers convert it to this
// base64 wire shape before attaching it to the 200 response. The
// `async` variant (webhook / ipfs-pointer / email / xmtp) passes
// through unchanged — its `pointer` is already a string.

import type { FulfillmentResult } from "../config.js";

/** JSON-safe view of a `FulfillmentResult` for the response body. */
export type SerializedFulfillmentResult =
  | { kind: "inline"; body: string; contentType: string }
  | { kind: "async"; pointer?: string };

/** Base64-encode an inline body; pass an async pointer through verbatim. */
export function serializeFulfillmentResult(result: FulfillmentResult): SerializedFulfillmentResult {
  if (result.kind === "inline") {
    return {
      kind: "inline",
      body: Buffer.from(result.body).toString("base64"),
      contentType: result.contentType,
    };
  }
  return result.pointer !== undefined
    ? { kind: "async", pointer: result.pointer }
    : { kind: "async" };
}
