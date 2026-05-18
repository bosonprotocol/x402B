# @bosonprotocol/x402-e2e

End-to-end test suite for x402B. Private workspace package — never
published. Wraps the canonical Boson local stack
(`boson-protocol-node`, `boson-subgraph`, `ipfs`, `postgres`,
`meta-tx-gateway`, `boson-mcp-server`) plus the three x402B example
services (`facilitator-http`, `resource-server`, `webhook-sink`) into
a single programmatic lifecycle.

> PR 4 shipped the **stack scaffolding** — compose file, lifecycle
> scripts, deploy-done readiness probe, gated smoke. PR 5 (this PR)
> adds the **actor + asserter harness** plus the subgraph-backed
> `ExchangeReader` the resource-server container now uses. Scenario
> tests land in PR 6.

## Layout

```text
src/
  bin/
    resource-server.ts            ← entrypoint for x402b-resource-server (wraps the example + subgraph reader)
    resource-server.Dockerfile    ← Dockerfile invoked by compose.yaml
  config/
    accounts.ts                   ← verbatim test PKs from boson-protocol-contracts/accounts.js
    local-31337-0.ts              ← address + URL constants from core-sdk's defaultConfig
  stack/
    compose.yaml                  ← canonical Boson stack + 3 x402B services
    ipfs-config.sh                ← volume-mounted into the ipfs container
    start.ts / stop.ts            ← programmatic docker compose up / down
    readiness.ts                  ← polls boson-protocol-node + boson-subgraph deploy.done markers
    paths.ts / exec.ts            ← internals
  harness/                          ← PR 5
    clients.ts                    ← shared viem PublicClient/WalletClient builders
    exchange-reader.ts            ← subgraph-backed ExchangeReader (CoreSDK.getExchangeById)
    buyer-actor.ts                ← x402-client + wrapFetchWithPayment wrapper
    seller-actor.ts               ← FullOffer signer
    resolver-actor.ts             ← dispute-resolver operator persona
    onchain-asserter.ts           ← retry-aware snapshot assertions
    x-payment-response-asserter.ts ← decodes X-PAYMENT-RESPONSE header
    seed.ts                       ← suite-level idempotent seed (createSeller)
scripts/
  stack-up.ts / stack-down.ts     ← CLI wrappers (see `pnpm stack:up` / `:down`)
test/
  stack.test.ts                   ← gated smoke (E2E_DOCKER=1)
  harness/                        ← PR 5 unit tests (no Docker)
    actors.test.ts
    asserters.test.ts
    seed.test.ts
```

## Bring the stack up

The compose file is anchored at `src/stack/compose.yaml`; the CLI
wrappers resolve it absolute so `pnpm stack:up` works from any CWD.

```sh
pnpm --filter @bosonprotocol/x402-e2e stack:up [--pull] [--build] [--no-wait]
```

The `up` flow runs in two phases:

1. **`docker compose up -d --wait`** — Docker reports every container
   has started. For services without a Docker `HEALTHCHECK` (most of
   the upstream Boson images), this only means the entry process
   forked, not that the contracts / subgraph have finished deploying.
2. **`waitForStackReady`** — polls the two deploy-done markers the
   upstream containers drop after their automatic deploy step:
   - `boson-protocol-node:/app/deploy.done` (~30–90s on a warm cache)
   - `boson-subgraph:/home/deploy.done` (~30–60s after the chain is up)

   Matches `bosonprotocol/core-components:e2e/prepare-e2e-services.sh`.
   Pass `--no-wait` if you only need IPFS + RPC.

```sh
pnpm --filter @bosonprotocol/x402-e2e stack:down [--keep-volumes] [--rmi]
```

Default `down` removes the volumes (resets chain + subgraph + IPFS
state). Pass `--keep-volumes` to preserve them across runs.

## Smoke test

```sh
E2E_DOCKER=1 pnpm --filter @bosonprotocol/x402-e2e test
```

Boots the stack, waits for both `deploy.done` markers, pings every
service's HTTP-level health probe (or root URL), and tears down. Allow
2–5 minutes on a cold image pull.

Without `E2E_DOCKER=1`, the suite skips itself so the repo-wide
`pnpm test` stays fast.

## Conventions

- **Test accounts** — `src/config/accounts.ts` carries the verbatim
  `ACCOUNT_1`…`ACCOUNT_9` keys from
  [`bosonprotocol/core-components:contracts/accounts.js`](https://github.com/bosonprotocol/core-components/blob/main/contracts/accounts.js).
  Test keys only. Role assignments (gateway, facilitator relayer,
  seller, buyer, resolver) live in the `ROLE_ACCOUNTS` map; distinct
  account per role so concurrent meta-tx submissions never share a
  nonce.
- **Addresses + URLs** — `src/config/local-31337-0.ts` is a typed copy
  of the `local-31337-0` entry from `@bosonprotocol/core-sdk`'s
  `defaultConfig`. Source-of-truth comment cites the upstream file so
  bumps are obvious.
- **Compose env vars** — left verbatim from the canonical
  `bosonprotocol/agentic-commerce` compose file. Updates land here
  only after they land upstream, so a developer running the canonical
  stack from another Boson project sees the same env.

## Harness (PR 5)

The harness exposes actor + asserter primitives that scenario tests
compose. Every piece has a unit test under `test/harness/` that runs
without Docker.

```ts
import {
  ROLE_ACCOUNTS,
  createBuyerActor,
  createSellerActor,
  createSubgraphExchangeReader,
  createOnchainAsserter,
  readXPaymentResponse,
  seedSuite,
} from "@bosonprotocol/x402-e2e";
import { privateKeyToAccount } from "viem/accounts";

// One-time per suite:
const seller = createSellerActor({
  account: privateKeyToAccount(ROLE_ACCOUNTS.seller.privateKey),
});
const buyer = createBuyerActor({
  account: privateKeyToAccount(ROLE_ACCOUNTS.buyer.privateKey),
});
const reader = createSubgraphExchangeReader();
const asserter = createOnchainAsserter(reader);

// `seedSuite` is idempotent — first run registers the seller,
// subsequent runs return the existing entity id.
const suiteState = await seedSuite({
  sellerAddress: seller.address,
  createSeller: async (assistant) => {
    // PR 6 scenarios plug the core-sdk createSeller call here.
  },
});

// In a scenario test:
const res = await buyer.fetch("http://localhost:4001/resource");
const decoded = readXPaymentResponse(res.headers);
await asserter.expect(decoded!.exchangeId!, {
  state: ExchangeState.COMMITTED,
  seller: seller.address,
  exchangeToken: LOCAL_31337_0.contracts.testErc20,
  price: "1000000",
});
```

### Notes

- **`x402b-resource-server` now uses the subgraph-backed reader.**
  The compose service boots with the same `ExchangeReader` scenario
  tests use, so write handlers (`commit`, `redeem`, `dispute/*`) work
  end-to-end against the local stack.
- **`seedSuite` is "check + optionally create".** The default
  `createSeller` callback throws — scenario PRs plug in the actual
  core-sdk call. A stack with the seller pre-provisioned passes
  through. See [`src/harness/seed.ts`](./src/harness/seed.ts) header
  for rationale.
- **No scenario tests yet** — those land in PR 6 alongside CI wiring.
