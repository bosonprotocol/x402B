// `webhook` fulfillment channel.
//
// Buyer attaches `{ url, authToken?, encryptionPubKey? }` at commit.
// The server stores the record against the exchange id and POSTs the
// delivered resource (or a pointer) to `url` at redeem time via the
// configured `send` hook. Returns the buyer's `url` as the async
// pointer.
//
// Buyer-side endpoint protection is layered:
// - The server always signs the delivery envelope with
//   `metadata.serverPublicKey` (see the channel registry in
//   `docs/boson-impl-03-fulfillment-channels.md`); the buyer is
//   expected to verify the signature, timestamp freshness, and
//   idempotency on `exchangeId`.
// - `authToken` (optional) is included by the server as
//   `Authorization: Bearer <token>` so the buyer's endpoint can
//   cheaply reject unauthenticated traffic before parsing the
//   envelope.
// - `encryptionPubKey` (optional) is persisted for the future
//   `03b-webhook-encryption.md` cipher.

import type { JSONSchema7 } from "json-schema";

import type { FulfillmentChannel } from "../../types.js";
import {
  webhookBuyerDataJsonSchema,
  webhookBuyerDataSchema,
  type WebhookBuyerData,
} from "./schema.js";

export const WEBHOOK_CHANNEL_ID = "webhook";

export interface WebhookServerCfg {
  /** Persist `exchangeId → buyerData`. Defaults to an in-memory `Map`. */
  store?: Map<string, WebhookBuyerData>;
  /** Server-side hook invoked from `onRedeem`. */
  send: (exchangeId: string, data: WebhookBuyerData) => Promise<void>;
  /** Optional descriptor metadata (e.g. server's signing key) surfaced on the 402. */
  metadata?: unknown;
}

export type WebhookChannel = FulfillmentChannel<WebhookServerCfg, WebhookBuyerData>;

export type { WebhookBuyerData } from "./schema.js";
export { webhookBuyerDataJsonSchema, webhookBuyerDataSchema } from "./schema.js";

export function createWebhookChannel(initialCfg?: WebhookServerCfg): WebhookChannel {
  let cfg: WebhookServerCfg | undefined = initialCfg;
  let store: Map<string, WebhookBuyerData> = initialCfg?.store ?? new Map();

  return {
    id: WEBHOOK_CHANNEL_ID,
    buyerDataSchema: webhookBuyerDataJsonSchema as JSONSchema7,
    configure(next) {
      cfg = next;
      store = next.store ?? new Map();
    },
    describe() {
      return {
        id: WEBHOOK_CHANNEL_ID,
        schema: webhookBuyerDataJsonSchema,
        ...(cfg?.metadata !== undefined ? { metadata: cfg.metadata } : {}),
      };
    },
    validate(data) {
      const result = webhookBuyerDataSchema.safeParse(data);
      return result.success
        ? { ok: true }
        : { ok: false, reason: result.error.issues[0]?.message ?? "invalid webhook data" };
    },
    async onCommit(exchangeId, data) {
      store.set(exchangeId, data);
    },
    async onRedeem(exchangeId) {
      if (!cfg) {
        throw new Error("webhook channel: configure({ send }) before invoking onRedeem");
      }
      const data = store.get(exchangeId);
      if (!data) {
        throw new Error(`webhook channel: no buyer data stored for exchange ${exchangeId}`);
      }
      await cfg.send(exchangeId, data);
      return { kind: "async", pointer: data.url };
    },
  };
}
