# 08 — Agent Mode

> **Status:** stub (v0.1, 2026-05-04). Bridges x402b to AI-agent commerce via MCP.

## Goals

`@bosonprotocol/x402-agent` lets an AI agent — running locally with MCP tools — consume the x402b protocol. It:

1. Translates x402b PaymentRequirements into a structured tool-call surface for the agent (e.g. `pay_and_commit`, `redeem`, `complete`, `raise_dispute`).
2. Bridges to `bosonprotocol/agentic-commerce` MCP for the on-chain calls — so the agent's preferred channel for any action can be `mcp` instead of the seller's HTTP server.
3. Provides default policies for agent buyers: prefer atomic commit-and-redeem (commit + redeem in one tx), prefer machine-readable delivery transports, set spending limits, auto-complete after redeem.
4. Provides default policies for agent sellers: auto-publish FullOffer signing, auto-handle redeem callbacks, auto-monitor disputes.

## Sketch — agent buyer

```ts
import { createAgentBuyer } from "@bosonprotocol/x402-agent";

const buyer = createAgentBuyer({
  wallet: agentWallet,
  mcp:    bosonAgenticCommerceMcp,
  policy: {
    maxAmount: "5000000",
    preferredChannels: ["mcp", "onchain", "facilitator", "server"],
    preferredDelivery: ["atomic-http", "xmtp", "email"],
    autoCompleteAfterRedeem: true,
  },
});

// the agent's planner calls this when it decides to buy:
const result = await buyer.buy("https://seller.example/datafeed");
// result = { exchangeId, resourceBytes, txHash }
```

## Sketch — agent seller

```ts
import { createAgentSeller } from "@bosonprotocol/x402-agent";

const seller = createAgentSeller({
  wallet: sellerAssistant,
  mcp:    bosonAgenticCommerceMcp,
  catalog: dynamicCatalog,    // generates FullOffer per request
  delivery: [/* transports */],
});

await seller.serve({ port: 8080 });
```

## Sections to write

- The exact MCP tool surface from `agentic-commerce` and how `x402-agent` wraps it.
- Channel fallback semantics for agents (when does an agent give up vs retry vs escalate).
- Policy DSL — declarative buying limits, allow/deny lists, dispute auto-raise rules.
- Offer-discovery (Bazaar?) integration for "find an offer that matches X" agent flows.
- Multi-agent commerce: agents that buy and resell.
