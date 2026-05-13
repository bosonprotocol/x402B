// `createX402bServer` — the per-server factory. v0.1 wires the 402
// challenge builder + FullOffer signer; later PRs (validator,
// facilitator client, convenience handlers) attach more methods to
// the returned object without changing the config shape.

import type { UnsignedFullOffer } from "@bosonprotocol/x402-core/eip712";
import type {
  BosonOfferRef,
  EscrowPaymentRequirements,
} from "@bosonprotocol/x402-core/schemes/escrow";

import { buildPaymentRequirements } from "./challenge/build-requirements.js";
import { signFullOffer } from "./challenge/sign-full-offer.js";
import {
  assertChannelRegistryEscrowMatch,
  x402bServerConfigSchema,
  type X402bServerConfig,
} from "./config.js";

/** Per-offer inputs for `server.buildPaymentRequirements` — everything the offer-level args carry, minus the per-server context the factory already holds. */
export interface BuildRequirementsInput {
  /** Already-signed offer reference, or `{ unsigned }` to have the server sign it. */
  offer: BosonOfferRef | { unsigned: UnsignedFullOffer };
  asset: string;
  amount: string;
  tokenAuthStrategies: readonly ("none" | "erc3009" | "permit" | "permit2")[];
  recipientId: string;
  maxTimeoutSeconds: number;
  fulfillment?: import("@bosonprotocol/x402-core/schemes/escrow").FulfillmentRequirements;
}

export interface X402bServer {
  readonly config: X402bServerConfig;
  /**
   * Sign an unsigned FullOffer with the configured seller signer.
   * Returns the `BosonOfferRef` shape ready to embed in
   * `EscrowPaymentRequirements.offer`.
   */
  signOffer(unsigned: UnsignedFullOffer): Promise<BosonOfferRef>;
  /**
   * Build a 402 `EscrowPaymentRequirements` body. Accepts either an
   * already-signed `BosonOfferRef` or `{ unsigned }` — in the latter
   * case the server signs the offer with the configured signer first.
   */
  buildPaymentRequirements(input: BuildRequirementsInput): Promise<EscrowPaymentRequirements>;
}

const COMMIT_ACTION_IDS = new Set([
  "boson-createOfferAndCommit",
  "boson-createOfferCommitAndRedeem",
]);

function facilitatorEndpointFor(actionId: string, facilitatorUrl: string): string {
  const base = facilitatorUrl.replace(/\/+$/, "");
  if (COMMIT_ACTION_IDS.has(actionId)) {
    return `${base}/settle`;
  }
  return `${base}/perform-action?action=${encodeURIComponent(actionId)}`;
}

function withFacilitatorEndpoints(
  requirements: EscrowPaymentRequirements,
  facilitatorUrl: string,
): EscrowPaymentRequirements {
  return {
    ...requirements,
    actions: {
      ...requirements.actions,
      next: requirements.actions.next.map((entry) => {
        if (!entry.channels.includes("facilitator")) {
          return entry;
        }
        return {
          ...entry,
          endpoints: {
            ...entry.endpoints,
            facilitator: facilitatorEndpointFor(entry.id, facilitatorUrl),
          },
        };
      }),
    },
  };
}

/**
 * Validate a config and return a `X402bServer` whose methods are
 * bound to the validated context. Throws synchronously (`ZodError`)
 * on bad config or (`Error`) on the escrow / channel-registry escrow
 * mismatch.
 */
export function createX402bServer(config: X402bServerConfig): X402bServer {
  const validated = x402bServerConfigSchema.parse(config) as X402bServerConfig;
  assertChannelRegistryEscrowMatch(validated);

  const signOffer = (unsigned: UnsignedFullOffer): Promise<BosonOfferRef> =>
    signFullOffer({
      fullOffer: unsigned,
      signer: validated.signer,
      escrow: validated.escrow,
      chainId: validated.chainId,
    });

  return {
    config: validated,
    signOffer,
    async buildPaymentRequirements(input) {
      const offer = "unsigned" in input.offer ? await signOffer(input.offer.unsigned) : input.offer;
      const requirements = buildPaymentRequirements({
        offer,
        asset: input.asset,
        amount: input.amount,
        tokenAuthStrategies: input.tokenAuthStrategies,
        recipientId: input.recipientId,
        maxTimeoutSeconds: input.maxTimeoutSeconds,
        ...(input.fulfillment !== undefined ? { fulfillment: input.fulfillment } : {}),
        network: validated.network,
        escrow: validated.escrow,
        channelRegistry: validated.channelRegistry,
      });
      return withFacilitatorEndpoints(requirements, validated.facilitator.url);
    },
  };
}
