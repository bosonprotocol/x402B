# @bosonprotocol/x402-e2e

End-to-end test suite for x402B. Private workspace package — never
published. Wraps the canonical Boson local stack
(`boson-protocol-node`, `boson-subgraph`, `ipfs`, `postgres`,
`meta-tx-gateway`, `boson-mcp-server`) plus the three x402B example
services (`facilitator-http`, `resource-server`, `webhook-sink`) into
a single programmatic lifecycle.

> PR 4 shipped the **stack scaffolding** (compose, lifecycle, readiness
> probe, gated smoke). PR 5 added the **actor + asserter harness** and
> the subgraph-backed `ExchangeReader`. PR 6 (this PR) lands the
> **scenario suite scaffolding**: vitest `globalSetup` that boots the
> stack + seeds the seller entity via core-sdk, an in-process
> resource-server-per-test, and the first runnable scenario (A1 —
> deferred commit with `none` token-auth). A2–A5 (atomic + token-auth
> variants) and C1–C5/C8 (commit-time validations) are enumerated as
> `it.todo` and land in PR 7. PR 8 covers operational failure modes
> and nightly CI.

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
    start.ts / stop.ts            ← programmatic docker compose up / down (whole-stack lifecycle)
    service-control.ts            ← per-service kill / pause / unpause / start (chaos for F1, F2)
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
    create-seller.ts              ← PR 6 — wallet-bound createSeller callback (core-sdk)
scripts/
  stack-up.ts / stack-down.ts     ← CLI wrappers (see `pnpm stack:up` / `:down`)
test/
  stack.test.ts                   ← gated smoke (E2E_DOCKER=1)
  harness/                        ← PR 5 unit tests (no Docker)
    actors.test.ts
    asserters.test.ts
    seed.test.ts
  setup/                          ← PR 6
    globalSetup.ts                ← boots stack + seeds seller; gated on E2E_DOCKER
  scenarios/                      ← PR 6
    _setup.ts                     ← per-test scaffolding (in-process resource server, actors, asserter)
    _buyer-setup.ts               ← mint + approve helpers; `createFundedBuyer` + `rotateBuyer` (F4)
    _seed-wallets.ts              ← per-FILE seed-wallet pool (one Boson seller per slot)
    _skeletons.test.ts            ← it.todo anchors for unimplemented scenarios
    commit.test.ts                ← A1, A2 runnable
    post-commit.test.ts           ← B1–B4 (@p0), B6, B7 (@p1)
    concurrent.test.ts            ← E0 — 20 parallel atomic commit-and-redeem
    operational.test.ts           ← F1 (@p1), F2, F4 (@p2) — failure-mode chaos
    validation-commit.test.ts     ← C1–C5, C8 (commit-time validation negatives)
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

### When to rebuild

`stack:up` accepts two refresh flags that target different layers:

- `--pull` — refreshes the **upstream** Boson images (`boson-protocol-node`,
  `boson-subgraph`, `boson-mcp-server`, `postgres`, `ipfs`, `meta-tx-gateway`).
  Use it after a new tag lands on `main` upstream, or periodically.
- `--build` — rebuilds the **local** x402B images
  (`x402b-facilitator-http`, `x402b-resource-server`, `x402b-webhook-sink`)
  from their Dockerfiles in this repo.

`--build` is needed when any source the image bundles has changed:

| Changed files | Service to rebuild |
|---|---|
| `examples/facilitator-http/src/**` or `typescript/packages/{facilitator-express,facilitator,core,evm,actions,fulfillment}/src/**` | `x402b-facilitator-http` |
| `typescript/packages/x402-e2e/src/bin/**` or `examples/resource-server/src/**` or `typescript/packages/{server-express,server,core,evm,actions,fulfillment}/src/**` | `x402b-resource-server` |
| `examples/webhook-sink/src/**` | `x402b-webhook-sink` |
| Only `typescript/packages/x402-e2e/test/**` (scenario / harness tests) | nothing — tests run out-of-container |
| Only docs or CI | nothing |
| `.dockerignore` | `--build` all three (`x402b-facilitator-http`, `x402b-resource-server`, `x402b-webhook-sink`) |

`.dockerignore` shapes the build context itself, so changes to it commonly
require a rebuild when Dockerfiles use `COPY . .` (as ours do) — files newly
included or excluded by the ignore rules will only appear in / disappear from
the image after `--build`.

The Dockerfiles are layered so that **passing `--build` when nothing actually
changed is near-free**: BuildKit reuses every cached layer up to the first
invalidated one. If you're unsure whether you need it, just pass it — that's
the recommended default for inner-loop work.

`pnpm-lock.yaml` changes invalidate the install layer (~30–45s of rebuild),
but the pnpm content-addressable store is cached via BuildKit cache mounts,
so no network downloads happen on a warm cache.

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

## Scenario inventory

Tests are tagged in the `describe(...)` title so vitest can filter
with `-t '@p0'`. Priorities:

- **`@p0`** — happy-path commit + post-commit lifecycle. Runs on
  every PR in CI (see `.github/workflows/ci.yml`'s `e2e-pr` job).
- **`@p1`** — secondary lifecycle paths (token-auth strategies,
  retract / cancel). Runs on every PR alongside `@p0` in the `e2e-pr`
  job. The one exception is the F1 operational chaos scenario, which
  is excluded from the per-PR job (it kills a shared container, so it
  can't run in parallel) and is exercised nightly instead.
- **`@p2`** — niche failure modes (subgraph lag, buyer key
  rotation) and lower-impact transitions. Runs nightly.

| Tag(s)   | Describe                                      | File                          |
|----------|-----------------------------------------------|-------------------------------|
| `@p0`    | commit-time scenarios (A1, A2)                | `commit.test.ts`              |
| `@p0`    | commit-time scenarios — ERC-3009 (A3)         | `commit.test.ts`              |
| `@p1`    | commit-time scenarios — Permit / Permit2 (A4, A5) | `commit.test.ts`          |
| `@p0`    | concurrent commit-and-redeem (E0)             | `concurrent.test.ts`          |
| `@p0`    | post-commit lifecycle (B1–B4)                 | `post-commit.test.ts`         |
| `@p0`    | commit-time validations (C1–C5, C8)           | `validation-commit.test.ts`   |
| `@p0`    | browser paywall (BR1–BR3)                     | `browser/paywall.test.ts`     |
| `@p1`    | post-commit lifecycle (B6, B7)                | `post-commit.test.ts`         |
| `@p1`    | operational scenarios (F1)                    | `operational.test.ts`         |
| `@p2`    | operational scenarios (F2, F4)                | `operational.test.ts`         |
| `@p1/@p2`| commit-time fulfillment (A6–A8)               | `_skeletons.test.ts`          |
| `it.todo`| follow-up scenarios (B5, B8–9, C6–C10, D1–D4, E1–E3) | `_skeletons.test.ts`   |

### Scenario walkthroughs

Prose + sequence-diagram docs that explain how the protocol behaves,
flow by flow, mapping each step back to the harness / SDK / facilitator /
Diamond method that runs it — see [`docs/scenarios/`](./docs/scenarios/README.md).
One doc per protocol flow:
[A — deferred commit](./docs/scenarios/flow-a-deferred-commit.md),
[B — atomic commit-and-redeem](./docs/scenarios/flow-b-atomic-commit-redeem.md),
[C — dispute path](./docs/scenarios/flow-c-dispute.md),
[D — channels & nextActions](./docs/scenarios/flow-d-channels-nextactions.md).

### Running a tag subset

```sh
# Matches the per-PR CI job — @p0 + @p1, with `operational.test.ts`
# excluded so it stays parallel-safe (the F1 chaos test kills a shared
# container). Routed through the dedicated `test:pr` script because
# pnpm v10 forwards `--` literally and vitest would parse the flags as
# positional file patterns instead of `--testNamePattern` / `--exclude`.
E2E_DOCKER=1 pnpm --filter @bosonprotocol/x402-e2e test:pr

# Just the @p0 subset.
E2E_DOCKER=1 pnpm --filter @bosonprotocol/x402-e2e test:p0

# Full suite in one sequential (single-worker) pass — includes the
# chaos file. Handy when debugging chain-state interactions across files.
E2E_DOCKER=1 pnpm --filter @bosonprotocol/x402-e2e test:sequential

# Just the chaos/operational file, sequentially. The default `test`
# excludes it (F1 kills the facilitator, F2 pauses the subgraph, so it
# can't race other files); the nightly runs this as a second phase.
E2E_DOCKER=1 pnpm --filter @bosonprotocol/x402-e2e test:chaos

# A single file, against a stack you launched manually via `pnpm stack:up`.
E2E_DOCKER=1 E2E_DOCKER_KEEP_STACK=1 \
  pnpm --filter @bosonprotocol/x402-e2e exec vitest run test/scenarios/operational.test.ts
```

## CI workflows

- **`.github/workflows/ci.yml`** runs on every PR + push to `main`:
  - `build-test-lint` — Node 22 / 24 matrix; `pnpm build`,
    `pnpm test`, `pnpm lint`, `pnpm format:check`.
  - `e2e-pr` — boots the stack and runs the `@p0 + @p1` scenario
    subset via `test:pr` (`vitest -t '@p0|@p1' --exclude
    '**/operational.test.ts'`). The operational file is excluded so
    the job stays parallel; its F1 chaos scenario runs nightly
    instead. 30-min timeout (cold image pull adds 2–5 min). Uploads
    `docker compose logs` on failure.
- **`.github/workflows/nightly.yml`** runs daily at 03:00 UTC and on
  manual `workflow_dispatch`:
  - `e2e-full` — boots the stack once and runs two phases over it
    (`E2E_DOCKER_KEEP_STACK=1` keeps it alive between them, no restart):
    first the parallel suite (`test`, with the chaos file excluded),
    then the chaos file alone, sequentially (`test:chaos`). Together
    these cover every scenario including the operational failure-mode
    tests. 60-min timeout. Uploads `docker compose logs` on failure.

Both workflows pin Node 22 for the e2e job (Docker is the heavy
dependency, not the Node version) and set
`FORCE_JAVASCRIPT_ACTIONS_TO_NODE24=true` per repo policy so
`actions/checkout` / `setup-node` / etc. opt onto Node 24 ahead of
GitHub's June 2026 forced migration.

## Conventions

- **Test accounts** — `src/config/accounts.ts` carries the verbatim
  `ACCOUNT_1`…`ACCOUNT_15` keys from
  [`bosonprotocol/core-components:contracts/accounts.js`](https://github.com/bosonprotocol/core-components/blob/main/contracts/accounts.js).
  Test keys only. Role assignments (gateway, facilitator relayer,
  seller, buyer, resolver) live in the `ROLE_ACCOUNTS` map; distinct
  account per role so concurrent meta-tx submissions never share a
  nonce.
- **Per-test-file seed wallets** — Vitest runs test FILES in parallel.
  Each chain-touching test file picks one slot from
  [`test/scenarios/_seed-wallets.ts`](./test/scenarios/_seed-wallets.ts)
  and uses it to fund freshly-generated random buyer EOAs (via
  `createFundedBuyer`). Multiple describes in the same file may share
  that file's slot, but two files that run in parallel must never
  share a slot — a shared EOA races the chain nonce and cascades into
  `NonceTooLow` / `BAD_META_TX_SIGNATURE` / `OfferSoldOut` failures.
  Mirrors the `seedWalletN` pattern from
  [`bosonprotocol/core-components/e2e/tests/utils.ts`](https://github.com/bosonprotocol/core-components/blob/main/e2e/tests/utils.ts).
- **Chaos tests run apart** — `operational.test.ts` SIGKILLs the
  facilitator (F1) and pauses the subgraph (F2), so it can't share a
  parallel run with any chain-touching file. The default `test` script
  excludes it (`--exclude "**/operational.test.ts"`) and runs the rest
  in parallel; `test:chaos` runs it alone, sequentially; `test:sequential`
  runs the whole suite single-threaded. The nightly does `test` then
  `test:chaos` over one shared stack. (`E2E_SEQUENTIAL=1` remains as a
  config-level escape hatch to force `fileParallelism: false` on any run.)
- **Quote test-script globs with double quotes** — npm/pnpm run scripts
  through `cmd` on Windows, where single quotes are literal. A
  single-quoted `--exclude '**/operational.test.ts'` silently matches
  nothing there (the chaos file then races the suite); double quotes are
  stripped by both `cmd` and POSIX shells. Same for the `-t "@p0|@p1"`
  pipe in `test:pr`.
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
  LOCAL_31337_0,
  ROLE_ACCOUNTS,
  createBuyerActor,
  createSellerActor,
  createSubgraphExchangeReader,
  createOnchainAsserter,
  readXPaymentResponse,
  seedSuite,
} from "@bosonprotocol/x402-e2e";
import { ExchangeState } from "@bosonprotocol/x402-actions";
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

## Browser scenarios

`test/browser/paywall.test.ts` drives a real headless chromium (via
the `playwright` library, not `@vitest/browser`) through the
`@bosonprotocol/x402-paywall` HTML 402 flow end-to-end. Three
scenarios:

- **BR1** (`@p0`) — happy path: server emits the paywall HTML, an
  injected EIP-1193 mock (backed by a viem private key on the Node
  side via `BrowserContext.exposeFunction`) signs the X-PAYMENT
  payload, the buyer's retry settles on-chain, and the on-chain
  `ExchangeState.COMMITTED` is asserted via the subgraph reader.
- **BR2** (`@p0`) — the mock wallet rejects `eth_signTypedData_v4`
  with `code: 4001`; the paywall surfaces the error in
  `[data-testid="paywall-error"]` and no on-chain commit happens.
- **BR3** (`@p0`) — the mock wallet reports the wrong chain id and
  rejects `wallet_switchEthereumChain`; the paywall shows the
  wrong-network warning, `Pay` surfaces the rejection, no commit.

Slot: `browser` (`SEED_WALLETS.browser` → `ACCOUNT_14`). All three
scenarios live in one file so they run sequentially against the same
in-process resource server — the paywall doesn't yet stamp
`X-Session-Id`, so concurrent flows would race on the
`FALLBACK_KEY` session slot in the resource server's session cache.

### Local prerequisites

`playwright` ships its own chromium download (~150MB) via its
postinstall hook. Cached under `PLAYWRIGHT_BROWSERS_PATH` if set;
otherwise under each install's `node_modules/playwright/.local-browsers`.
CI should cache that path to avoid re-downloading per job. Set
`PLAYWRIGHT_SKIP_DOWNLOAD=1` to opt out (browser tests will fail to
launch).

### Running only the browser file

```sh
E2E_DOCKER=1 pnpm --filter @bosonprotocol/x402-e2e test:browser
```

Equivalent to `vitest run test/browser`. Combine with
`E2E_DOCKER_KEEP_STACK=1` and a manual `pnpm stack:up` for fast inner
loops.
