# Facet + Boson escrow — opening a store to AI agents

## What Facet is

[Facet](https://facet.llc) is the protocol layer a business turns toward machines: it lets
autonomous agents **discover, identify, transact, and audit** on a merchant's site. Rather than
inventing a new standard, Facet composes four open ones into a stack an agent can speak
end-to-end, and ships the product layers those specs deliberately leave unspecified.

| Layer | Open standard |
|---|---|
| Discovery | MCP (capability + tool surface) + `agents.txt` served at `/.well-known/agents.txt` |
| Identity | KYAPay — ES256 JWT verified against issuer-published keys (multi-issuer allow-list) |
| Payments | x402 — HTTP 402 Payment Required as a native settlement signal |
| Bot signing | RFC 9421 web-bot-auth |
| Contract | OpenAPI 3.1 + Overlay 1.0, generated from the typed protocol and CI drift-gated |

The agent-facing runtime is the **Terminal**, which runs at the merchant's own domain. It verifies
the caller's identity token, meters and rate-limits the request, dispatches it, **signs the
response** (Ed25519, keys published as a JWKS), and appends to an append-only audit log. So an
operator sees *agents*, not anonymised scrapers: which agents arrive, what they discover, quote,
and buy, and the agent-versus-human split per route.

Why now: AI-agent traffic crossed **50% of non-search bot volume in early 2025** and is rising
(Cloudflare Radar). Today that traffic is unmetered, unidentified, and unauditable — a business
absorbs the bandwidth while the value accrues to the agent's operator. A Terminal turns that
traffic from a cost into a channel.

## Boson escrow as a payment rail

Facet is **rail-neutral by contract** — cards and USDC-over-x402 return the same receipt envelope,
so the agent never sees the difference. One of the rails a Facet store can accept is **Boson
Protocol escrow**, via the [x402B](../../docs/boson-impl-00-overview.md) scheme.

x402B keeps x402's HTTP-native, gasless, single-round-trip UX and replaces the trusted-server
payment model: the buyer signs a stablecoin (USDC) spend authorization, and the funds are locked
in a **non-custodial escrow contract** on commit. They release to the seller only once the buyer's
voucher is **redeemed** — on fulfillment — or the dispute window expires. If delivery fails, a
registered third-party dispute resolver can split the funds and slash the seller's bond.

## What a store gains

**Trade with agents you have no relationship with.** This is the point. A long-tail agent
discovering your store has no contract, no credit history, and no prior trust with you — and you
have none with its operator. Escrow plus protocol-level dispute resolution substitutes for that
missing relationship, so a first-time agent purchase is safe for both sides without either
underwriting the other.

| | Seller | Buyer agent |
|---|---|---|
| **Custody** | Funds never touch the store's or Facet's balance sheet — they sit in the escrow contract. Facet's settlement design is non-custodial by architecture. | Money is protected until the order is actually fulfilled. |
| **Settlement** | Paid on redeem, with a bounded dispute window instead of an open-ended card chargeback exposure. | One ERC-3009 authorization, signed locally — nothing moves until commit. |
| **Cost of entry** | Facilitator relays the on-chain commit, so the buyer needs no ETH. Removes the single biggest onboarding barrier for agent buyers. | **Gasless**: hold USDC, no native gas token, no bridging. |
| **Auditability** | An on-chain transaction hash anyone can verify on a block explorer, plus a signed Terminal receipt over the request and response. | Cryptographic provenance it can forward to a downstream agent without being trusted itself. |
| **Integration** | Rail-symmetric receipts: run cards and escrowed USDC side by side without forking the integration. | Structured, signed responses — no proxies, no CAPTCHAs, no HTML parsing. |

## Where to go next

- **[facet.llc](https://facet.llc)** — general information about Facet: the Terminal, agent
  analytics, the reputation registry, the knowledge graph, and the open
  [spec](https://github.com/facet-llc/spec) and [SDKs](https://github.com/facet-llc/sdk)
  (Apache 2.0).
- **[Mount your store](https://facet.llc/#mount)** — the onboarding flow for a business opening
  its store to AI agents. Facet ingests your existing catalog (Shopify, WooCommerce, NetSuite,
  CSV, PIM) into a normalised manifest — every inferred field flagged for your review before it
  ships — publishes your `agents.txt`, and stands up the Terminal on your own hostname or a Facet
  subdomain.
- **[AGENT-PURCHASE-FLOW.md](AGENT-PURCHASE-FLOW.md)** — the technical walkthrough of the other
  side: how a client, typically an AI agent, drives a full purchase against a Facet Terminal over
  the Boson escrow rail — browse, price, authorize, commit into escrow, redeem on fulfillment.
  Paired with a complete working script, [`src/purchase.ts`](src/purchase.ts).
