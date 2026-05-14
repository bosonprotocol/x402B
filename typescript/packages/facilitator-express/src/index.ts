// Public surface for `@bosonprotocol/x402-facilitator-express`.
//
// Mounts `@bosonprotocol/x402-facilitator`'s three async library
// functions (`verify`, `settle`, `performAction`) as Express routes
// (`POST /verify`, `POST /settle`, `POST /perform-action`) per
// docs/boson-impl-07-facilitator.md. No protocol logic lives here —
// this package is a thin HTTP wrapper, mirroring the
// `server` / `server-express` split.

export { mountFacilitator, type MountFacilitatorOptions } from "./mount.js";
