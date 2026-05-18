// Public surface of the stack helpers — what `pnpm stack:up`,
// `pnpm stack:down`, and (in PR5+) the harness consume.

export { startStack, type StartStackOptions } from "./start.js";
export { stopStack, type StopStackOptions } from "./stop.js";
export { waitForStackReady, type WaitForReadyOptions } from "./readiness.js";
export { COMPOSE_FILE } from "./paths.js";
