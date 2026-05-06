# 09 — Seller Metadata Extension

> **Status:** stub (v0.1, 2026-05-04). Extends the existing Boson SELLER metadata schema with the channel registry that powers `nextActions.fallback`.

## Goals

When the buyer falls off the seller's HTTP server (server down, server censoring, server slow), the buyer needs to reach the seller through some other channel. The seller publishes alternate channels in their on-chain seller metadata (already supported by `@bosonprotocol/metadata`); x402b reads them and surfaces them as `nextActions.fallback`.

## Schema additions to SELLER metadata

```jsonc
{
  "schemaUrl": "https://schemas.bosonprotocol.io/seller/v2",
  "type": "SELLER",
  // ... existing fields ...
  "channels": {
    "x402b": {
      "endpoints": {
        "base":         "https://seller.example/x402b",        // discoverable root, all server-side endpoints under here
        "openapi":      "https://seller.example/x402b/openapi.json"  // optional
      },
      "xmtp":          "0xSellerXMTPInbox...",                  // for xmtp channel
      "mcp": {
        "uri":         "boson://seller/12345",                   // for mcp channel (MCP discovery URI)
        "tools":       ["submit_delivery_data", "raise_dispute_proxy"]  // optional whitelist
      },
      "fallbackOrder": ["server", "facilitator", "onchain", "mcp", "xmtp"],
      "preferredFacilitator": "https://facilitator.boson.example",
      "supportedFulfillmentChannels": ["atomic-http", "email", "xmtp"]
    }
  }
}
```

## Why on-chain (in seller metadata) and not in the 402

Two reasons:

1. **Bootstrap:** if the buyer can't reach the server's 402, they still need a fallback. A buyer who knows only `sellerId` should be able to get to a working contact channel.
2. **Discovery:** offer-discovery tools (Bazaar et al.) can pre-filter sellers by accepted channels and fulfillment channels before the buyer ever fires a GET.

The 402 echoes the relevant subset (per current state) for convenience; the canonical source is the seller's metadata.

## Sections to write

- Versioning: `channels.x402b.version` for forward compatibility.
- Per-action overrides (a seller may advertise `boson-raiseDispute` over xmtp but `boson-completeExchange` only on-chain).
- Public-key publication for webhook fulfillment channel.
- Migration story for existing sellers on `@bosonprotocol/metadata` v1 — additive only, old fields untouched.
- Validation in `@bosonprotocol/metadata` package.
