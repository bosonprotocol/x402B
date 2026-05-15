---
"@bosonprotocol/x402-core": minor
"@bosonprotocol/x402-server": minor
"@bosonprotocol/x402-client": minor
---

Action-conditional fulfillment data placement at commit time.

**Wire-format change.** `payload.fulfillment.option` always rides in the commit-time payload (capability negotiation against the server-advertised set). The `data` sub-field is action-conditional:

- **Atomic Flow B** (`boson-createOfferCommitAndRedeem`): `data` MUST be present in `X-PAYMENT`. The atomic redeem leaves no later round trip for the buyer to attach delivery details, so `data` travels with the only round trip the buyer makes. The commit handler invokes `channel.onCommit(exchangeId, data)` after the on-chain redeem settles.
- **Two-step Flow A** (`boson-createOfferAndCommit`): `data` MUST be absent in `X-PAYMENT`. The buyer attaches it to the `boson-redeem` POST body after a successful commit; the existing redeem handler then routes it to `channel.onCommit`.

The action-conditional rule lives in the server validator (rule 13) — the structural Zod / JSON Schema accepts both shapes. New error codes: `FULFILLMENT_DATA_REQUIRED` (Flow B missing data), `FULFILLMENT_DATA_UNEXPECTED` (Flow A carrying data), and `FULFILLMENT_DATA_INVALID` (Flow B data fails the channel adapter's `validate`). Flow B `onCommit` failures surface as a `FULFILLMENT_COMMIT_DEFERRED` warning on the 200 response (the on-chain state is irreversibly `REDEEMED`).

Migration: clients calling `boson-createOfferCommitAndRedeem` must include `fulfillment.data` in their commit-time payload. Clients calling `boson-createOfferAndCommit` must move any `fulfillment.data` they were attaching to the redeem POST body.
