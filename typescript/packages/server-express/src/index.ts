// Public API for `@bosonprotocol/x402-server-express` — the Express
// adapter for `@bosonprotocol/x402-server`. Two exports:
//
// - `expressMiddleware(server, opts)`: gates a single route on a
//   successful commit-time settle. Responds with 402 + a
//   `PaymentRequirements` body when the buyer hasn't sent
//   `X-PAYMENT` yet.
// - `mountX402b(server, opts)`: an `express.Router` wiring the eight
//   `POST /x402b/*` convenience routes.

export {
  expressMiddleware,
  type ExpressMiddlewareOptions,
  type X402bResLocals,
} from "./middleware.js";
export { INVALID_REQUEST_BODY, mountX402b, type MountX402bOptions } from "./mount.js";
