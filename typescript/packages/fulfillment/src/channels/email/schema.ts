// Buyer-data schema for the `email` fulfillment channel.
//
// zod is the source of truth (used at runtime for `validate`); the
// JSON-Schema artifact is derived once via `zod-to-json-schema` and
// surfaced on `describe()` so it travels in the 402 response.

import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

export const emailBuyerDataSchema = z
  .object({
    email: z.string().email(),
  })
  .strict();

export type EmailBuyerData = z.infer<typeof emailBuyerDataSchema>;

export const emailBuyerDataJsonSchema = zodToJsonSchema(emailBuyerDataSchema, {
  $refStrategy: "none",
  target: "jsonSchema7",
}) as Record<string, unknown>;
