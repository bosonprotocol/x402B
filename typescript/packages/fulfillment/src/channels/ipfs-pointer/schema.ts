// Buyer-data schema for the `ipfs-pointer` fulfillment channel.
//
// The buyer optionally publishes a `recipientPubKey` the seller MAY
// use to encrypt the uploaded body. The cipher is opaque to this
// package — the value is just persisted alongside the exchange and
// handed to the upload adapter at redeem time.

import { z } from "zod";

import { toBuyerDataJsonSchema } from "../_internal/to-json-schema.js";

export const ipfsPointerBuyerDataSchema = z
  .object({
    recipientPubKey: z
      .string()
      .trim()
      .min(1, { message: "recipientPubKey must not be empty or whitespace" })
      .optional(),
  })
  .strict();

export type IpfsPointerBuyerData = z.infer<typeof ipfsPointerBuyerDataSchema>;

export const ipfsPointerBuyerDataJsonSchema = toBuyerDataJsonSchema(ipfsPointerBuyerDataSchema);
