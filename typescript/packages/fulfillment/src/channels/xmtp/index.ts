// `xmtp` fulfillment channel.
//
// Buyer attaches `{ xmtpAddress: <0x…> }` at commit. The server stores
// it against the exchange id and pushes the delivery payload to the
// buyer's XMTP inbox at redeem time via the configured `send` hook.
// Useful for AI-agent buyers that already use XMTP for commerce.
//
// `send` is an injection point — this package does not own the XMTP
// client; the server SDK (or the agent runtime) provides one.

import type { JSONSchema7 } from "json-schema";

import type { FulfillmentChannel } from "../../types.js";
import { xmtpBuyerDataJsonSchema, xmtpBuyerDataSchema, type XmtpBuyerData } from "./schema.js";

export const XMTP_CHANNEL_ID = "xmtp";

export interface XmtpServerCfg {
  /** Persist `exchangeId → buyerData`. Defaults to an in-memory `Map`. */
  store?: Map<string, XmtpBuyerData>;
  /** Server-side hook invoked from `onRedeem`. */
  send: (exchangeId: string, data: XmtpBuyerData) => Promise<void>;
  /** Optional descriptor metadata (e.g. seller XMTP address) surfaced on the 402. */
  metadata?: unknown;
}

export type XmtpChannel = FulfillmentChannel<XmtpServerCfg, XmtpBuyerData>;

export type { XmtpBuyerData } from "./schema.js";
export { xmtpBuyerDataJsonSchema, xmtpBuyerDataSchema } from "./schema.js";

export function createXmtpChannel(initialCfg?: XmtpServerCfg): XmtpChannel {
  let cfg: XmtpServerCfg | undefined = initialCfg;
  let store: Map<string, XmtpBuyerData> = initialCfg?.store ?? new Map();

  return {
    id: XMTP_CHANNEL_ID,
    buyerDataSchema: xmtpBuyerDataJsonSchema as JSONSchema7,
    configure(next) {
      cfg = next;
      store = next.store ?? new Map();
    },
    describe() {
      return {
        id: XMTP_CHANNEL_ID,
        schema: xmtpBuyerDataJsonSchema,
        ...(cfg?.metadata !== undefined ? { metadata: cfg.metadata } : {}),
      };
    },
    validate(data) {
      const result = xmtpBuyerDataSchema.safeParse(data);
      return result.success
        ? { ok: true }
        : { ok: false, reason: result.error.issues[0]?.message ?? "invalid xmtp data" };
    },
    async onCommit(exchangeId, data) {
      store.set(exchangeId, data);
    },
    async onRedeem(exchangeId) {
      if (!cfg) {
        throw new Error("xmtp channel: configure({ send }) before invoking onRedeem");
      }
      const data = store.get(exchangeId);
      if (!data) {
        throw new Error(`xmtp channel: no buyer data stored for exchange ${exchangeId}`);
      }
      await cfg.send(exchangeId, data);
      return { kind: "async", pointer: `xmtp:${data.xmtpAddress}` };
    },
  };
}
