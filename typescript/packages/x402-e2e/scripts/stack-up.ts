// `pnpm --filter @bosonprotocol/x402-e2e stack:up` — bring up the stack
// from a shell. CLI flags map directly to `startStack`'s options.

import { startStack } from "../src/stack/index.js";

const args = new Set(process.argv.slice(2));
const usage = args.has("--help") || args.has("-h");
if (usage) {
  console.log(
    [
      "Usage: pnpm --filter @bosonprotocol/x402-e2e stack:up [--pull] [--build] [--no-wait]",
      "",
      "Flags:",
      "  --pull       Run `docker compose pull` first to refresh upstream images.",
      "  --build      Rebuild local images from the example Dockerfiles before `up`.",
      "  --no-wait    Skip the contracts + subgraph `deploy.done` readiness probe.",
    ].join("\n"),
  );
  process.exit(0);
}

async function main(): Promise<void> {
  await startStack({
    pull: args.has("--pull"),
    build: args.has("--build"),
    waitForReady: !args.has("--no-wait"),
  });
  console.log("[stack] ready");
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
