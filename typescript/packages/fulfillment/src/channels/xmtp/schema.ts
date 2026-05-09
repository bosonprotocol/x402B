// Buyer-data schema for the `xmtp` fulfillment channel.
//
// Reuses the EVM `addressSchema` from `@bosonprotocol/x402-core/schemes/escrow`
// so the address validation rule stays in one place.

import { addressSchema } from "@bosonprotocol/x402-core/schemes/escrow";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

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
