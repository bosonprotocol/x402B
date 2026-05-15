// `createX402bServer` — the per-server factory. Wires the 402
// challenge builder + FullOffer signer (PR 1), and the convenience
// handlers (commit, commit-and-redeem, redeem, complete, dispute/*,
// withdraw-funds, available-funds) over the facilitator HTTP client +
// configured `ExchangeReader` and read-only core-sdk client.

import { CoreSDK } from "@bosonprotocol/core-sdk";
import type { UnsignedFullOffer } from "@bosonprotocol/x402-core/eip712";
import type {
  BosonOfferRef,
  EscrowPaymentRequirements,
} from "@bosonprotocol/x402-core/schemes/escrow";

import { createReadOnlyWeb3LibStub } from "./onchain/web3lib-read-stub.js";

import { buildPaymentRequirements } from "./challenge/build-requirements.js";
import { signFullOffer } from "./challenge/sign-full-offer.js";
import {
  assertChannelRegistryEscrowMatch,
  x402bServerConfigSchema,
  type FulfillmentRecoveryEntry,
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
  handleGetAvailableFunds,
  handleRedeem,
  handleWithdrawFunds,
  type AvailableFundsBody,
  type AvailableFundsQuery,
  type CommitHandlerInput,
  type CommitOk,
  type HandlerResult,
  type PerformActionInput,
  type PerformActionOk,
  type PlainHandlerResult,
  type RedeemHandlerInput,
  type WithdrawFundsInput,
  type WithdrawFundsOk,
} from "./handlers/index.js";
import { stampFacilitatorEndpoints } from "./internal/facilitator-endpoints.js";
import { asCoreSdkReadAdapter, type CoreSdkReadAdapter } from "./onchain/core-sdk-read.js";
import type { ExchangeReader } from "./onchain/verify-exchange.js";
import { noopLogger, type Logger } from "./logger.js";

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
    redeem(input: RedeemHandlerInput): Promise<HandlerResult<PerformActionOk>>;
    complete(input: PerformActionInput): Promise<HandlerResult<PerformActionOk>>;
    disputeRaise(input: PerformActionInput): Promise<HandlerResult<PerformActionOk>>;
    disputeResolve(input: PerformActionInput): Promise<HandlerResult<PerformActionOk>>;
    disputeRetract(input: PerformActionInput): Promise<HandlerResult<PerformActionOk>>;
    disputeEscalate(input: PerformActionInput): Promise<HandlerResult<PerformActionOk>>;
    withdrawFunds(input: WithdrawFundsInput): Promise<PlainHandlerResult<WithdrawFundsOk>>;
    getAvailableFunds(query: AvailableFundsQuery): Promise<PlainHandlerResult<AvailableFundsBody>>;
  };
}

function withFacilitatorEndpoints(
  requirements: EscrowPaymentRequirements,
  facilitatorUrl: string,
): EscrowPaymentRequirements {
  return {
    ...requirements,
    actions: {
      ...requirements.actions,
      next: stampFacilitatorEndpoints(requirements.actions.next, facilitatorUrl),
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

  const logger: Logger = validated.logger ?? noopLogger;
  logger.info("x402-server: createX402bServer", {
    network: validated.network,
    chainId: validated.chainId,
    escrow: validated.escrow,
    facilitatorUrl: validated.facilitator.url,
  });
  const facilitator = createFacilitatorClient({ url: validated.facilitator.url, logger });
  // Default to a fresh in-memory store when the host doesn't supply
  // one. Single shared reference for the lifetime of this server — so
  // commit-time writes and redeem-time reads observe the same Map.
  const exchangeFulfillmentOptionStore: Map<string, readonly string[]> =
    validated.exchangeFulfillmentOptionStore ?? new Map();
  const fulfillmentRecoveryStore: Map<string, FulfillmentRecoveryEntry> =
    validated.fulfillmentRecoveryStore ?? new Map();
  validated.exchangeFulfillmentOptionStore = exchangeFulfillmentOptionStore;
  validated.fulfillmentRecoveryStore = fulfillmentRecoveryStore;

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

  // Lazy-memoised read-only core-sdk. The construction itself is cheap
  // but happens on every `handlers.withdrawFunds()` /
  // `handlers.getAvailableFunds()` call — caching the adapter keeps the
  // hot path allocation-free and shares one subgraph client across
  // requests. `validated.coreSdkRead`, when supplied by the host, is
  // already shared.
  let cachedCoreSdkRead: CoreSdkReadAdapter | undefined;
  const requireCoreSdkRead = (action: string): CoreSdkReadAdapter => {
    if (validated.coreSdkRead !== undefined) return validated.coreSdkRead;
    if (cachedCoreSdkRead !== undefined) return cachedCoreSdkRead;
    if (validated.subgraphUrl === undefined) {
      throw new Error(
        `x402-server: handlers.${action}() requires either \`coreSdkRead\` or \`subgraphUrl\` in config (subgraph read step).`,
      );
    }
    cachedCoreSdkRead = asCoreSdkReadAdapter(
      new CoreSDK({
        web3Lib: createReadOnlyWeb3LibStub(),
        subgraphUrl: validated.subgraphUrl,
        protocolDiamond: validated.escrow,
        chainId: validated.chainId,
      }),
    );
    return cachedCoreSdkRead;
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
          fulfillmentRecoveryStore,
          exchangeFulfillmentOptionStore,
          logger,
        }),
      commitAndRedeem: async (input) =>
        handleCommitAndRedeem(input, {
          config: validated,
          facilitator,
          exchangeReader: await requireReader("commitAndRedeem"),
          fulfillmentRecoveryStore,
          exchangeFulfillmentOptionStore,
          logger,
        }),
      redeem: async (input) =>
        handleRedeem(input, {
          config: validated,
          facilitator,
          exchangeReader: await requireReader("redeem"),
          exchangeFulfillmentOptionStore,
          fulfillmentRecoveryStore,
          logger,
        }),
      complete: async (input) =>
        handleComplete(input, {
          config: validated,
          facilitator,
          exchangeReader: await requireReader("complete"),
          logger,
        }),
      disputeRaise: async (input) =>
        handleDisputeRaise(input, {
          config: validated,
          facilitator,
          exchangeReader: await requireReader("disputeRaise"),
          logger,
        }),
      disputeResolve: async (input) =>
        handleDisputeResolve(input, {
          config: validated,
          facilitator,
          exchangeReader: await requireReader("disputeResolve"),
          logger,
        }),
      disputeRetract: async (input) =>
        handleDisputeRetract(input, {
          config: validated,
          facilitator,
          exchangeReader: await requireReader("disputeRetract"),
          logger,
        }),
      disputeEscalate: async (input) =>
        handleDisputeEscalate(input, {
          config: validated,
          facilitator,
          exchangeReader: await requireReader("disputeEscalate"),
          logger,
        }),
      withdrawFunds: async (input) =>
        handleWithdrawFunds(input, {
          config: validated,
          facilitator,
          coreSdkRead: requireCoreSdkRead("withdrawFunds"),
        }),
      getAvailableFunds: async (query) =>
        handleGetAvailableFunds(query, {
          coreSdkRead: requireCoreSdkRead("getAvailableFunds"),
        }),
    },
  };
}
