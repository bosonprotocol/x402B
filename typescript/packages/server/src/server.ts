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
import { mapAsStore, type Store } from "./store.js";
import { createKeyedMutex } from "./concurrency.js";
import { noopLogger, type Logger } from "./logger.js";
import { createHealthCheck, type HealthCheckResult } from "./health.js";

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

/**
 * Result of a single `recovery.replay(exchangeId)` call. `{ ok: true }`
 * means the channel adapter's `onCommit(...)` succeeded and the recovery
 * entry has been deleted; `{ ok: false, reason }` leaves the entry in
 * place and reports the failure cause.
 */
export type RecoveryReplayResult = { ok: true } | { ok: false; reason: string };

/**
 * Operator surface for inspecting and replaying the deferred-fulfillment
 * recovery store. The handlers record an entry when a post-settle
 * `channel.onCommit(...)` fails or is missing an adapter; the entries
 * sit until the host replays them out-of-band. This API exposes the
 * inspection + replay primitives so a host doesn't need to hold the
 * raw Map reference itself.
 */
export interface RecoveryApi {
  /** Snapshot of all pending recovery entries. */
  list(): Promise<readonly FulfillmentRecoveryEntry[]>;
  /**
   * Re-run `channel.onCommit(exchangeId, entry.data)` for the recorded
   * entry. Deletes the entry on success; leaves it (with an updated
   * `error` field) on failure.
   */
  replay(exchangeId: string): Promise<RecoveryReplayResult>;
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

  /**
   * Operator API for the deferred-fulfillment recovery queue. See
   * `RecoveryApi` and `docs/boson-impl-05-server-sdk.md` for the
   * operator runbook.
   */
  readonly recovery: RecoveryApi;

  /**
   * Liveness probe — pings the facilitator's `/healthz` and (if a
   * subgraph / read client is configured) a cheap subgraph read. Hosts
   * mount this behind whatever `/healthz` / `/readyz` route their
   * framework uses.
   */
  healthCheck(): Promise<HealthCheckResult>;
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
  const facilitator = createFacilitatorClient({
    url: validated.facilitator.url,
    logger,
    ...(validated.facilitator.timeoutMs !== undefined
      ? { timeoutMs: validated.facilitator.timeoutMs }
      : {}),
    ...(validated.facilitator.retry !== undefined ? { retry: validated.facilitator.retry } : {}),
    ...(validated.facilitator.idempotencyKey !== undefined
      ? { idempotencyKey: validated.facilitator.idempotencyKey }
      : {}),
  });

  // Serialize the exchange-keyed handlers (redeem / complete / dispute*)
  // per `exchangeId`. Two concurrent redeems on the same exchange would
  // otherwise both pass the facilitator round-trip and race the
  // post-settle channel.onCommit + store writes. Process-local only —
  // multi-instance hosts rely on the new idempotency-key + on-chain
  // state checks for cross-process safety.
  const exchangeMutex = createKeyedMutex<string>();
  // Default to a fresh in-memory store when the host doesn't supply
  // one. Single shared reference for the lifetime of this server — so
  // commit-time writes and redeem-time reads observe the same backing
  // state. `mapAsStore` keeps single-process / dev deployments free of
  // extra wiring; multi-instance / restart-surviving hosts plug in
  // their own `Store` impl (Redis, Postgres, …).
  const exchangeFulfillmentOptionStore: Store<readonly string[]> =
    validated.exchangeFulfillmentOptionStore ?? mapAsStore(new Map<string, readonly string[]>());
  const fulfillmentRecoveryStore: Store<FulfillmentRecoveryEntry> =
    validated.fulfillmentRecoveryStore ?? mapAsStore(new Map<string, FulfillmentRecoveryEntry>());
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

  const recovery: RecoveryApi = {
    async list() {
      // Snapshot at call time via the Store's async iterator so callers
      // iterate a stable view even if a handler concurrently mutates
      // the store.
      const entries: FulfillmentRecoveryEntry[] = [];
      for await (const [, value] of fulfillmentRecoveryStore.entries()) {
        entries.push(value);
      }
      return entries;
    },
    async replay(exchangeId) {
      const entry = await fulfillmentRecoveryStore.get(exchangeId);
      if (entry === undefined) {
        return { ok: false, reason: `no pending recovery entry for exchangeId '${exchangeId}'` };
      }
      const channels = validated.fulfillmentChannels ?? [];
      const channel = channels.find((c) => c.id === entry.option);
      if (channel === undefined) {
        const reason = `no channel adapter is registered for option '${entry.option}'`;
        await fulfillmentRecoveryStore.set(exchangeId, { ...entry, error: reason });
        return { ok: false, reason };
      }
      try {
        await channel.onCommit(exchangeId, entry.data);
        await fulfillmentRecoveryStore.delete(exchangeId);
        return { ok: true };
      } catch (e) {
        const reason = e instanceof Error ? e.message : String(e);
        await fulfillmentRecoveryStore.set(exchangeId, { ...entry, error: reason });
        return { ok: false, reason };
      }
    },
  };

  const healthCheck = createHealthCheck({
    facilitator,
    // Probe an existing coreSdkRead if the host supplied one. The
    // lazy default created from `subgraphUrl` only materialises on
    // the first withdraw / available-funds call — health-check
    // shouldn't pay the construction cost just to ping it; report
    // `"n/a"` until a real read client is available.
    coreSdkRead: () => validated.coreSdkRead ?? cachedCoreSdkRead,
  });

  return {
    config: validated,
    facilitator,
    signOffer,
    recovery,
    healthCheck,
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
        exchangeMutex.runExclusive(input.exchangeId, async () =>
          handleRedeem(input, {
            config: validated,
            facilitator,
            exchangeReader: await requireReader("redeem"),
            exchangeFulfillmentOptionStore,
            fulfillmentRecoveryStore,
            logger,
          }),
        ),
      complete: async (input) =>
        exchangeMutex.runExclusive(input.exchangeId, async () =>
          handleComplete(input, {
            config: validated,
            facilitator,
            exchangeReader: await requireReader("complete"),
            logger,
          }),
        ),
      disputeRaise: async (input) =>
        exchangeMutex.runExclusive(input.exchangeId, async () =>
          handleDisputeRaise(input, {
            config: validated,
            facilitator,
            exchangeReader: await requireReader("disputeRaise"),
            logger,
          }),
        ),
      disputeResolve: async (input) =>
        exchangeMutex.runExclusive(input.exchangeId, async () =>
          handleDisputeResolve(input, {
            config: validated,
            facilitator,
            exchangeReader: await requireReader("disputeResolve"),
            logger,
          }),
        ),
      disputeRetract: async (input) =>
        exchangeMutex.runExclusive(input.exchangeId, async () =>
          handleDisputeRetract(input, {
            config: validated,
            facilitator,
            exchangeReader: await requireReader("disputeRetract"),
            logger,
          }),
        ),
      disputeEscalate: async (input) =>
        exchangeMutex.runExclusive(input.exchangeId, async () =>
          handleDisputeEscalate(input, {
            config: validated,
            facilitator,
            exchangeReader: await requireReader("disputeEscalate"),
            logger,
          }),
        ),
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
