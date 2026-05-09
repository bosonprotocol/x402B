// `xmtp` fulfillment channel.
//
// Buyer attaches `{ xmtpAddress: <0x…> }` at commit. The server stores
// it against the exchange id and pushes the delivery payload to the
// buyer's XMTP inbox at redeem time via the configured `send` hook.
// Useful for AI-agent buyers that already use XMTP for commerce.
//
// `send` is an injection point — this package does not own the XMTP
// client; the server SDK (or the agent runtime) provides one.

import { createDataAtCommitChannel } from "../_internal/data-at-commit-channel.js";
import type { FulfillmentChannel } from "../../types.js";

import { xmtpBuyerDataJsonSchema, xmtpBuyerDataSchema, type XmtpBuyerData } from "./schema.js";

export const XMTP_CHANNEL_ID = "xmtp";

export interface XmtpServerCfg {
  /** Persist `exchangeId → buyerData`. Defaults to an in-memory `Map`. */
  store?: Map<string, XmtpBuyerData>;
  /** Server-side hook invoked from `onFulfill`. */
  send: (exchangeId: string, data: XmtpBuyerData) => Promise<void>;
  /** Optional descriptor metadata (e.g. seller XMTP address) surfaced on the 402. */
  metadata?: unknown;
}

export type XmtpChannel = FulfillmentChannel<XmtpServerCfg, XmtpBuyerData>;

export type { XmtpBuyerData } from "./schema.js";
export { xmtpBuyerDataJsonSchema, xmtpBuyerDataSchema } from "./schema.js";

export function createXmtpChannel(initialCfg?: XmtpServerCfg): XmtpChannel {
  return createDataAtCommitChannel<XmtpBuyerData, XmtpServerCfg>(
    {
      id: XMTP_CHANNEL_ID,
      zodSchema: xmtpBuyerDataSchema,
      jsonSchema: xmtpBuyerDataJsonSchema,
      hookName: "send",
      dispatch: async (cfg, exchangeId, data) => {
        await cfg.send(exchangeId, data);
        return `xmtp:${data.xmtpAddress}`;
      },
    },
    initialCfg,
  );
}
