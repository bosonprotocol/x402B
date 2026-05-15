# 01 — The `escrow` Scheme

> **Status:** detailed spec (v0.1, 2026-05-04). This document is the wire-format source of truth.

## 1. Why a new scheme (not an extension)

An earlier design proposed reusing `scheme: "exact"` and shipping Boson context inside `extensions["boson-escrow"]`. That is unsafe in production for one concrete reason:

A non-Boson-aware facilitator that receives such a `PaymentPayload` with the standard `ExactEvmPayload` would interpret the inner ERC-3009 signature against the standard exact-scheme settle path. Even with `value: "0"` defanging, it consumes the EIP-3009 nonce — and worse, **if the buyer's wallet ever signs an ERC-3009 authorization with the same parameters via any other channel, that authorization can be reused** unless we hash-isolate at the EIP-712 level. Avoiding signature collision by burning a parallel "value=0" sig is fragile.

A first-class scheme `"escrow"` removes the hazard entirely:

- Non-Boson facilitators see an unfamiliar scheme value and reject with a structured error. **Default behaviour is fail-safe.**
- The buyer's headline signature is a Boson protocol meta-tx over `createOfferAndCommit` (deferred) or `createOfferCommitAndRedeem` (atomic) — bound to the protocol's EIP-712 domain, not reusable elsewhere.
- The token-authorization signature, when present, is the buyer's regular ERC-3009 / EIP-2612 / Permit2 signature for *this exact spend* of *this exact token*; if a non-Boson party tried to settle it, they'd just get the spend they were authorized for — not an attack vector.
- The wire format is free to carry Boson-shaped data (FullOffer, sellerSig, recipientId, fulfillment channel options, nextActions) at the top level rather than buried in a generic `info` blob.

Trade-off: the `escrow` scheme is not registered with the x402 Foundation (yet). Distribution is via the `@bosonprotocol/x402-*` packages. If the Foundation later wants to absorb it, it is a pure rename.

## 2. PaymentRequirements (server → client, in 402 body)

```jsonc
{
  "x402Version": 2,
  "accepts": [
    {
      "scheme": "escrow",
      "network": "eip155:8453",
      "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // USDC on Base
      "amount": "1000000",                                   // atomic units
      "escrowAddress": "0xDiamond...",                       // Boson Diamond
      "recipientId": "did:boson:seller:12345",               // sellerId / DID / address — routing-only
      "maxTimeoutSeconds": 300,

      "offer": {                                              // BPIP-10 off-chain offer
        "fullOffer": { /* BosonTypes.FullOffer */ },
        "sellerSig": "0x...",                                // EIP-712 over FullOffer (protocol domain)
        "creator": "0xSellerAssistant..."
      },

      "tokenAuthStrategies": ["none", "erc3009", "permit", "permit2"], // BPIP-12 strategies the protocol will accept for this token

      "fulfillment": {                                         // see boson-impl-03-fulfillment-channels.md
        "required": true,
        "options": [
          { "id": "inline",      "schema": null },
          { "id": "email",       "schema": { "type": "object", "required": ["email"] } },
          { "id": "xmtp",        "schema": { "type": "object", "required": ["xmtpAddress"] } },
          { "id": "webhook",     "schema": { "type": "object", "required": ["url", "publicKey"] } }
        ]
      },

      "actions": {                                             // see boson-impl-04-state-machine-and-next-actions.md
        "next": [
          {
            "id": "boson-createOfferAndCommit",                  // -> ExchangeCommitFacet.createOfferAndCommit
            "channels": ["server", "facilitator", "onchain", "mcp"],
            "endpoints": { "server": "https://seller.example/x402B/commit" }
          },
          {
            "id": "boson-createOfferCommitAndRedeem",            // -> OrchestrationHandlerFacet2.createOfferCommitAndRedeem
            "channels": ["server", "facilitator", "onchain", "mcp"],
            "endpoints": { "server": "https://seller.example/x402B/commit-and-redeem" }
          }
        ],
        "fallback": {
          "xmtp": "0xSellerXMTP...",
          "mcp":  "boson://seller/12345",
          "onchainHints": {
            "escrow":           "0xDiamond...",
            "metaTxFacet":      "MetaTransactionsHandlerFacet",
            "metaTxEntrypoints": {
              "none":    "executeMetaTransaction",
              "erc3009": "executeMetaTransactionWithTokenTransferAuthorization",
              "permit":  "executeMetaTransactionWithTokenTransferAuthorization",
              "permit2": "executeMetaTransactionWithTokenTransferAuthorization"
            },
            "actionFacets": {
              "boson-createOfferAndCommit":         "ExchangeCommitFacet",
              "boson-createOfferCommitAndRedeem":   "OrchestrationHandlerFacet2"
            }
          }
        }
      }
    }
  ]
}
```

### Field reference (PaymentRequirements)

| Field | Required | Notes |
|---|---|---|
| `scheme` | yes | Must be `"escrow"`. |
| `network` | yes | CAIP-2 (`eip155:<chainId>`). EVM only for v1. |
| `asset` | yes | ERC-20 token contract address. |
| `amount` | yes | Atomic units, decimal string. |
| `escrowAddress` | yes | Boson Diamond. The custodian. |
| `recipientId` | yes | Routing-only. May be a numeric `sellerId`, a `did:boson:seller:N`, or a wallet address. Server uses it to dispatch verify-of-state queries. |
| `maxTimeoutSeconds` | yes | Upper bound for `validBefore` in payment auth signatures. |
| `offer.fullOffer` | yes | `BosonTypes.FullOffer` from PR #1105. Used both as the on-chain create payload and to compute `offerHash`. |
| `offer.sellerSig` | yes | EIP-712 sig over `FullOffer` under the protocol domain. Validated by the protocol's `verifyOffer` (`EIP712Lib.verify`) — supports ECDSA and ERC-1271. |
| `offer.creator` | yes | The address whose key signed `sellerSig` (seller assistant). |
| `tokenAuthStrategies` | yes | Subset of `["none", "erc3009", "permit", "permit2"]` ([BPIP-12](https://github.com/zajck/BPIPs/blob/authorized-token-transfer-metaTx/content/BPIP-12.md)). The token-transfer authorization strategies the protocol will accept for this asset. `none` requires the buyer to pre-approve the Diamond. |
| `fulfillment` | optional | Absent or `{required: false}` if the resource is fully atomic. |
| `actions` | yes | Initial `nextActions` envelope. Always lists at least one of `boson-createOfferAndCommit` / `boson-createOfferCommitAndRedeem`. |

#### Action-id namespacing

All Boson-specific action ids carry the `boson-` prefix. The `escrow` scheme is intended to be reusable for other escrow implementations in the future; their action ids would carry their own prefix (e.g. `coinbase-…`). Clients that don't recognise an action's prefix MUST skip it rather than try to dispatch.

### x402 v1 fallback

For x402 v1 deployments that lack a top-level `extensions` field, the same `escrow`-shaped object is the payload object — the v1 PaymentRequirements `extra` slot is unused. v1 clients that don't recognize `scheme: "escrow"` will fail loudly per x402 v1 semantics, which is the desired behaviour.

## 3. PaymentPayload (client → server, in `X-PAYMENT` header)

The header value is base64(JSON):

```jsonc
{
  "x402Version": 2,
  "scheme": "escrow",
  "network": "eip155:8453",
  "payload": {
    "action": "boson-createOfferCommitAndRedeem",  // "boson-createOfferAndCommit" | "boson-createOfferCommitAndRedeem"
    "tokenAuthStrategy": "erc3009",          // "none" | "erc3009" | "permit" | "permit2"

    "offerRef": {                      // echo of the offer the server proposed
      "fullOffer": { /* echoed verbatim */ },
      "sellerSig": "0x..."
    },

    "buyer": "0xBuyer...",

    // The buyer's headline signature: a Boson protocol meta-tx authorising
    // execution of `<action>` (createOfferAndCommit or createOfferCommitAndRedeem)
    // on behalf of `buyer`. EIP-712 domain = protocol Diamond; type = MetaTransaction.
    "metaTx": {
      "from":         "0xBuyer...",
      "nonce":        "0",
      "functionName": "createOfferCommitAndRedeem(...)",  // or createOfferAndCommit(...)
      "functionSignature": "0x...",                              // ABI-encoded args (echoes offerRef + conditional fields)
      "sig":          { "v": 27, "r": "0x...", "s": "0x..." }
    },

    // Token-transfer authorization payload, per BPIP-12. Shape depends on tokenAuthStrategy.
    // The facilitator passes this through to executeMetaTransactionWithTokenTransferAuthorization
    // as a `bytes[] tokenTransferAuthorization` queue (one entry for the buyer's payment).

    // tokenAuthStrategy = "none" — payload omitted; buyer has pre-approved the Diamond.

    // tokenAuthStrategy = "erc3009"
    "tokenAuth": {
      "kind": "erc3009",
      "data": {
        "from": "0xBuyer...", "to": "0xDiamond...", "value": "1000000",
        "validAfter": 0, "validBefore": 1730000000, "nonce": "0xabcd...",
        "v": 27, "r": "0x...", "s": "0x..."
      }
    }

    // tokenAuthStrategy = "permit"
    // "tokenAuth": {
    //   "kind": "permit",
    //   "data": {
    //     "owner": "0xBuyer...", "spender": "0xDiamond...", "value": "1000000",
    //     "deadline": 1730000000, "nonce": "<token internal nonce>",
    //     "v": 27, "r": "0x...", "s": "0x..."
    //   }
    // }

    // tokenAuthStrategy = "permit2"
    // "tokenAuth": {
    //   "kind": "permit2",
    //   "data": {
    //     "permitted": { "token": "0x...", "amount": "1000000" },
    //     "spender":   "0xDiamond...",
    //     "nonce":     "<permit2 nonce>",
    //     "deadline":  1730000000,
    //     "signature": "0x..."
    //   }
    // }
  },

  "fulfillment": {
    "option": "email"
  }
}
```

The commit-time `fulfillment` slot carries only the buyer's chosen `option`
— used for capability negotiation against the server-advertised set. The
buyer's actual delivery data (`fulfillment.data`) flows with the
redeem-time POST body (`boson-redeem`); see
[03 — Fulfillment Channels](./boson-impl-03-fulfillment-channels.md). Atomic
Flow B (`boson-createOfferCommitAndRedeem`) is only appropriate for
channels embedded in the offer (e.g. `inline`) or off-band — Flow B
clients send no buyer-supplied delivery data.

### Field reference (PaymentPayload)

| Field | Required | Notes |
|---|---|---|
| `payload.action` | yes | Which transition the buyer is invoking — `boson-createOfferAndCommit` (deferred) or `boson-createOfferCommitAndRedeem` (atomic). Must appear in `actions.next[].id` from the requirements. |
| `payload.tokenAuthStrategy` | yes | One of `tokenAuthStrategies` from the requirements. |
| `payload.offerRef` | yes | Echoed; binds the payload to the specific offer the server signed. |
| `payload.buyer` | yes | Buyer wallet (recovered from sigs by the protocol; included for routing). |
| `payload.metaTx` | yes | Boson meta-tx envelope authorising execution of `<action>` on behalf of `buyer`. EIP-712 signed under the **protocol Diamond** domain (see §4.2). The single buyer signature for the action itself — independent of `tokenAuthStrategy`. |
| `payload.tokenAuth` | iff `tokenAuthStrategy ≠ "none"` | Token-transfer authorization for *this exact spend* (see §4.3). The facilitator passes it through `executeMetaTransactionWithTokenTransferAuthorization` as a queued entry the protocol consumes during `transferFundsIn`. |
| `fulfillment.option` | iff requirements `fulfillment.required = true` | Must be one of `fulfillment.options[].id`. The commit-time slot carries only the option id; delivery data flows on the redeem-time path. |

## 4. Signatures

### 4.1 Seller — `FullOffer` (protocol EIP-712 domain)

```
domain:  { name: "Boson Protocol", version: "V2", salt: bytes32(chainId), verifyingContract: <Diamond> }
type:    FullOffer(
           Offer offer,
           OfferDates offerDates,
           OfferDurations offerDurations,
           DRParameters drParameters,
           Condition condition,
           uint256 agentId,
           uint256 feeLimit,
           bool useDepositedFunds
         )
```

Nested structs `Offer`, `OfferDates`, `OfferDurations`, `DRParameters`, `Condition`, `RoyaltyInfo` are hashed per Boson's existing helpers. The signature is verified on-chain by `verifyOffer` (`EIP712Lib.verify`) and supports both ECDSA and ERC-1271.

### 4.2 Buyer — meta-tx for the action (always required)

The buyer signs **one** EIP-712 meta-tx authorising execution of `<action>` on the protocol Diamond. This is the only Boson-side signature required regardless of which token-auth strategy the buyer picks.

```
domain:  { name: "Boson Protocol", version: "V2", chainId, verifyingContract: <Diamond> }
type:    MetaTransaction(
           uint256 nonce,
           address from,
           address contractAddress,
           string  functionName,
           bytes   functionSignature
         )
```

`functionName` is one of:

- `"createOfferAndCommit(BosonTypes.FullOffer,address,bytes,uint256)"` — deferred path (`ExchangeCommitFacet`).
- `"createOfferCommitAndRedeem(BosonTypes.FullOffer,address,bytes,uint256)"` — atomic path (`OrchestrationHandlerFacet2`, [PR #1105](https://github.com/bosonprotocol/boson-protocol-contracts/pull/1105)).

`functionSignature` is the ABI encoding of the function parameters — including the `FullOffer` and the seller's signature, which echoes `requirements.offer.fullOffer` and `requirements.offer.sellerSig`.

The protocol's existing meta-tx replay protection (`MetaTransactionsHandlerFacet.usedNonce[from][nonce]`) applies. The relayer (facilitator) picks the entry point on `MetaTransactionsHandlerFacet` that matches the buyer's chosen `tokenAuthStrategy`:

- `tokenAuthStrategy = "none"` — submit via the legacy `executeMetaTransaction` (BPIP-9). No token-transfer authorization queue is needed because the buyer has pre-approved the Diamond.
- `tokenAuthStrategy = "erc3009"` / `"permit"` / `"permit2"` — submit via `executeMetaTransactionWithTokenTransferAuthorization` (BPIP-12), which reuses the same nonce scheme and additionally accepts a queue of token-transfer authorizations.

Both entry points are advertised on the wire via `onchainHints.metaTxEntrypoints`, keyed by strategy.

### 4.3 Buyer — token-transfer authorization (BPIP-12)

The buyer picks one of four strategies advertised in `requirements.tokenAuthStrategies`. The chosen strategy's authorization payload is queued in transient storage by the meta-tx entrypoint and consumed by `FundsBase.transferFundsIn` during action execution. See [BPIP-12](https://github.com/zajck/BPIPs/blob/authorized-token-transfer-metaTx/content/BPIP-12.md) for the canonical specification.

| Strategy | Buyer signs | Domain | Replay protection | Prior tx required |
|---|---|---|---|---|
| `none` | — | — | — | yes — buyer pre-approves the Diamond |
| `erc3009` | `ReceiveWithAuthorization(from, to, value, validAfter, validBefore, nonce)` | token's EIP-712 domain | random `nonce`, single-use, enforced by token | no |
| `permit` | `Permit(owner, spender, value, nonce, deadline)` | token's EIP-712 domain | sequential `nonce`, enforced by token | no |
| `permit2` | Uniswap Permit2 `PermitTransferFrom(permitted, spender, nonce, deadline)` | Permit2's EIP-712 domain | bitmap `nonce`, enforced by Permit2 | one-time `approve(Permit2, MaxUint)` per token |

For `erc3009`, `permit`, and `permit2`: `to` / `spender` MUST equal the **Boson Diamond** address, and `value` MUST equal `requirements.amount`. The token-auth signature is *not* tied to a forwarder; if it is replayed elsewhere it just authorizes its own token spend, which is what the buyer signed for in the first place.

For `permit`'s "diversion guard" (BPIP-12) — if current allowance already covers `value`, the protocol skips the permit step. Buyers can therefore re-use a long-lived approval and still pass `none`.

### 4.4 No separate redeem signature

For `action = boson-createOfferCommitAndRedeem`, the redeem step happens atomically inside the protocol call (`OrchestrationHandlerFacet2.createOfferCommitAndRedeem`, [PR #1105](https://github.com/bosonprotocol/boson-protocol-contracts/pull/1105)). The committer is `_msgSender()` of the meta-tx, so the meta-tx signature in §4.2 already authorises the redeem. **No additional buyer signature is needed for atomic on-chain redeem.** Note that this is independent of delivery timing — the resource itself may still be delivered later via the negotiated fulfillment channel.

## 5. Validation rules (server side, before forwarding to the facilitator)

1. `payload.scheme === requirements.scheme === "escrow"`.
2. `payload.network === requirements.network`.
3. `payload.offerRef.fullOffer` byte-equals `requirements.offer.fullOffer` (deep equality after canonical JSON ordering).
4. `payload.offerRef.sellerSig === requirements.offer.sellerSig`.
5. `payload.action ∈ requirements.actions.next[].id`.
6. `payload.tokenAuthStrategy ∈ requirements.tokenAuthStrategies`.
7. `payload.metaTx.functionSignature` decodes to args containing the same `FullOffer` and `sellerSig` as `requirements.offer`.
8. The recovered signer of `payload.metaTx.sig` equals `payload.buyer` and equals `payload.metaTx.from`.
9. For `tokenAuthStrategy = "erc3009"`: `tokenAuth.data.value === requirements.amount`, `tokenAuth.data.to === requirements.escrowAddress`, `tokenAuth.data.validBefore − now ≤ requirements.maxTimeoutSeconds`.
10. For `tokenAuthStrategy = "permit"`: `tokenAuth.data.value === requirements.amount`, `tokenAuth.data.spender === requirements.escrowAddress`, `tokenAuth.data.deadline − now ≤ requirements.maxTimeoutSeconds`.
11. For `tokenAuthStrategy = "permit2"`: `tokenAuth.data.permitted.amount === requirements.amount`, `tokenAuth.data.permitted.token === requirements.asset`, `tokenAuth.data.spender === requirements.escrowAddress`, `tokenAuth.data.deadline − now ≤ requirements.maxTimeoutSeconds`.
12. For `tokenAuthStrategy = "none"`: server SHOULD pre-flight `IERC20.allowance(buyer, diamond) ≥ amount` and reject early on insufficient allowance.
13. If `requirements.fulfillment.required`, `payload.fulfillment.option ∈ requirements.fulfillment.options[].id`. The commit-time payload carries only the chosen option for capability negotiation; the buyer's delivery data (validated against the option's `schema`) flows with `boson-redeem` — see [03 — Fulfillment Channels](./boson-impl-03-fulfillment-channels.md).

A failure on any rule returns `400` with a structured `{ code, field, expected, got }` body. The server does **not** consult the facilitator until §1–§13 pass.

## 6. JSON Schemas

The canonical JSON Schemas (`payment_requirements.schema.json`, `payment_payload.schema.json`) live in `@bosonprotocol/x402-core/schemas/`. They are validated in CI against every example in this repo with `ajv`.

## 7. Compatibility with vanilla x402

A vanilla `@x402/axios` client receiving `{ accepts: [{ scheme: "escrow", ... }] }` does not match any registered scheme handler and surfaces a structured `UnsupportedSchemeError`. **No accidental settle is possible.** The buyer must opt in by installing `@bosonprotocol/x402-client` (or its axios/fetch adapter), which registers the `escrow` scheme handler.

A server may simultaneously advertise an `exact` and an `escrow` accept entry, letting vanilla x402 clients use the trusted-counterparty path while Boson-aware clients prefer the escrow path. The choice belongs to the client.

## 8. Open items

- **Multi-chain offer hashing:** PR #1105's `getOfferHashInternal` is per-chain — confirm the SDK exposes it with the right `chainId` defaulting.
- **ERC-1271 sellers:** offer signatures from contract-wallets work on-chain via ERC-1271. The 402 sender side needs the seller's contract address surfaced in `offer.creator` so the verifier knows to call `isValidSignature`.
- **`expires_at` on the requirements:** consider promoting `maxTimeoutSeconds` to an absolute `expiresAt` to make the 402 cacheable. Not in v0.1.
- **Exact MetaTransaction type:** verify against `MetaTransactionsHandlerFacet` in the contracts repo — the `MetaTransaction(uint256 nonce, address from, address contractAddress, string functionName, bytes functionSignature)` shape above is BPIP-9 era; confirm it matches the BPIP-12 entrypoint expectations exactly.
- **Permit2 nonce shape:** Permit2 uses a word-bitmap nonce (`(uint256 wordPos, uint256 bitPos)` packed). Confirm the SDK builder produces and the facilitator passes a value the protocol's TokenTransferAuthorizationLib accepts.
