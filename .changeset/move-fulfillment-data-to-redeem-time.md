---
"@bosonprotocol/x402-core": minor
"@bosonprotocol/x402-server": minor
"@bosonprotocol/x402-client": minor
---

Move `fulfillment.data` from the commit-time payment payload to the redeem-time payload.

**Wire-format change.** Commit-time `fulfillment` is now `{ option: string }` only — used for buyer-side capability negotiation against the server-advertised option set. Buyer-supplied delivery data (email address, webhook URL, XMTP address, IPFS pointer) flows with `boson-redeem` instead, where the channel adapter already routes it correctly. Atomic Flow B (`boson-createOfferCommitAndRedeem`) carries no buyer-supplied delivery data — Flow B is appropriate only for channels whose delivery is embedded in the offer (e.g. `inline`) or off-band.

Migration: clients sending `fulfillment.data` at commit time are now rejected by the strict schema. Move delivery payloads to the `POST /x402b/redeem` body's `fulfillment.data` field.
