// Assemble the X-PAYMENT body and base64-encode it.
//
// Defense-in-depth: the assembled `EscrowPaymentPayload` is re-validated
// through `parseEscrowPaymentPayload` from `@bosonprotocol/x402-core`
// before serialization, so shape bugs surface here instead of at the
// server. Base64 encoding picks `Buffer` on Node and `btoa` on browser
// targets — tsup builds both, so the runtime branch matters.

import {
  parseEscrowPaymentPayload,
  type BosonMetaTx,
  type BosonTokenAuth,
  type EscrowPaymentPayload,
  type EscrowPaymentRequirements,
  type TokenAuthStrategy,
} from "@bosonprotocol/x402-core/schemes/escrow";
import type { Address } from "viem";

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
    ...(fulfillment ? { fulfillment } : {}),
  };

  // Defensive re-parse — surfaces shape bugs (e.g. malformed hex) before
  // the payload escapes the client.
  parseEscrowPaymentPayload(payload);
  return payload;
}

/** Build, validate, and base64-encode the payload for the `X-PAYMENT` header. */
export function assembleAndEncodePayload(args: AssembleArgs): string {
  const payload = assemblePayload(args);
  const json = JSON.stringify(payload);
  if (typeof Buffer !== "undefined") {
    return Buffer.from(json, "utf8").toString("base64");
  }
  // Browser fallback. Wire payloads mostly carry hex/numeric strings, but
  // `fulfillment.data` is a `Record<string, unknown>` that the buyer
  // populates — emails, addresses, free-form notes. `btoa` accepts only
  // a binary string (code units 0–255) and throws `InvalidCharacterError`
  // on any character above U+00FF. UTF-8 encode the JSON first, then map
  // the bytes into the binary-string form `btoa` expects.
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  return btoa(binary);
}
