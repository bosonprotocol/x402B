// Client-side helper that selects a fulfillment option from the
// seller's advertised list and prepares the data the buyer will attach
// to the X-PAYMENT payload.
//
// Source of truth: docs/boson-impl-03-fulfillment-channels.md §"Client-side helper".
//
// Decoupled from the server-side FulfillmentRegistry on purpose: the
// client only needs to know which channel ids it can handle (`supports`),
// which it prefers (`prefer`), what data it already has
// (`agentContext`), and how to ask the buyer for missing data
// (`collectInteractive`). Full JSON-Schema validation lives server-side;
// here we do a minimal "required keys present" check so we don't
// happily pick an option we can't satisfy.

import type { FulfillmentOption } from "@bosonprotocol/x402-core/schemes/escrow";

export interface NegotiateOptions {
  /** Channel ids the client recognizes and can drive end-to-end. */
  supports: string[];
  /** Preferred channel ids in priority order; unknown ids are ignored. */
  prefer?: string[];
  /** Pre-known buyer data (e.g. an AI agent's xmtp address, an email on file). */
  agentContext?: Record<string, unknown>;
  /** Asked when an option's data isn't satisfied by `agentContext`. */
  collectInteractive?: (option: FulfillmentOption) => Promise<unknown>;
}

export interface NegotiationChoice {
  option: string;
  /** `null` when the option is schemaless (e.g. `inline`). */
  data: unknown | null;
}

export class NoCompatibleFulfillmentError extends Error {
  constructor(
    public readonly advertised: string[],
    public readonly attempted: string[],
  ) {
    super(
      advertised.length === 0
        ? "No fulfillment options were advertised by the seller"
        : attempted.length === 0
          ? `No advertised fulfillment option is supported by the client (advertised: ${advertised.join(", ")})`
          : `No advertised fulfillment option could be satisfied by the client (attempted: ${attempted.join(", ")})`,
    );
    this.name = "NoCompatibleFulfillmentError";
  }

  /** Supported options the client actually tried to satisfy. */
  get tried(): string[] {
    return this.attempted;
  }
}

/**
 * Walk the seller's advertised options in `prefer`-then-original order
 * and return the first one the client can satisfy.
 *
 * Throws `NoCompatibleFulfillmentError` if no option is reachable.
 */
export async function negotiateFulfillment(
  options: readonly FulfillmentOption[],
  cfg: NegotiateOptions,
): Promise<NegotiationChoice> {
  const ordered = orderOptions(options, cfg.prefer ?? []);
  const advertised = ordered.map((option) => option.id);
  const attempted: string[] = [];

  for (const option of ordered) {
    if (!cfg.supports.includes(option.id)) continue;
    attempted.push(option.id);

    if (option.schema == null) {
      return { option: option.id, data: null };
    }

    const fromAgent = cfg.agentContext
      ? extractFromAgentContext(option.schema, cfg.agentContext)
      : null;
    if (fromAgent !== null) {
      return { option: option.id, data: fromAgent };
    }

    if (cfg.collectInteractive) {
      const collected = await cfg.collectInteractive(option);
      if (matchesRequiredKeys(option.schema, collected)) {
        return { option: option.id, data: collected };
      }
    }
  }

  throw new NoCompatibleFulfillmentError(advertised, attempted);
}

function orderOptions(
  options: readonly FulfillmentOption[],
  prefer: readonly string[],
): FulfillmentOption[] {
  const byId = new Map(options.map((o) => [o.id, o]));
  const seen = new Set<string>();
  const ordered: FulfillmentOption[] = [];
  for (const id of prefer) {
    const opt = byId.get(id);
    if (opt && !seen.has(id)) {
      ordered.push(opt);
      seen.add(id);
    }
  }
  for (const opt of options) {
    if (!seen.has(opt.id)) {
      ordered.push(opt);
      seen.add(opt.id);
    }
  }
  return ordered;
}

function extractFromAgentContext(
  schema: Record<string, unknown>,
  agentContext: Record<string, unknown>,
): unknown | null {
  const required = Array.isArray(schema.required) ? (schema.required as string[]) : [];
  for (const key of required) {
    if (!(key in agentContext)) return null;
  }
  const properties =
    schema.properties && typeof schema.properties === "object"
      ? (schema.properties as Record<string, unknown>)
      : {};
  const known = new Set<string>([...required, ...Object.keys(properties)]);
  const data: Record<string, unknown> = {};
  for (const key of known) {
    if (key in agentContext) data[key] = agentContext[key];
  }
  return data;
}

function matchesRequiredKeys(schema: Record<string, unknown>, data: unknown): boolean {
  const required = Array.isArray(schema.required) ? (schema.required as string[]) : [];
  if (required.length === 0) return data !== undefined;
  if (data === null || typeof data !== "object") return false;
  const obj = data as Record<string, unknown>;
  return required.every((key) => key in obj);
}
