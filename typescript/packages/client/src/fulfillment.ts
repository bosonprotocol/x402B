// Resolve the `fulfillment` slot the client will attach to the commit-time
// payment payload. The buyer's chosen `option` always flows (capability
// negotiation against the server's advertised set); the `data` field is
// validated locally against the option's JSON Schema either way so the
// client fails fast before signing — but whether it travels with the
// commit-time payload depends on the action the client is signing:
//
//  - Atomic Flow B (`boson-createOfferCommitAndRedeem`): the commit and
//    on-chain redeem happen in one transaction, so the X-PAYMENT header
//    is the only round trip the buyer makes. `data` MUST be present.
//  - Two-step Flow A (`boson-createOfferAndCommit`): the buyer redeems
//    later via `boson-redeem`'s POST body — `data` is omitted at commit
//    and attached at redeem.
//
// The conditional emission lives in the payload assembler (`payload.ts`);
// this module returns both `option` and `data` and lets the caller decide.

import Ajv from "ajv";
import type { EscrowPaymentRequirements } from "@bosonprotocol/x402-core/schemes/escrow";

import { FulfillmentValidationError } from "./errors.js";
import type { FulfillmentConfig, X402bClientConfig } from "./types.js";

export interface ResolvedFulfillment {
  option: string;
  /**
   * Buyer-supplied delivery data, validated locally against the option's
   * JSON Schema. The payload assembler decides whether to include this
   * field in the commit-time payload (Flow B yes, Flow A no).
   */
  data: Record<string, unknown> | null;
}

/**
 * Returns the resolved `{ option, data }` pair the assembler will attach
 * to the commit-time fulfillment slot (Flow B) or carry forward for the
 * redeem-time POST body (Flow A). Throws when the requirements demand a
 * fulfillment but the client config doesn't supply one, when the option
 * id isn't advertised by the server, or when the buyer data doesn't
 * validate against the option's schema.
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

  if (option.schema === null) {
    if (fulfillmentConfig.data !== null) {
      throw new FulfillmentValidationError(
        `fulfillment option '${option.id}' accepts no buyer data; use null`,
      );
    }
  } else {
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
