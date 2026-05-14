// `createX402bServer` — the per-server factory. Wires the 402
// challenge builder + FullOffer signer (PR 1), and the convenience
// handlers (commit, commit-and-redeem, redeem, complete, dispute/*)
// over the facilitator HTTP client + configured `ExchangeReader`.

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
import { createFacilitatorClient, type FacilitatorClient } from "./facilitator/client.js";
import {
  handleCommit,
  handleCommitAndRedeem,
  handleComplete,
  handleDisputeEscalate,
  handleDisputeRaise,
  handleDisputeResolve,
  handleDisputeRetract,
  handleRedeem,
  type CommitHandlerInput,
  type CommitOk,
  type HandlerResult,
  type PerformActionInput,
  type PerformActionOk,
} from "./handlers/index.js";
import type { ExchangeReader } from "./onchain/verify-exchange.js";

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
  readonly facilitator: FacilitatorClient;

  /** Sign an unsigned FullOffer with the configured seller signer. */
  signOffer(unsigned: UnsignedFullOffer): Promise<BosonOfferRef>;
  /** Build a 402 `EscrowPaymentRequirements`. */
  buildPaymentRequirements(input: BuildRequirementsInput): Promise<EscrowPaymentRequirements>;

  /** Convenience handlers — pure, framework-agnostic. The express adapter (PR 5) maps them to routes. */
  readonly handlers: {
    commit(input: CommitHandlerInput): Promise<HandlerResult<CommitOk>>;
    commitAndRedeem(input: CommitHandlerInput): Promise<HandlerResult<CommitOk>>;
    redeem(input: PerformActionInput): Promise<HandlerResult<PerformActionOk>>;
    complete(input: PerformActionInput): Promise<HandlerResult<PerformActionOk>>;
    disputeRaise(input: PerformActionInput): Promise<HandlerResult<PerformActionOk>>;
    disputeResolve(input: PerformActionInput): Promise<HandlerResult<PerformActionOk>>;
    disputeRetract(input: PerformActionInput): Promise<HandlerResult<PerformActionOk>>;
    disputeEscalate(input: PerformActionInput): Promise<HandlerResult<PerformActionOk>>;
  };
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

  const facilitator = createFacilitatorClient({ url: validated.facilitator.url });

  const signOffer = (unsigned: UnsignedFullOffer): Promise<BosonOfferRef> =>
    signFullOffer({
      fullOffer: unsigned,
      signer: validated.signer,
      escrow: validated.escrow,
      chainId: validated.chainId,
    });

  const requireReader = async (action: string): Promise<ExchangeReader> => {
    if (validated.exchangeReader === undefined) {
      throw new Error(
        `x402-server: handlers.${action}() requires \`exchangeReader\` in config (post-settle state verification step).`,
      );
    }
    return validated.exchangeReader;
  };

  return {
    config: validated,
    facilitator,
    signOffer,
    async buildPaymentRequirements(input) {
      const offer = "unsigned" in input.offer ? await signOffer(input.offer.unsigned) : input.offer;
      const requirements = buildPaymentRequirements({
        offer,
        asset: input.offer && "unsigned" in input.offer ? input.asset : input.asset,
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
    handlers: {
      commit: async (input) =>
        handleCommit(input, {
          config: validated,
          facilitator,
          exchangeReader: await requireReader("commit"),
        }),
      commitAndRedeem: async (input) =>
        handleCommitAndRedeem(input, {
          config: validated,
          facilitator,
          exchangeReader: await requireReader("commitAndRedeem"),
        }),
      redeem: async (input) =>
        handleRedeem(input, {
          config: validated,
          facilitator,
          exchangeReader: await requireReader("redeem"),
        }),
      complete: async (input) =>
        handleComplete(input, {
          config: validated,
          facilitator,
          exchangeReader: await requireReader("complete"),
        }),
      disputeRaise: async (input) =>
        handleDisputeRaise(input, {
          config: validated,
          facilitator,
          exchangeReader: await requireReader("disputeRaise"),
        }),
      disputeResolve: async (input) =>
        handleDisputeResolve(input, {
          config: validated,
          facilitator,
          exchangeReader: await requireReader("disputeResolve"),
        }),
      disputeRetract: async (input) =>
        handleDisputeRetract(input, {
          config: validated,
          facilitator,
          exchangeReader: await requireReader("disputeRetract"),
        }),
      disputeEscalate: async (input) =>
        handleDisputeEscalate(input, {
          config: validated,
          facilitator,
          exchangeReader: await requireReader("disputeEscalate"),
        }),
    },
  };
}
