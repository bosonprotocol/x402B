// Shared wire-format types for the `escrow` scheme.
// Source of truth: docs/boson-impl-01-escrow-scheme.md.

/**
 * CAIP-2 network identifier for an EVM chain. Constrained to `eip155:<chainId>`
 * shape at runtime by the JSON Schema and zod regex; aliased to `string` here
 * for the same reason as `Address` / `Hex` — the wire format is JSON, where
 * everything is a string, and template-literal types cause friction with
 * zod's regex-based validators.
 */
export type EvmNetwork = string;

/** BPIP-12 token-authorization strategies. */
export type TokenAuthStrategy = "none" | "erc3009" | "permit" | "permit2";
export const TOKEN_AUTH_STRATEGIES: readonly TokenAuthStrategy[] = [
  "none",
  "erc3009",
  "permit",
  "permit2",
] as const;

/** Boson commit-time action ids advertised by the server. */
export type BosonCommitActionId = "boson-createOfferAndCommit" | "boson-createOfferCommitAndRedeem";

/** Channels through which a `nextAction` can be performed. */
export type ActionChannel = "server" | "facilitator" | "onchain" | "mcp" | "xmtp";
export const ACTION_CHANNELS: readonly ActionChannel[] = [
  "server",
  "facilitator",
  "onchain",
  "mcp",
  "xmtp",
] as const;

/**
 * BPIP-10 FullOffer. Treated as opaque at this layer — the on-chain shape lives
 * in `@bosonprotocol/core-sdk`, and validation against the protocol struct is
 * the EIP-712 builder's job. Here it's just "an object echoed verbatim".
 */
export type FullOffer = Record<string, unknown>;

/**
 * 0x-prefixed hex string. Aliased to `string` in the wire format so JSON
 * shapes are easy to construct; runtime validation is handled by the JSON
 * Schema and zod regex. The strongly-typed `\`0x${string}\`` form is reserved
 * for the EIP-712 builder layer where viem's brands matter.
 */
export type Hex = string;
/** 0x-prefixed 40-char hex string. See `Hex` for typing rationale. */
export type Address = string;

/** Off-chain offer reference signed by the seller. */
export interface BosonOfferRef {
  fullOffer: FullOffer;
  sellerSig: Hex;
  creator: Address;
}

export interface FulfillmentOption {
  id: string;
  /** JSON-Schema-shaped `type: object` description of the data the buyer must supply, or `null` for atomic. */
  schema: Record<string, unknown> | null;
}

export interface FulfillmentRequirements {
  required: boolean;
  options: FulfillmentOption[];
}

export interface NextAction {
  id: string;
  channels: ActionChannel[];
  endpoints?: Record<string, string>;
}

export interface OnchainHints {
  /** Address of the Boson escrow contract. */
  escrow: Address;
  metaTxFacet: string;
  metaTxEntrypoint: string;
  actionFacets: Record<string, string>;
}

export interface ActionsFallback {
  xmtp?: string;
  mcp?: string;
  onchainHints?: OnchainHints;
}

export interface ActionsEnvelope {
  next: NextAction[];
  fallback?: ActionsFallback;
}

/** Boson protocol meta-transaction envelope (signed by the buyer). */
export interface BosonMetaTx {
  from: Address;
  /** Decimal string. */
  nonce: string;
  functionName: string;
  /**
   * ABI-encoded function-call data as a `0x`-prefixed hex string. Named
   * `functionSignature` to match the on-chain `MetaTransactionsHandlerFacet`
   * struct field — the value is the encoded calldata, not just the function
   * selector.
   */
  functionSignature: Hex;
  sig: { v: number; r: Hex; s: Hex };
}

export interface Erc3009AuthData {
  from: Address;
  to: Address;
  /** Atomic units, decimal string. */
  value: string;
  validAfter: number;
  validBefore: number;
  /** 32-byte hex string. */
  nonce: Hex;
  v: number;
  r: Hex;
  s: Hex;
}

export interface PermitAuthData {
  owner: Address;
  spender: Address;
  /** Atomic units, decimal string. */
  value: string;
  deadline: number;
  /** Token-internal sequential nonce, decimal string. */
  nonce: string;
  v: number;
  r: Hex;
  s: Hex;
}

export interface Permit2AuthData {
  permitted: { token: Address; amount: string };
  spender: Address;
  /** Permit2 word-bitmap nonce, decimal string. */
  nonce: string;
  deadline: number;
  /** Concatenated 65-byte ECDSA signature. */
  signature: Hex;
}

/** Discriminated union of all token-authorization payloads. `none` is encoded by the absence of this field on the payload. */
export type BosonTokenAuth =
  | { kind: "erc3009"; data: Erc3009AuthData }
  | { kind: "permit"; data: PermitAuthData }
  | { kind: "permit2"; data: Permit2AuthData };
