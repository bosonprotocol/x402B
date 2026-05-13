// Inline fulfillment channel.
//
// The resource is returned in the same HTTP response that completes
// the release transition. The buyer attaches no data
// (`buyerDataSchema: null`); the server resolves the body at fulfill
// time via the configured `resolve(exchangeId)` callback.
//
// See docs/boson-impl-03-fulfillment-channels.md for the registry entry.

import type { FulfillmentOption } from "@bosonprotocol/x402-core/schemes/escrow";

import type { FulfillmentChannel } from "../../types.js";

export const INLINE_CHANNEL_ID = "inline";

export interface InlineServerCfg {
  /** Server-side resolver invoked from `onFulfill`. */
  resolve: (exchangeId: string) => Promise<{ body: Uint8Array; contentType: string }>;
}

export type InlineChannel = FulfillmentChannel<InlineServerCfg, null>;

export function createInlineChannel(initialCfg?: InlineServerCfg): InlineChannel {
  let cfg: InlineServerCfg | undefined = initialCfg;

  const descriptor: FulfillmentOption = {
    id: INLINE_CHANNEL_ID,
    schema: null,
  };

  return {
    id: INLINE_CHANNEL_ID,
    buyerDataSchema: null,
    configure(next) {
      cfg = next;
    },
    describe() {
      return descriptor;
    },
    validate(data) {
      return data === null ? { ok: true } : { ok: false, reason: "inline accepts no buyer data" };
    },
    async onCommit() {
      // Nothing to persist — the buyer attaches no data.
    },
    async onFulfill(exchangeId) {
      if (!cfg) {
        throw new Error("inline channel: configure({ resolve }) before invoking onFulfill");
      }
      const { body, contentType } = await cfg.resolve(exchangeId);
      return { kind: "inline", body, contentType };
    },
  };
}
