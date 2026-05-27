// Locate the `escrow` entry inside a parsed x402 402 challenge body.
//
// The 402 JSON envelope is `{ x402Version, accepts: [requirements...] }`
// (see `respondWithChallenge` in `@bosonprotocol/x402-server-express`). A
// server may advertise several schemes in `accepts[]`; this returns the
// first entry whose `scheme === "escrow"`, or `undefined` when the body
// isn't an object, has no `accepts[]` array, or carries only other
// schemes.
//
// Single-sourced here so the buyer-side fetch wrapper
// (`@bosonprotocol/x402-client-fetch`) and the browser paywall
// (`@bosonprotocol/x402-paywall`) pick the entry identically. The input
// is the already-parsed JSON body rather than a `Response` so the helper
// stays environment-agnostic — each caller owns how it decodes the
// response (clone-then-`json()` for the wrapper, plain `json()` for the
// paywall).

export function findEscrowAccept(body: unknown): unknown | undefined {
  if (typeof body !== "object" || body === null) {
    return undefined;
  }
  const accepts = (body as { accepts?: unknown }).accepts;
  if (!Array.isArray(accepts)) {
    return undefined;
  }
  return accepts.find(
    (entry) =>
      typeof entry === "object" &&
      entry !== null &&
      (entry as { scheme?: unknown }).scheme === "escrow",
  );
}
