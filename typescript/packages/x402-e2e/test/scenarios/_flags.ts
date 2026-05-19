// Shared gating flag for the scenario suite. Every scenario file
// declares `describe.skipIf(!ENABLED)` so the suite no-ops in the
// repo-wide `pnpm test` and only runs when the docker stack is up
// (`E2E_DOCKER=1`).

export const ENABLED = process.env.E2E_DOCKER === "1";
