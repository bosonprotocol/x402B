// Token-authorization strategy dispatcher.
//
// Picks one of the buyer-side strategies (`erc3009`, `permit`, `permit2`)
// from `requirements.tokenAuthStrategies`, signs the corresponding payload
// via `CoreSDK`, and returns the wire-format `BosonTokenAuth` slot. The
// `none` strategy is encoded by the absence of `tokenAuth` on the payload
// — callers handle it outside this module.
//
// Preference order when the server advertises multiple strategies:
// `erc3009` → `permit2` → `permit`. ERC-3009 is preferred for tokens that
// support it (USDC, USDP, EUROC, etc.) because the receive-variant
// eliminates relayer front-running. Permit2 is preferred over Permit for
// tokens behind the canonical Permit2 contract because it carries a
// caller-controllable nonce. Permit is the fallback.

import type { CoreSDK } from "@bosonprotocol/core-sdk";
import type {
  BosonTokenAuth,
  EscrowPaymentRequirements,
  TokenAuthStrategy,
} from "@bosonprotocol/x402-core/schemes/escrow";
import type { Address, PublicClient } from "viem";

import { UnsupportedTokenAuthError } from "../errors.js";
import type { TokenDomainResolver } from "../types.js";

import { signErc3009 } from "./erc3009.js";
import { signPermit } from "./permit.js";
import { signPermit2 } from "./permit2.js";

export interface BuildTokenAuthArgs {
  requirements: EscrowPaymentRequirements;
  buyer: Address;
  coreSdk: CoreSDK;
  /** Required for ERC-3009 and EIP-2612 Permit; not used by Permit2. */
  tokenDomainResolver?: TokenDomainResolver;
  /** Optional PublicClient for the requirements' chain. Required for Permit. */
  publicClient?: PublicClient;
  now?: () => number;
}

export interface BuiltTokenAuth {
  strategy: TokenAuthStrategy;
  tokenAuth: BosonTokenAuth;
}

const STRATEGY_PREFERENCE: readonly TokenAuthStrategy[] = ["erc3009", "permit2", "permit"];

/**
 * Pick the highest-preference strategy from `requirements.tokenAuthStrategies`,
 * sign the corresponding payload via core-sdk, and return the wire-format
 * `BosonTokenAuth` slot.
 */
export async function buildAndSignTokenAuth(args: BuildTokenAuthArgs): Promise<BuiltTokenAuth> {
  const advertised = args.requirements.tokenAuthStrategies;
  const chosen = STRATEGY_PREFERENCE.find((s) => advertised.includes(s));
  if (!chosen) {
    throw new UnsupportedTokenAuthError(
      `server advertises tokenAuthStrategies=[${advertised.join(", ")}]; client supports [${STRATEGY_PREFERENCE.join(", ")}]`,
    );
  }

  switch (chosen) {
    case "erc3009": {
      if (!args.tokenDomainResolver) {
        throw new UnsupportedTokenAuthError(
          "server advertises 'erc3009' but no tokenDomainResolver is configured — pass tokenDomainResolver in X402bClientConfig",
        );
      }
      const data = await signErc3009({
        ...args,
        tokenDomainResolver: args.tokenDomainResolver,
      });
      return { strategy: "erc3009", tokenAuth: { kind: "erc3009", data } };
    }
    case "permit": {
      if (!args.tokenDomainResolver) {
        throw new UnsupportedTokenAuthError(
          "server advertises 'permit' but no tokenDomainResolver is configured — pass tokenDomainResolver in X402bClientConfig",
        );
      }
      if (!args.publicClient) {
        throw new UnsupportedTokenAuthError(
          "server advertises 'permit' but no PublicClient is configured for this chain — pass publicClients in X402bClientConfig",
        );
      }
      const data = await signPermit({
        ...args,
        tokenDomainResolver: args.tokenDomainResolver,
        publicClient: args.publicClient,
      });
      return { strategy: "permit", tokenAuth: { kind: "permit", data } };
    }
    case "permit2": {
      const data = await signPermit2(args);
      return { strategy: "permit2", tokenAuth: { kind: "permit2", data } };
    }
    case "none": {
      // Should never reach: `STRATEGY_PREFERENCE` doesn't include "none",
      // so a server advertising only "none" falls through to the error
      // above. Keep the case for exhaustiveness against
      // `TokenAuthStrategy`.
      throw new UnsupportedTokenAuthError(
        "tokenAuthStrategy='none' has no client-side signing — callers handle it without invoking this dispatcher",
      );
    }
    default: {
      const _exhaustive: never = chosen;
      throw new UnsupportedTokenAuthError(
        `unrecognised tokenAuthStrategy '${(_exhaustive as { toString(): string }).toString()}'`,
      );
    }
  }
}
