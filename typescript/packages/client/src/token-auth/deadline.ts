// Client-side deadline for token-auth signatures (ERC-3009 `validBefore`,
// EIP-2612 `deadline`, Permit2 `deadline`).
//
// The facilitator validates strictly: `deadline − facilitatorNow ≤
// requirements.maxTimeoutSeconds`. If the client signs at the boundary
// (`floor(clientNow) + maxTimeoutSeconds`), any moment where the
// verifier's wall-clock lags the signer's by ≥ 1 s pushes the gap
// over `maxTimeoutSeconds` and the facilitator rejects with
// BAD_TOKEN_AUTH_SIGNATURE. Docker Desktop's container clock drifting
// behind the host clock makes this happen randomly in the e2e suite.
//
// We pull the deadline closer to `clientNow` by a small margin so the
// facilitator's check tolerates that backward skew. 60 s comfortably
// covers Docker drift and leaves a useful validity window even at the
// spec's example `maxTimeoutSeconds = 300`.

export const TOKEN_AUTH_DEADLINE_SAFETY_MARGIN_SECONDS = 60;

export function computeTokenAuthDeadline(
  maxTimeoutSeconds: number,
  now: () => number = Date.now,
): number {
  return Math.floor(now() / 1000) + maxTimeoutSeconds - TOKEN_AUTH_DEADLINE_SAFETY_MARGIN_SECONDS;
}
