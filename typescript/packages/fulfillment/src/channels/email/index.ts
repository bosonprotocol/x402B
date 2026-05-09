// `email` fulfillment channel.
//
// Buyer attaches `{ email: string }` at commit; the server stores it
// against the exchange id and dispatches a (license key, mailing list
// confirmation, etc.) through the configured `send` hook at redeem
// time.
//
// `send` is intentionally an injection point — this package does not
// own SMTP / SES / SendGrid wiring; the server SDK provides a real
// transport.
//
// See docs/boson-impl-03-fulfillment-channels.md for the registry entry.

import { createDataAtCommitChannel } from "../_internal/data-at-commit-channel.js";
import type { FulfillmentChannel } from "../../types.js";

import { emailBuyerDataJsonSchema, emailBuyerDataSchema, type EmailBuyerData } from "./schema.js";

export const EMAIL_CHANNEL_ID = "email";

export interface EmailServerCfg {
  /** Persist `exchangeId → buyerData`. Defaults to an in-memory `Map`. */
  store?: Map<string, EmailBuyerData>;
  /** Server-side hook invoked from `onRedeem`. */
  send: (exchangeId: string, data: EmailBuyerData) => Promise<void>;
  /** Optional descriptor metadata (e.g. sender display name) surfaced on the 402. */
  metadata?: unknown;
}

export type EmailChannel = FulfillmentChannel<EmailServerCfg, EmailBuyerData>;

export type { EmailBuyerData } from "./schema.js";
export { emailBuyerDataJsonSchema, emailBuyerDataSchema } from "./schema.js";

export function createEmailChannel(initialCfg?: EmailServerCfg): EmailChannel {
  return createDataAtCommitChannel<EmailBuyerData, EmailServerCfg>(
    {
      id: EMAIL_CHANNEL_ID,
      zodSchema: emailBuyerDataSchema,
      jsonSchema: emailBuyerDataJsonSchema,
      hookName: "send",
      dispatch: async (cfg, exchangeId, data) => {
        await cfg.send(exchangeId, data);
        return `mailto:${data.email}`;
      },
    },
    initialCfg,
  );
}
