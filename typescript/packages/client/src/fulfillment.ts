// Resolve the `fulfillment` slot the client will attach to the payment
// payload. Validates the buyer-supplied data against the chosen option's
// JSON Schema via ajv — same library the server/facilitator will use to
// re-validate.

import Ajv from "ajv";
import type { EscrowPaymentRequirements } from "@bosonprotocol/x402-core/schemes/escrow";

import { FulfillmentValidationError } from "./errors.js";
import type { FulfillmentConfig, X402bClientConfig } from "./types.js";

export interface ResolvedFulfillment {
  option: string;
  data: Record<string, unknown>;
}

/**
 * Returns the payload's `fulfillment` slot, or `undefined` when the
 * requirements don't request one. Throws when the requirements demand a
 * fulfillment but the client config doesn't supply one, when the option id
 * isn't advertised by the server, or when the buyer data doesn't validate
 * against the option's schema.
 */
export function resolveFulfillment(
  requirements: EscrowPaymentRequirements,
  config: Pick<X402bClientConfig, "fulfillment">,
): ResolvedFulfillment | undefined {
  const required = requirements.fulfillment?.required ?? false;
  if (!required) {
    return undefined;
  }

  const fulfillmentConfig: FulfillmentConfig | undefined = config.fulfillment;
  if (!fulfillmentConfig) {
    throw new FulfillmentValidationError(
      "requirements.fulfillment.required is true but client config did not supply a fulfillment selection",
    );
  }

  const option = requirements.fulfillment?.options.find((o) => o.id === fulfillmentConfig.option);
  if (!option) {
    const advertised = requirements.fulfillment?.options.map((o) => o.id).join(", ") ?? "<none>";
    throw new FulfillmentValidationError(
      `fulfillment option '${fulfillmentConfig.option}' not advertised by requirements (advertised: ${advertised})`,
    );
  }

  if (option.schema !== null) {
    const ajv = new Ajv({ allErrors: true, strict: false });
    const validate = ajv.compile(option.schema);
    const ok = validate(fulfillmentConfig.data);
    if (!ok) {
      throw new FulfillmentValidationError(
        `fulfillment data does not match option '${option.id}' schema: ${ajv.errorsText(validate.errors)}`,
      );
    }
  }

  return { option: fulfillmentConfig.option, data: fulfillmentConfig.data };
}
