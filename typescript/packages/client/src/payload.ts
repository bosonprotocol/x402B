// Assemble the X-PAYMENT body and base64-encode it.
//
// Defense-in-depth: the assembled `EscrowPaymentPayload` is re-validated
// through `parseEscrowPaymentPayload` from `@bosonprotocol/x402-core`
// before serialization, so shape bugs surface here instead of at the
// server. Base64 encoding goes through the isomorphic `encodeBase64`
// helper from `./base64.js` — `Buffer` on Node, UTF-8-aware
// `btoa` on browsers.

import {
  parseEscrowPaymentPayload,
  type BosonMetaTx,
  type BosonTokenAuth,
  type EscrowPaymentPayload,
  type EscrowPaymentRequirements,
  type TokenAuthStrategy,
} from "@bosonprotocol/x402-core/schemes/escrow";
import type { Address } from "viem";

import { encodeBase64 } from "./base64.js";
import type { ResolvedFulfillment } from "./fulfillment.js";

/** Current x402 protocol version embedded in the payload envelope. */
export const X402_VERSION = 2;

export interface AssembleArgs {
  requirements: EscrowPaymentRequirements;
  action: string;
  tokenAuthStrategy: TokenAuthStrategy;
  metaTx: BosonMetaTx;
  tokenAuth?: BosonTokenAuth;
  fulfillment?: ResolvedFulfillment;
  buyer: Address;
}

/** Construct and re-validate the payload, returning the structured object. */
export function assemblePayload({
  requirements,
  action,
  tokenAuthStrategy,
  metaTx,
  tokenAuth,
  fulfillment,
  buyer,
}: AssembleArgs): EscrowPaymentPayload {
  // Fulfillment `data` rides along only for atomic Flow B — Flow A
  // defers it to the redeem POST body. The conditional emission keeps
  // the assembler aligned with the server-side rule-13 validator that
  // rejects `data` on Flow A and requires it on Flow B.
  const fulfillmentSlot =
    fulfillment === undefined
      ? undefined
      : action === "boson-createOfferCommitAndRedeem"
        ? { option: fulfillment.option, data: fulfillment.data }
        : { option: fulfillment.option };

  const payload: EscrowPaymentPayload = {
    x402Version: X402_VERSION,
    scheme: "escrow",
    network: requirements.network,
    payload: {
      action,
      tokenAuthStrategy,
      offerRef: {
        fullOffer: requirements.offer.fullOffer,
        sellerSig: requirements.offer.sellerSig,
      },
      buyer,
      metaTx,
      ...(tokenAuth ? { tokenAuth } : {}),
    },
    ...(fulfillmentSlot ? { fulfillment: fulfillmentSlot } : {}),
  };

  // Defensive re-parse — surfaces shape bugs (e.g. malformed hex) before
  // the payload escapes the client.
  parseEscrowPaymentPayload(payload);
  return payload;
}

/** Build, validate, and base64-encode the payload for the `X-PAYMENT` header. */
export function assembleAndEncodePayload(args: AssembleArgs): string {
  const payload = assemblePayload(args);
  return encodeBase64(JSON.stringify(payload));
}
