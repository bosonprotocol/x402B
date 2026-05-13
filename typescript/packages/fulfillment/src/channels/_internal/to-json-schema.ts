// Shared zod → JSON Schema converter used by every channel that has a
// non-null `buyerDataSchema`. The options (`jsonSchema7` target, no
// `$ref` indirection) are uniform across channels so callers don't
// have to keep them in sync.

import type { ZodTypeAny } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

export function toBuyerDataJsonSchema(schema: ZodTypeAny): Record<string, unknown> {
  return zodToJsonSchema(schema, {
    $refStrategy: "none",
    target: "jsonSchema7",
  }) as Record<string, unknown>;
}
