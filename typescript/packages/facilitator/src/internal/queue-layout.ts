// Action-aware queue layout for BPIP-12 token-transfer authorisations.
//
// The deployed Boson protocol's `TokenTransferAuthorizationLib` requires the
// off-chain caller to supply one queue slot per `transferFundsIn(...)` call
// that fires inside the inner meta-tx — even zero-amount calls, which
// advance the queue head via `discardNext()` without dispatching. The
// facilitator therefore can't just send a one-entry queue carrying the
// buyer's authorisation; it has to prepend a fallback marker for every
// pre-buyer `transferFundsIn` site so the buyer's auth lands at the right
// index.
//
// LIMITATION (tracked in #86): the pre-buyer slot is currently filled with
// the empty-bytes `FALLBACK_ENTRY` marker, which means "no auth → use the
// ERC-20 standing allowance". This is sufficient when `sellerDeposit == 0`
// (the protocol calls `discardNext()` on the zero-amount path and never
// decodes the entry) or when the seller has off-band approved the escrow
// for `sellerDeposit`. A fully gasless flow with non-zero `sellerDeposit`
// requires a SELLER-signed auth (ERC-3009 / Permit / Permit2) at slot 0;
// the wire format + server + this module would need to grow to carry it.
//
// Mapping today (Boson protocol-contracts commit
// `858661679cc8ba2be97eedf3cbc3acd0f5c1903e`):
//
//   - `boson-createOfferAndCommit`         — 1 pre-buyer slot
//   - `boson-createOfferCommitAndRedeem`   — 1 pre-buyer slot
//
// Both call `createOfferInternal` (which `transferFundsIn`s the offer
// creator's `sellerDeposit`, almost always `0` and thus consumed via
// `discardNext()`) and *then* `commitToOfferInternal → encumberFunds →
// validateIncomingPayment → transferFundsIn(price)` (the buyer-side pull
// that needs the token auth). The atomic commit-and-redeem variant
// additionally enters the redeem path, which doesn't move funds in, so
// the queue layout is identical.
//
// Other actions (`boson-redeem`, `boson-completeExchange`, the dispute
// family) don't pull buyer funds at all and travel via
// `executeMetaTransaction` (no queue) — so the BPIP-12 envelope only ever
// applies to the two commit-time actions above today.

const PRE_BUYER_SKIP_SLOTS: Readonly<Record<string, number>> = {
  "boson-createOfferAndCommit": 1,
  "boson-createOfferCommitAndRedeem": 1,
};

/**
 * Number of empty queue slots the facilitator must prepend before the
 * buyer's token-auth entry. Returns `0` for any action the protocol
 * doesn't pre-pull funds on; the buyer's auth then sits at index 0.
 */
export function preBuyerSkipSlots(actionId: string): number {
  return PRE_BUYER_SKIP_SLOTS[actionId] ?? 0;
}
