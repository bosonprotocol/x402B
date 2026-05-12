// Buyer-data schema for the `webhook` fulfillment channel.
//
// Required:
// - `url`: https endpoint the server POSTs the delivery to. Plaintext
//   http is rejected — the channel transports the resource (or a
//   pointer to it) so confidentiality at the transport layer is not
//   negotiable.
//
// Optional buyer-side endpoint-protection fields:
// - `authToken`: opaque bearer token. The server-side adapter includes
//   it as `Authorization: Bearer <authToken>`. Lets the buyer's
//   endpoint cheaply reject unauthenticated traffic without verifying
//   the signed envelope. Industry-standard webhook auth (Stripe,
//   GitHub, Slack, Twilio).
// - `encryptionPubKey`: buyer-published encryption key. The server MAY
//   encrypt the resource body to this key. The cipher itself is
//   specced separately under `03b-webhook-encryption.md` and is not
//   yet implemented; the field is persisted today so server-side
//   adapters can consume it once the cipher lands.
//
// Independent of these fields, the server signs every webhook
// envelope with the key advertised under `metadata.serverPublicKey`
// (see the channel registry in
// `docs/boson-impl-03-fulfillment-channels.md`). The buyer is expected
// to verify the signature, the timestamp freshness, and the
// idempotency on `exchangeId`.

import { z } from "zod";

import { toBuyerDataJsonSchema } from "../_internal/to-json-schema.js";

export const webhookBuyerDataSchema = z
  .object({
    // `.url()` validates parseability; the refine then narrows the
    // protocol via `new URL(...).protocol` so the check is
    // case-insensitive (`HTTPS://` is also accepted, matching the
    // URL spec's case-insensitive scheme). zod v3's `.url()` does
    // not yet expose a `protocols` option; that's a v4 API. The
    // try/catch is needed because zod still runs refines even when
    // earlier validators (`.url()`) have already reported failure.
    url: z
      .string()
      .url()
      .refine(
        (u) => {
          try {
            return new URL(u).protocol === "https:";
          } catch {
            return false;
          }
        },
        { message: "url must use https://" },
      ),
    authToken: z.string().trim().min(1).optional(),
    encryptionPubKey: z.string().trim().min(1).optional(),
  })
  .strict();

export type WebhookBuyerData = z.infer<typeof webhookBuyerDataSchema>;

export const webhookBuyerDataJsonSchema = toBuyerDataJsonSchema(webhookBuyerDataSchema);
