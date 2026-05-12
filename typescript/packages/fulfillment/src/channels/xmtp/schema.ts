// Buyer-data schema for the `xmtp` fulfillment channel.
//
// Reuses `addressSchema` from `@bosonprotocol/x402-core/schemes/escrow`
// so the EVM-address validation rule stays in lockstep with the rest
// of the escrow scheme. See CLAUDE.md "Reuse > re-implementation".

import { addressSchema } from "@bosonprotocol/x402-core/schemes/escrow";
import { z } from "zod";

import { toBuyerDataJsonSchema } from "../_internal/to-json-schema.js";

export const xmtpBuyerDataSchema = z
  .object({
    xmtpAddress: addressSchema,
  })
  .strict();

export type XmtpBuyerData = z.infer<typeof xmtpBuyerDataSchema>;

export const xmtpBuyerDataJsonSchema = toBuyerDataJsonSchema(xmtpBuyerDataSchema);
