// Buyer-data schema for the `ipfs-pointer` fulfillment channel.
//
// The buyer optionally publishes a `recipientPubKey` the seller MAY
// use to encrypt the uploaded body. The cipher is opaque to this
// package — the value is just persisted alongside the exchange and
// handed to the upload adapter at redeem time.

import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

export const ipfsPointerBuyerDataSchema = z
  .object({
    recipientPubKey: z.string().min(1).optional(),
  })
  .strict();

export type IpfsPointerBuyerData = z.infer<typeof ipfsPointerBuyerDataSchema>;

export const ipfsPointerBuyerDataJsonSchema = zodToJsonSchema(ipfsPointerBuyerDataSchema, {
  $refStrategy: "none",
  target: "jsonSchema7",
}) as Record<string, unknown>;
