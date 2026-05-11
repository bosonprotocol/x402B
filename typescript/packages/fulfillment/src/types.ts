// Pluggable fulfillment-channel contract.
// Source of truth: docs/boson-impl-03-fulfillment-channels.md §`FulfillmentChannel` interface.

import type { FulfillmentOption } from "@bosonprotocol/x402-core/schemes/escrow";
import type { JSONSchema7 } from "json-schema";

/**
 * Server-side description of an advertised fulfillment option as it
 * appears on the wire, optionally augmented with channel-specific
 * `metadata` (e.g. a webhook URL or a widget endpoint).
 */
export interface FulfillmentOptionDescriptor extends FulfillmentOption {
  metadata?: unknown;
}

/**
 * Result of a server-side `onRedeem` invocation.
 *
 * - `atomic` — the resource itself is returned in-band (used by the
 *   `inline` channel; the body is the HTTP response payload).
 * - `async`  — the resource is delivered out-of-band; an optional
 *   `pointer` may be returned (e.g. `ipfs://…`, `https://…`,
 *   `mailto:…`) for callers that want to surface a tracking URL.
 */
export type FulfillmentResult =
  | { kind: "atomic"; body: Uint8Array; contentType: string }
  | { kind: "async"; pointer?: string };

/**
 * Pluggable fulfillment channel.
 *
 * Implementations describe one delivery mechanism the seller offers.
 * The same instance is used both to advertise the channel (`describe`)
 * and to drive the server-side lifecycle (`validate`, `onCommit`,
 * `onRedeem`). On the client, an optional `collect` may interactively
 * gather the buyer's data from a UI or agent.
 *
 * Type parameters:
 * - `TServerCfg`  — channel-specific server configuration (keys, urls).
 * - `TBuyerData`  — shape of the buyer-supplied data validated by
 *   `buyerDataSchema`. `null` for schemaless channels (e.g.
 *   `inline`, `widget`).
 */
export interface FulfillmentChannel<TServerCfg = unknown, TBuyerData = unknown> {
  /** Stable identifier used in the wire format (`fulfillment.option`). */
  readonly id: string;

  /** JSON Schema for the buyer's `fulfillment.data`, or `null` if the channel takes no data. */
  readonly buyerDataSchema: JSONSchema7 | null;

  /** Apply server-side configuration. Called once at boot, not per request. */
  configure(cfg: TServerCfg): void;

  /** Build the entry that goes into `PaymentRequirements.fulfillment.options[]`. */
  describe(): FulfillmentOptionDescriptor;

  /** Validate the buyer's attached data against `buyerDataSchema`. */
  validate(data: TBuyerData): { ok: true } | { ok: false; reason: string };

  /** Invoked at commit acceptance — store the buyer data against the exchange id. */
  onCommit(exchangeId: string, buyerData: TBuyerData): Promise<void>;

  /** Invoked when the redeem is observed — return the resource (atomic) or void (async). */
  onRedeem(exchangeId: string): Promise<FulfillmentResult>;

  /** Client-side: optionally collect buyer data interactively. */
  collect?(metadata: unknown): Promise<TBuyerData>;
}
