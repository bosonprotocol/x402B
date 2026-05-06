# 03 — Fulfillment Channels

> **Status:** detailed spec (v0.1, 2026-05-04). Defines how the buyer's "where to deliver" data is negotiated and exchanged.

## Why this is in the protocol, not an afterthought

Boson exchanges separate payment (commit) from delivery (redeem). Some offers deliver atomically (the resource is the HTTP 200 body); others deliver out-of-band (mailing list, license dispatch, package shipment, off-chain account provisioning). The buyer's required delivery data depends on three orthogonal choices:

- **Offer type** — atomic / digital-non-atomic / physical.
- **Buyer type** — human (UI/widget acceptable) vs AI agent (machine-readable channel only).
- **Seller policy** — what the seller wants to collect, and how.

Rather than fork that complexity into per-seller bespoke flows, x402B standardizes a `FulfillmentChannel` interface. The 402 advertises which channels the seller supports; the buyer picks one and attaches channel-specific data alongside the payment payload (or out-of-band, depending on channel).

## Server side — advertising

In the `escrow` PaymentRequirements:

```jsonc
"fulfillment": {
  "required": true,                  // false ⇒ atomic; buyer attaches nothing
  "options": [
    {
      "id": "<channel-id>",          // see registry below
      "schema": <JSON Schema>,        // shape of the data the buyer must attach
      "metadata": { /* per-channel hints, e.g. server's webhook url */ }
    }
  ]
}
```

A server may advertise multiple options; the buyer picks one.

## Client side — picking and attaching

The `X-PAYMENT` payload includes:

```jsonc
"fulfillment": {
  "option": "<chosen channel id>",
  "data":   { /* validates against the chosen option's schema */ }
}
```

For channels where data is collected post-commit (e.g. `widget`), `fulfillment.data` is `null` in the X-PAYMENT and the actual collection happens between commit and redeem via the channel itself.

## `FulfillmentChannel` interface (TypeScript)

```ts
export interface FulfillmentChannel<TServerCfg = unknown, TBuyerData = unknown> {
  /** Stable identifier used in the wire format. */
  readonly id: string;

  /** JSON Schema describing what the buyer must put in `fulfillment.data`. */
  readonly buyerDataSchema: JSONSchema7 | null;

  /** Server-side config: keys, urls, etc. */
  configure(cfg: TServerCfg): void;

  /** Server: build the `options[]` entry for the 402 response. */
  describe(): { id: string; schema: JSONSchema7 | null; metadata?: unknown };

  /** Server: validate the buyer's attached data. */
  validate(data: TBuyerData): { ok: true } | { ok: false; reason: string };

  /** Server: invoked at commit acceptance — store buyerData against exchangeId. */
  onCommit(exchangeId: string, buyerData: TBuyerData): Promise<void>;

  /** Server: invoked when the redeem is observed; returns the resource (atomic) or void (async). */
  onRedeem(exchangeId: string): Promise<FulfillmentResult>;

  /** Client: optionally collect buyer data interactively. */
  collect?(metadata: unknown): Promise<TBuyerData>;
}

export type FulfillmentResult =
  | { kind: "atomic"; body: Uint8Array; contentType: string }
  | { kind: "async"; pointer?: string }; // pointer e.g. ipfs://, https://, mailto:
```

## Initial channel registry

| `id` | Use case | Buyer-data schema | Notes |
|---|---|---|---|
| `atomic-http` | Resource returned in same HTTP response | `null` | Server `onRedeem` returns the body. Composes naturally with Flow B's atomic commit-and-redeem (the resource is ready), but Flow B does **not** require this channel — the redeem state transition can be atomic while delivery itself is async. |
| `email` | Mailing list signup, license key dispatch | `{ email: string }` | RFC 5321 validation. Server stores against exchangeId; sends on redeem. |
| `xmtp` | Push to buyer's XMTP inbox | `{ xmtpAddress: string }` (EOA) | Useful for AI-agent buyers that already use XMTP for commerce. |
| `webhook` | Push to buyer-controlled HTTPS endpoint | `{ url: string, publicKey: string }` | Server signs the payload with a key under `metadata.serverPublicKey`; client verifies signature. |
| `ipfs-pointer` | Server uploads to IPFS, returns CID | `{ recipientPubKey?: string }` | Optional encryption to recipientPubKey. Returned on redeem. |
| `widget` | Human buyer + physical goods (existing Boson Redemption Widget) | `null` (collected by widget) | `metadata.widgetUrl` points the human to the existing redemption widget. The widget's existing backend hook is reused unchanged. |
| `mcp` | AI-agent buyer drives a server-exposed MCP tool | `{ mcpEndpoint?: string }` | The seller's MCP exposes a `submit_fulfillment_data(exchangeId, ...)` tool. The buyer's agent calls it post-commit. |

The registry is open: third parties can ship additional channels as `@bosonprotocol/x402-fulfillment-<id>` packages and register them with the SDK at startup.

## When data is collected

| Channel | Collected at | Why |
|---|---|---|
| `atomic-http` | n/a | No data. |
| `email`, `xmtp`, `webhook`, `ipfs-pointer` | At commit (in X-PAYMENT) | Lightweight, no side-channel needed. |
| `widget`, `mcp` | Post-commit, via the channel itself | Heavier UI / agent-driven; not a fit for header-sized data. |

Servers SHOULD advertise at least one "in-payload" fulfillment channel (email/xmtp/webhook) so headless agents can complete in a single round trip.

## Privacy considerations

- `fulfillment.data` is stored server-side keyed by exchangeId. Servers MUST NOT include it in any unauthenticated channel.
- For `webhook`, the buyer's `publicKey` MAY be used to encrypt the resource payload (out of scope for v1; specced in `03b-webhook-encryption.md` later).
- Sellers should expose a deletion endpoint per their privacy policy; not in the protocol.

## Validation rules (server side, before /verify)

1. If `requirements.fulfillment.required === true`, `payload.fulfillment.option` MUST be present and MUST match a registered channel.
2. The chosen option's `buyerDataSchema` MUST validate `payload.fulfillment.data` (or `null` if schema is `null`).
3. The server-side instance of the channel MUST be configured (at boot, not per-request).
4. After commit acceptance, server calls `channel.onCommit(exchangeId, data)` BEFORE returning 200.

## Client-side helper

```ts
import { negotiateFulfillment } from "@bosonprotocol/x402-fulfillment";

const choice = await negotiateFulfillment(requirements.fulfillment.options, {
  prefer: ["atomic-http", "xmtp", "email"],          // for AI agents
  collectInteractive: ui?.collect,                   // for humans
  agentContext: { xmtpAddress: agentWallet.xmtp },   // pre-known data
});
// choice = { option: "xmtp", data: { xmtpAddress: "0x..." } }
```

`negotiateFulfillment` returns the first option that (a) the client supports, (b) the client has data for (or can collect), and (c) is acceptable to the agent's policy.

## Open items

- **Multi-step deliveries** (a license + an email confirmation): for v1, sellers split into separate offers. Multi-channel per offer is a v2 feature.
- **Data-at-rest encryption** for `email`/`webhook` storage on the server: out of scope; sellers handle per their stack.
- **Channel advertising in seller metadata** (so a buyer can pre-filter sellers by accepted fulfillment channels): see [boson-impl-09-seller-metadata.md](./boson-impl-09-seller-metadata.md).
