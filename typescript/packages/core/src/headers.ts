// Shared HTTP header names that span the buyer-side fetch wrapper and
// any resource server / facilitator implementing the x402B escrow
// scheme. Centralising them here keeps the wire contract single-sourced
// across packages.

/**
 * Custom header `@bosonprotocol/x402-client-fetch` stamps on both the
 * initial request and the X-PAYMENT retry. Resource servers that scope
 * their `FullOffer` cache per buyer flow key the cache off this id so
 * the 402 challenge and the X-PAYMENT retry share one signed offer.
 *
 * The canonical value uses mixed case for header readability; HTTP
 * header lookups are case-insensitive on both Node (`req.headers[…]`
 * are already lowercased) and Express (`req.header(…)`), so importers
 * can pass the constant verbatim regardless of which lookup style they
 * use.
 */
export const SESSION_ID_HEADER = "X-X402-Boson-Session-Id";
