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

import type { JSONSchema7 } from "json-schema";

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
  let cfg: EmailServerCfg | undefined = initialCfg;
  let store: Map<string, EmailBuyerData> = initialCfg?.store ?? new Map();

  return {
    id: EMAIL_CHANNEL_ID,
    buyerDataSchema: emailBuyerDataJsonSchema as JSONSchema7,
    configure(next) {
      cfg = next;
      store = next.store ?? new Map();
    },
    describe() {
      return {
        id: EMAIL_CHANNEL_ID,
        schema: emailBuyerDataJsonSchema,
        ...(cfg?.metadata !== undefined ? { metadata: cfg.metadata } : {}),
      };
    },
    validate(data) {
      const result = emailBuyerDataSchema.safeParse(data);
      return result.success
        ? { ok: true }
        : { ok: false, reason: result.error.issues[0]?.message ?? "invalid email data" };
    },
    async onCommit(exchangeId, data) {
      store.set(exchangeId, data);
    },
    async onRedeem(exchangeId) {
      if (!cfg) {
        throw new Error("email channel: configure({ send }) before invoking onRedeem");
      }
      const data = store.get(exchangeId);
      if (!data) {
        throw new Error(`email channel: no buyer data stored for exchange ${exchangeId}`);
      }
      await cfg.send(exchangeId, data);
      return { kind: "async", pointer: `mailto:${data.email}` };
    },
  };
}
