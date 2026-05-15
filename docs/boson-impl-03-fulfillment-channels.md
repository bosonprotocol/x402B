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

The buyer always sends the chosen option at commit time (for capability
negotiation against the server-advertised set). The buyer's delivery
data is action-conditional — it goes in `X-PAYMENT` for atomic Flow B
because there's only one round trip, and in the redeem POST body for
two-step Flow A because there's a later round trip for it.

### Atomic Flow B — `boson-createOfferCommitAndRedeem`

The commit and the on-chain redeem ship in a single transaction. The
`X-PAYMENT` payload carries the chosen option *and* its delivery data:

```jsonc
"fulfillment": {
  "option": "<chosen channel id>",
  "data":   { /* validates against the chosen option's schema (or null) */ }
}
```

No separate redeem round trip happens, so there's no later opportunity to
hand the seller delivery details. The server's commit handler invokes
`channel.onCommit(exchangeId, data)` immediately after the atomic redeem
settles on chain.

### Two-step Flow A — `boson-createOfferAndCommit` then `boson-redeem`

The `X-PAYMENT` payload carries only the chosen option:

```jsonc
"fulfillment": {
  "option": "<chosen channel id>"
}
```

The buyer attaches `data` later, in the `POST` to the `boson-redeem`
endpoint advertised in the 200 response's `nextActions`:

```jsonc
{
  "exchangeId": "<id>",
  "signedPayload": "0x...",
  "fulfillment": {
    "option": "<chosen channel id>",
    "data":   { /* validates against the chosen option's schema */ }
  }
}
```

The server's redeem handler invokes `channel.onCommit(exchangeId, data)`
on receipt. See [Wallet rebinding at redeem](#wallet-rebinding-at-redeem)
below for how the server validates that the redeeming wallet's choice of
option still matches the offer's advertised set when the voucher has
been transferred between commit and redeem.

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

  /** Server: invoked when the release is observed (REDEEMED on-chain); returns the resource inline or a pointer for async delivery. */
  onFulfill(exchangeId: string): Promise<FulfillmentResult>;

  /** Client: optionally collect buyer data interactively. */
  collect?(metadata: unknown): Promise<TBuyerData>;
}

export type FulfillmentResult =
  | { kind: "inline"; body: Uint8Array; contentType: string }
  | { kind: "async"; pointer?: string }; // pointer e.g. ipfs://, https://, mailto:
```

## Initial channel registry

| `id` | Use case | Buyer-data schema | Notes |
|---|---|---|---|
| `inline` | Resource returned in the same HTTP response | `null` | Server `onFulfill` returns the body inline. Composes naturally with Flow B's atomic commit-and-redeem (the resource is ready), but Flow B does **not** require this channel — the redeem state transition can be atomic while delivery itself is async. |
| `email` | Mailing list signup, license key dispatch | `{ email: string }` | RFC 5321 validation. Server stores against exchangeId; sends on redeem. |
| `xmtp` | Push to buyer's XMTP inbox | `{ xmtpAddress: string }` (EOA) | Useful for AI-agent buyers that already use XMTP for commerce. |
| `webhook` | Push to buyer-controlled HTTPS endpoint | `{ url: string, authToken?: string, encryptionPubKey?: string }` | See [Webhook security](#webhook-security) below. Server signs the envelope with the key under `metadata.serverPublicKey`; client verifies signature. |
| `ipfs-pointer` | Server uploads to IPFS, returns CID | `{ recipientPubKey?: string }` | Optional encryption to recipientPubKey. Returned on redeem. |
| `widget` | Human buyer + physical goods (existing Boson Redemption Widget) | `null` (collected by widget) | `metadata.widgetUrl` points the human to the existing redemption widget. The widget's existing backend hook is reused unchanged. |
| `mcp` | AI-agent buyer drives a server-exposed MCP tool | `{ mcpEndpoint?: string }` | The seller's MCP exposes a `submit_fulfillment_data(exchangeId, ...)` tool. The buyer's agent calls it post-commit. |

The registry is open: third parties can ship additional channels as `@bosonprotocol/x402-fulfillment-<id>` packages and register them with the SDK at startup.

## When data is collected

| Channel | Collected at | Why |
|---|---|---|
| `inline` | n/a | No data. |
| `email`, `xmtp`, `webhook`, `ipfs-pointer` | Atomic Flow B: at commit (in `X-PAYMENT`). Two-step Flow A: at redeem (in the `boson-redeem` POST body). | Lightweight; rides with whichever step is the last buyer round trip. |
| `widget`, `mcp` | Post-commit, via the channel itself | Heavier UI / agent-driven; not a fit for header-sized data. |

Servers SHOULD advertise at least one in-payload-shaped fulfillment channel (email/xmtp/webhook). Headless agents using atomic Flow B complete in one round trip (commit-and-redeem with data); agents using two-step Flow A complete in two (commit, then redeem with data).

## Privacy considerations

- `fulfillment.data` is stored server-side keyed by exchangeId. Servers MUST NOT include it in any unauthenticated channel.
- For `webhook`, the buyer's `encryptionPubKey` MAY be used to encrypt the resource payload (out of scope for v1; specced in `03b-webhook-encryption.md` later).
- Sellers should expose a deletion endpoint per their privacy policy; not in the protocol.

## Webhook security

The `webhook` channel hands the seller a buyer-controlled HTTPS URL — the buyer's endpoint can become a target as soon as the URL is known. The protocol layers three independent protections; the buyer SHOULD use all three:

1. **Server signature (always on).** The seller signs every webhook envelope with the key advertised under `metadata.serverPublicKey`. The envelope MUST include the `exchangeId` and a millisecond `timestamp`. The buyer MUST verify the signature, MUST reject envelopes whose `timestamp` is older than a small freshness window (recommended: ≤ 300 s), and MUST treat repeated deliveries with the same `exchangeId` as idempotent (one logical delivery, dedupe on the buyer's side).
2. **Bearer token (optional, buyer-published).** When the buyer sets `authToken`, the seller MUST send it as `Authorization: Bearer <authToken>` on every webhook request. This lets the buyer's edge layer reject unauthenticated traffic before any signature work — useful against random POSTers and leaked-URL scanning. The token travels in the redeem-time POST body, so it offers no protection against an attacker who can read that traffic; pair it with (1) for end-to-end authenticity.
3. **Encryption to buyer (optional, buyer-published).** When the buyer sets `encryptionPubKey`, the seller MAY encrypt the resource body to that key (cipher specified in `03b-webhook-encryption.md`; not yet implemented). Protects confidentiality against any actor with the URL but without the buyer's private key.

Seller adapters MUST refuse plain `http://` URLs — TLS is mandatory for the transport. Buyers SHOULD also rotate `authToken` per offer / per session if the same endpoint is reused across many exchanges.

## Validation rules

### Commit-time (server, before /verify)

1. If `requirements.fulfillment.required === true`, `payload.fulfillment.option` MUST be present and MUST match an advertised channel id from `requirements.fulfillment.options[].id`.
2. Action-conditional `payload.fulfillment.data`:
   - For `payload.action = boson-createOfferCommitAndRedeem` (atomic Flow B): `data` MUST be present. The chosen option's `buyerDataSchema` MUST validate `data` (or `null` when the schema is `null`). The server-side channel instance MUST be configured (at boot, not per-request).
   - For `payload.action = boson-createOfferAndCommit` (two-step Flow A): `data` MUST be absent — it's reserved for the redeem POST body.
3. **Flow B only:** after the atomic redeem confirms on chain, the commit handler calls `channel.onCommit(exchangeId, data)` to persist the buyer's delivery target. A failing channel write surfaces as a `FULFILLMENT_COMMIT_DEFERRED` warning on the 200 response; the on-chain state is already irreversibly `REDEEMED`.
4. **Flow A only:** the server persists the *advertised* option ids against the exchange so the redeem-time check below can constrain the buyer's choice when the voucher has been transferred between commit and redeem.

### Redeem-time (server, on `boson-redeem` POST)

1. The chosen option's `buyerDataSchema` MUST validate the redeem-time body's `fulfillment.data` (or `null` if schema is `null`).
2. The server-side instance of the channel MUST be configured (at boot, not per-request).
3. After redeem confirmation, server calls `channel.onCommit(exchangeId, data)` to persist the buyer's delivery target. A failing channel write surfaces as a `FULFILLMENT_UPDATE_DEFERRED` warning on the 200 response.

## Wallet rebinding at redeem

In the two-step flow A (`boson-createOfferAndCommit` followed later by `boson-redeem`) the redeeming wallet is not guaranteed to be the same wallet that committed — the voucher NFT is transferable. Because buyer-supplied delivery data only flows at redeem time, the server tracks the committer wallet at commit time and applies the following rule at redeem:

| Stored committer | Redeemer wallet | Buyer `fulfillment` field |
|---|---|---|
| `A` | `A` | OPTIONAL — same buyer, no delivery target supplied means use whatever default the channel allows |
| `A` | `B` (different) | **REQUIRED** — server rejects with `FULFILLMENT_REQUIRED_ON_WALLET_CHANGE` if absent |
| absent (legacy / atomic) | any | no-op |

When a redeem request carries `fulfillment`, `option` MUST be one of the options advertised in the original 402 for that exchange. The server runs `channel.validate(data)` and then `channel.onCommit(exchangeId, data)` — channels treat `onCommit` as an upsert. The redeem-time wire shape is `{ option: string, data: <schema-of-option> | null }`.

Because the on-chain redeem is irreversible, servers should record a pending fulfillment update before the post-redeem channel upsert and clear it only after `onCommit` succeeds. If that upsert fails, the redeem response should still report the successful transaction and include a warning such as `FULFILLMENT_UPDATE_DEFERRED`, leaving the pending update for host-side replay/reconciliation.

Flow B (`boson-createOfferCommitAndRedeem`, atomic) is unaffected — the exchange reaches `REDEEMED` in a single transaction; there is no later redeem step, and no buyer-supplied delivery data is carried on the commit-time payload. Flow B is only appropriate for channels embedded in the offer (e.g. `inline`) or off-band.

## Client-side helper

```ts
import { negotiateFulfillment } from "@bosonprotocol/x402-fulfillment";

const choice = await negotiateFulfillment(requirements.fulfillment.options, {
  prefer: ["inline", "xmtp", "email"],               // for AI agents
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
