// Buyer-data schema for the `xmtp` fulfillment channel.
//
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

const ADDRESS = /^0x[a-fA-F0-9]{40}$/;
const addressSchema = z.string().regex(ADDRESS);

export const xmtpBuyerDataSchema = z
  .object({
    xmtpAddress: addressSchema,
  })
  .strict();

export type XmtpBuyerData = z.infer<typeof xmtpBuyerDataSchema>;

export const xmtpBuyerDataJsonSchema = zodToJsonSchema(xmtpBuyerDataSchema, {
  $refStrategy: "none",
  target: "jsonSchema7",
}) as Record<string, unknown>;
