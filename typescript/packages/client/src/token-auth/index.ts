// Token-authorization strategy dispatcher.
//
// MVP supports only the ERC-3009 `ReceiveWithAuthorization` path. The
// `none` / `permit` / `permit2` strategies are advertised in the wire
// format but not yet implemented client-side — calling with one of those
// (without `"erc3009"` also being on offer) raises
// `UnsupportedTokenAuthError`. The picker prefers `"erc3009"` whenever the
// server lists it alongside other strategies.

import type {
  BosonTokenAuth,
  EscrowPaymentRequirements,
  TokenAuthStrategy,
} from "@bosonprotocol/x402-core/schemes/escrow";
import type { Address } from "viem";

import { UnsupportedTokenAuthError } from "../errors.js";
import type { Signer, TokenDomainResolver } from "../types.js";

import { signErc3009 } from "./erc3009.js";

export interface BuildTokenAuthArgs {
  requirements: EscrowPaymentRequirements;
  buyer: Address;
  signer: Signer;
  tokenDomainResolver: TokenDomainResolver;
  now?: () => number;
}

export interface BuiltTokenAuth {
  strategy: TokenAuthStrategy;
  tokenAuth: BosonTokenAuth;
}

/**
 * Pick a supported strategy from `requirements.tokenAuthStrategies`, build
 * the corresponding typed-data, sign it through the buyer's signer, and
 * return the wire-format `BosonTokenAuth` slot.
 */
export async function buildAndSignTokenAuth(args: BuildTokenAuthArgs): Promise<BuiltTokenAuth> {
  if (!args.requirements.tokenAuthStrategies.includes("erc3009")) {
    throw new UnsupportedTokenAuthError(
      `server advertises tokenAuthStrategies=[${args.requirements.tokenAuthStrategies.join(", ")}]; client only supports 'erc3009' in MVP`,
    );
  }

  const data = await signErc3009(args);
  return {
    strategy: "erc3009",
    tokenAuth: { kind: "erc3009", data },
  };
}
