// `pnpm --filter @bosonprotocol/x402-e2e stack:down` — tear the stack
// down. Default behaviour matches the upstream `prepare-e2e-services.sh`
// cleanup (`docker compose down -v`).

import { stopStack } from "../src/stack/index.js";

const args = new Set(process.argv.slice(2));
const usage = args.has("--help") || args.has("-h");
if (usage) {
  console.log(
    [
      "Usage: pnpm --filter @bosonprotocol/x402-e2e stack:down [--keep-volumes] [--rmi]",
      "",
      "Flags:",
      "  --keep-volumes   Skip `-v`; preserves the chain + subgraph + IPFS state.",
      "  --rmi            Also remove locally-built images (`--rmi local`).",
    ].join("\n"),
  );
  process.exit(0);
}

async function main(): Promise<void> {
  await stopStack({
    volumes: !args.has("--keep-volumes"),
    removeImages: args.has("--rmi"),
  });
  console.log("[stack] torn down");
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
