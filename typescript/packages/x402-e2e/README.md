# @bosonprotocol/x402-e2e

End-to-end test suite for x402B. Private workspace package — never
published. Wraps the canonical Boson local stack
(`boson-protocol-node`, `boson-subgraph`, `ipfs`, `postgres`,
`meta-tx-gateway`, `boson-mcp-server`) plus the three x402B example
services (`facilitator-http`, `resource-server`, `webhook-sink`) into
a single programmatic lifecycle.

> PR 4 of 6 ships the **stack scaffolding** — compose file, lifecycle
> scripts, deploy-done readiness probe, and a gated smoke test.
> The buyer/seller/resolver harness lands in PR 5; scenario tests in PR 6.

## Layout

```text
src/
  bin/
    resource-server.ts            ← entrypoint for x402b-resource-server (wraps the example)
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
scripts/
  stack-up.ts / stack-down.ts     ← CLI wrappers (see `pnpm stack:up` / `:down`)
test/
  stack.test.ts                   ← gated smoke (E2E_DOCKER=1)
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

## Caveats — PR4 scope

- **`x402b-resource-server` uses a placeholder `ExchangeReader`**
  ([`src/bin/resource-server.ts`](./src/bin/resource-server.ts)). The
  `GET /resource` 402 challenge path works; `POST /x402B/{commit,redeem,
  dispute/*}` will fail with `STATE_VERIFY_EXCHANGE_NOT_FOUND` until
  PR5 wires a subgraph-backed reader.
- **No seed step yet.** The boson-protocol-node container already ships
  with a deployed dispute resolver (`id: 1`) and three test ERC-20s,
  so for the smoke path no seed is needed. PR5 adds the
  `createSeller` flow (via core-sdk → meta-tx-gateway) the buyer flows
  depend on.
- **No buyer / seller actors yet.** Lands in PR5.
