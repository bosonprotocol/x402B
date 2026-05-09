// Server-side registry of configured FulfillmentChannel instances.
//
// Owns one channel instance per `id`, dispatches the lifecycle methods
// (`validate` / `onCommit` / `onFulfill`) by id, and produces the
// `options[]` array that goes into PaymentRequirements.fulfillment.
//
// Channels are kept opaque (generic params erased to `unknown`) once
// registered — the registry doesn't pretend to know each channel's
// `TBuyerData` shape; runtime validation lives inside each channel.

import type {
  FulfillmentChannel,
  FulfillmentOptionDescriptor,
  FulfillmentResult,
} from "../types.js";

export class FulfillmentRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FulfillmentRegistryError";
  }
}

export class DuplicateChannelError extends FulfillmentRegistryError {
  constructor(public readonly id: string) {
    super(`Fulfillment channel "${id}" is already registered`);
    this.name = "DuplicateChannelError";
  }
}

export class UnknownChannelError extends FulfillmentRegistryError {
  constructor(public readonly id: string) {
    super(`Fulfillment channel "${id}" is not registered`);
    this.name = "UnknownChannelError";
  }
}

type AnyChannel = FulfillmentChannel<unknown, unknown>;

export class FulfillmentRegistry {
  private readonly channels = new Map<string, AnyChannel>();

  /** Register a channel. Throws DuplicateChannelError if `id` is already taken. */
  register(channel: AnyChannel): void {
    if (this.channels.has(channel.id)) {
      throw new DuplicateChannelError(channel.id);
    }
    this.channels.set(channel.id, channel);
  }

  /** Look up a registered channel; `undefined` if none. */
  lookup(id: string): AnyChannel | undefined {
    return this.channels.get(id);
  }

  /** Whether a channel with the given id is registered. */
  has(id: string): boolean {
    return this.channels.has(id);
  }

  /** Ids of all registered channels, in insertion order. */
  ids(): string[] {
    return Array.from(this.channels.keys());
  }

  /** Build the `options[]` entries for the 402 PaymentRequirements. */
  describeAll(): FulfillmentOptionDescriptor[] {
    return Array.from(this.channels.values()).map((c) => c.describe());
  }

  /** Validate buyer-supplied data against the named channel. */
  validate(id: string, data: unknown): { ok: true } | { ok: false; reason: string } {
    return this.requireChannel(id).validate(data);
  }

  /** Persist buyer-supplied data against an exchange via the named channel. */
  async onCommit(id: string, exchangeId: string, data: unknown): Promise<void> {
    await this.requireChannel(id).onCommit(exchangeId, data);
  }

  /** Drive the fulfillment delivery via the named channel. */
  async onFulfill(id: string, exchangeId: string): Promise<FulfillmentResult> {
    return await this.requireChannel(id).onFulfill(exchangeId);
  }

  private requireChannel(id: string): AnyChannel {
    const channel = this.channels.get(id);
    if (!channel) throw new UnknownChannelError(id);
    return channel;
  }
}
