// Atomic HTTP fulfillment channel.
//
// The resource is returned in the same HTTP response that completes
// the redeem. The buyer attaches no data (`buyerDataSchema: null`);
// the server resolves the body at redeem time via the configured
// `resolve(exchangeId)` callback.
//
// See docs/boson-impl-03-fulfillment-channels.md for the registry entry.

import type { FulfillmentChannel, FulfillmentOptionDescriptor } from "../../types.js";

export const ATOMIC_HTTP_CHANNEL_ID = "atomic-http";

export interface AtomicHttpServerCfg {
  /** Server-side resolver invoked from `onRedeem`. */
  resolve: (exchangeId: string) => Promise<{ body: Uint8Array; contentType: string }>;
}

export type AtomicHttpChannel = FulfillmentChannel<AtomicHttpServerCfg, null>;

export function createAtomicHttpChannel(initialCfg?: AtomicHttpServerCfg): AtomicHttpChannel {
  let cfg: AtomicHttpServerCfg | undefined = initialCfg;

  const descriptor: FulfillmentOptionDescriptor = {
    id: ATOMIC_HTTP_CHANNEL_ID,
    schema: null,
  };

  return {
    id: ATOMIC_HTTP_CHANNEL_ID,
    buyerDataSchema: null,
    configure(next) {
      cfg = next;
    },
    describe() {
      return descriptor;
    },
    validate(data) {
      return data === null
        ? { ok: true }
        : { ok: false, reason: "atomic-http accepts no buyer data" };
    },
    async onCommit() {
      // Nothing to persist — the buyer attaches no data.
    },
    async onRedeem(exchangeId) {
      if (!cfg) {
        throw new Error("atomic-http channel: configure({ resolve }) before invoking onRedeem");
      }
      const { body, contentType } = await cfg.resolve(exchangeId);
      return { kind: "atomic", body, contentType };
    },
  };
}
